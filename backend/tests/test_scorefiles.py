import math

import numpy as np
import pandas as pd
from test_report import dataset, scores_for

from aiwd.eval.report import evaluate_detector, to_markdown
from aiwd.eval.scores import ABSTAIN_SCORE, load_scores
from aiwd.zeroshot.scorefiles import SCORE_SIGN, write_score_files


def features_frame() -> pd.DataFrame:
    nan = math.nan
    return pd.DataFrame(
        {
            "id": ["a", "b", "c"],
            "n_tokens": [40, 1, 12],
            "binoculars": [0.8, nan, 1.1],
            "fast_detectgpt": [3.0, nan, -1.0],
            "loglik": [-2.0, nan, -3.5],
            "logrank": [1.2, nan, 2.0],
        }
    )


def test_score_files_apply_signs_and_abstain(tmp_path):
    paths, abstained = write_score_files(features_frame(), "toy", tmp_path)
    assert abstained == ["b"]
    assert sorted(p.name for p in paths) == [
        "binoculars-toy.parquet", "fast-detectgpt-toy.parquet",
        "loglik-toy.parquet", "logrank-toy.parquet",
    ]  # fmt: skip
    bino = load_scores(tmp_path / "binoculars-toy.parquet").set_index("id")["score"]
    assert bino["a"] == -0.8 and bino["c"] == -1.1 and bino["b"] == ABSTAIN_SCORE
    rank = load_scores(tmp_path / "logrank-toy.parquet").set_index("id")["score"]
    assert rank["a"] == -1.2 and rank["b"] == ABSTAIN_SCORE
    fast = load_scores(tmp_path / "fast-detectgpt-toy.parquet").set_index("id")["score"]
    assert fast["a"] == 3.0
    assert set(SCORE_SIGN) == {"binoculars", "fast_detectgpt", "loglik", "logrank"}


def test_abstained_texts_are_never_flagged_and_reported():
    df = dataset(n_groups=400)
    scores = scores_for(df, 3.0)
    test_ai = df[(df["split"] == "test") & (df["y"] == 1)]["id"].iloc[:5]
    test_human = df[(df["split"] == "test") & (df["y"] == 0)]["id"].iloc[:2]
    base = evaluate_detector(df, scores, n_boot=20)
    abstain = scores["id"].isin(set(test_ai) | set(test_human))
    scores.loc[abstain, "score"] = ABSTAIN_SCORE
    report = evaluate_detector(df, scores, n_boot=20)
    assert report["protocol"]["n_abstained"] == {
        "calibration_human": 0, "test_human": 2, "test_ai": 5,
    }  # fmt: skip
    n_ai = report["overall"]["n_ai"]
    tpr_drop = base["overall"]["0.05"]["tpr"] - report["overall"]["0.05"]["tpr"]
    assert 0 < tpr_drop <= 5 / n_ai + 1e-12
    assert np.isfinite(report["overall"]["auroc"])
    md = to_markdown(report, "toy")
    assert "could not score 2 human and 5 AI texts; they count as not flagged" in md
    assert "Calibration split" not in md


def test_no_abstention_note_when_everything_is_scored():
    df = dataset(n_groups=400)
    md = to_markdown(evaluate_detector(df, scores_for(df, 1.0), n_boot=20), "toy")
    assert "could not score" not in md


def test_calibration_abstentions_are_reported_separately():
    df = dataset(n_groups=400)
    scores = scores_for(df, 2.0)
    calib_human = df[(df["split"] == "calibration") & (df["y"] == 0)]["id"].iloc[:3]
    scores.loc[scores["id"].isin(calib_human), "score"] = ABSTAIN_SCORE
    report = evaluate_detector(df, scores, n_boot=20)
    assert report["protocol"]["n_abstained"] == {
        "calibration_human": 3, "test_human": 0, "test_ai": 0,
    }  # fmt: skip
    md = to_markdown(report, "toy")
    assert "Calibration split: 3 human texts could not be scored" in md
    assert "Test split" not in md


def test_extreme_values_abstain_in_all_files(tmp_path):
    frame = features_frame()
    frame.loc[0, "binoculars"] = 5.5e31
    paths, abstained = write_score_files(frame, "toy", tmp_path)
    assert abstained == ["a", "b"]
    for p in paths:
        scores = load_scores(p).set_index("id")["score"]
        assert scores["a"] == ABSTAIN_SCORE and scores["c"] > ABSTAIN_SCORE
