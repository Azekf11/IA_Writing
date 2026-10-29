import numpy as np
import pandas as pd
import pytest

from aiwd.data.build import build_raid_dataset
from aiwd.eval.report import evaluate_detector, merge_scores, to_markdown
from aiwd.eval.scores import load_scores, save_scores


def dataset(n_groups: int = 400, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for g in range(n_groups):
        split = ("calibration", "test", "train")[g % 3]
        domain = ("news", "books")[g % 2]
        rows.append(
            dict(
                id=f"h{g}",
                group_id=f"g{g}",
                split=split,
                label="human",
                y=0,
                generator=None,
                decoding=None,
                domain=domain,
                length_bucket="<150",
            )
        )
        for k, gen in enumerate(("gpt4", "mistral")):
            rows.append(
                dict(
                    id=f"a{g}-{k}",
                    group_id=f"g{g}",
                    split=split,
                    label="ai",
                    y=1,
                    generator=gen,
                    decoding="greedy",
                    domain=domain,
                    length_bucket=str(rng.choice(["<150", "150-299"])),
                )
            )
    return pd.DataFrame(rows)  # fmt: skip


def scores_for(df: pd.DataFrame, separation: float, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    return pd.DataFrame({"id": df["id"], "score": rng.normal(size=len(df)) + separation * df["y"]})


def test_perfect_detector_report():
    df = dataset()
    scores = pd.DataFrame({"id": df["id"], "score": df["y"] * 10.0 + np.arange(len(df)) * 1e-6})
    report = evaluate_detector(df, scores, n_boot=50)
    assert report["overall"]["auroc"] == 1.0
    assert report["overall"]["0.01"]["tpr"] == 1.0
    assert report["overall"]["0.01"]["fpr"] <= 0.01


def test_thresholds_come_from_calibration_split_only():
    df = dataset()
    scores = scores_for(df, separation=2.0)
    shifted = scores.copy()
    test_ids = set(df.loc[df["split"] == "test", "id"])
    shifted.loc[shifted["id"].isin(test_ids), "score"] += 100.0
    a = evaluate_detector(df, scores, n_boot=20)
    b = evaluate_detector(df, shifted, n_boot=20)
    assert a["protocol"]["thresholds"] == b["protocol"]["thresholds"]
    assert b["overall"]["0.01"]["fpr"] == 1.0


def test_train_split_scores_are_not_required():
    df = dataset()
    scores = scores_for(df, 1.0)
    scores = scores[~scores["id"].isin(df.loc[df["split"] == "train", "id"])]
    evaluate_detector(df, scores, n_boot=20)


def test_missing_scores_are_reported():
    df = dataset()
    scores = scores_for(df, 1.0).iloc[5:]
    with pytest.raises(ValueError, match="have no score"):
        merge_scores(df, scores)


def test_random_detector_is_near_chance_with_honest_fpr():
    df = dataset(n_groups=1200)
    report = evaluate_detector(df, scores_for(df, 0.0), n_boot=100)
    o = report["overall"]
    assert abs(o["auroc"] - 0.5) < 0.05
    assert o["auroc_ci95"][0] < 0.5 < o["auroc_ci95"][1]
    assert o["0.05"]["fpr"] < 0.1
    assert o["0.05"]["fpr_upper95"] >= o["0.05"]["fpr"]


def test_breakdowns_and_markdown():
    df = dataset()
    report = evaluate_detector(df, scores_for(df, 1.5), n_boot=20)
    assert set(report["by_domain"]) == {"news", "books"}
    assert set(report["by_generator"]) == {"gpt4", "mistral"}
    assert report["by_generator"]["gpt4"]["n_human"] == report["overall"]["n_human"]
    assert set(report["by_length_bucket"]) == {"<150", "150-299"}
    assert "auroc" not in report["by_length_bucket"]["150-299"]
    md = to_markdown(report, "toy")
    assert md.startswith("# Evaluation: toy")
    assert "| 1% |" in md and "## Generator" in md


def test_scores_roundtrip_and_validation(tmp_path):
    p = save_scores(tmp_path / "s.parquet", ["a", "b"], [0.1, 0.2])
    assert load_scores(p)["score"].tolist() == [0.1, 0.2]
    c = save_scores(tmp_path / "s.csv", [1, 2], [0.3, 0.4])
    assert load_scores(c)["id"].tolist() == ["1", "2"]
    with pytest.raises(ValueError, match="duplicate"):
        save_scores(tmp_path / "d.parquet", ["a", "a"], [0.1, 0.2])
    with pytest.raises(ValueError, match="finite"):
        save_scores(tmp_path / "n.parquet", ["a"], [float("nan")])


def test_end_to_end_on_built_dataset(raid_csv):
    df, _ = build_raid_dataset(raid_csv, per_domain=40)
    scores = pd.DataFrame({"id": df["id"], "score": df["y"] + 0.0})
    scores["score"] += np.random.default_rng(0).normal(scale=0.5, size=len(df))
    with pytest.raises(ValueError, match="too few"):
        evaluate_detector(df, scores, fprs=(0.01,), n_boot=20)
    report = evaluate_detector(df, scores, fprs=(0.2,), n_boot=20)
    assert report["overall"]["auroc"] > 0.8
    assert "## Domain" in to_markdown(report, "e2e")


def test_markdown_escapes_pipes_and_orders_length_buckets():
    df = dataset()
    df.loc[df["y"] == 1, "decoding"] = "greedy|rep_penalty=no"
    df.loc[df.index % 4 == 0, "length_bucket"] = ">=600"
    report = evaluate_detector(df, scores_for(df, 1.0), n_boot=20)
    assert list(report["by_length_bucket"]) == ["<150", "150-299", ">=600"]
    md = to_markdown(report, "toy")
    assert "| greedy\\|rep_penalty=no" in md
    assert "| greedy|rep" not in md


def test_conformal_threshold_rule_and_too_small_calibration():
    from aiwd.eval import conformal_threshold

    thr, k = conformal_threshold(np.arange(405, dtype=float), 0.01)
    assert k == 3 and thr == 401.0
    with pytest.raises(ValueError, match="too few"):
        conformal_threshold(np.arange(50, dtype=float), 0.01)


def test_conformal_threshold_keeps_expected_fpr_under_target():
    from aiwd.eval import conformal_threshold

    rng = np.random.default_rng(0)
    fprs = []
    for _ in range(3000):
        thr, _ = conformal_threshold(rng.random(405), 0.01)
        fprs.append(1 - thr)
    assert np.mean(fprs) <= 0.01


def test_markdown_flags_slices_with_too_few_humans():
    df = dataset()
    md = to_markdown(evaluate_detector(df, scores_for(df, 1.0), n_boot=20), "toy")
    assert "FPR up95@1%" in md
    assert "\u2020" in md and "fewer than 299 human texts" in md
