import numpy as np
import pandas as pd
import pytest
from test_report import dataset, scores_for

from aiwd.eval.report import evaluate_detector, merge_scores, to_markdown
from aiwd.eval.subset import eval_subset, hash_uniform


def test_subset_is_all_humans_of_both_splits_and_test_ai_only():
    df = dataset(n_groups=300)
    sub = eval_subset(df)
    humans = df[df["split"].isin(["calibration", "test"]) & (df["y"] == 0)]
    test_ai = df[(df["split"] == "test") & (df["y"] == 1)]
    assert set(sub["id"]) == set(humans["id"]) | set(test_ai["id"])


def test_fraction_keeps_proportions_and_is_nested():
    df = dataset(n_groups=3000)
    full = eval_subset(df)
    quarter = eval_subset(df, ai_fraction=0.25)
    tenth = eval_subset(df, ai_fraction=0.1)
    assert set(tenth["id"]) <= set(quarter["id"]) <= set(full["id"])
    assert (quarter["y"] == 0).sum() == (full["y"] == 0).sum()
    ai_full = full[full["y"] == 1]
    ai_quarter = quarter[quarter["y"] == 1]
    assert len(ai_quarter) / len(ai_full) == pytest.approx(0.25, abs=0.03)
    share_full = ai_full["generator"].value_counts(normalize=True)
    share_quarter = ai_quarter["generator"].value_counts(normalize=True)
    assert np.allclose(share_full.sort_index(), share_quarter.sort_index(), atol=0.03)


def test_subset_does_not_depend_on_row_order():
    df = dataset(n_groups=300)
    a = eval_subset(df, ai_fraction=0.3)["id"].tolist()
    b = eval_subset(df.sample(frac=1, random_state=1), ai_fraction=0.3)["id"].tolist()
    assert a == b


def test_hash_uniform_range_and_seed():
    values = [hash_uniform(f"id{i}") for i in range(2000)]
    assert 0.0 <= min(values) and max(values) < 1.0
    assert np.mean(values) == pytest.approx(0.5, abs=0.03)
    assert hash_uniform("x", seed=0) != hash_uniform("x", seed=1)


@pytest.mark.parametrize("fraction", [0.0, -0.1, 1.5])
def test_invalid_fraction(fraction):
    with pytest.raises(ValueError):
        eval_subset(dataset(n_groups=10), ai_fraction=fraction)


def test_report_on_ai_fraction():
    df = dataset(n_groups=600)
    sub = eval_subset(df, ai_fraction=0.5)
    scores = scores_for(df, 2.0)
    scores = scores[scores["id"].isin(sub["id"])]
    report = evaluate_detector(df, scores, n_boot=20, ai_fraction=0.5)
    assert report["overall"]["n_ai"] == int((sub["y"] == 1).sum())
    assert report["protocol"]["ai_fraction"] == 0.5
    assert "50% sample of the test split" in to_markdown(report, "sub")
    with pytest.raises(ValueError, match="have no score"):
        evaluate_detector(df, scores, n_boot=20)


def test_a_detector_cannot_silently_skip_texts():
    df = dataset(n_groups=100)
    scores = scores_for(df, 1.0)
    ai_id = df[(df["split"] == "test") & (df["y"] == 1)]["id"].iloc[0]
    with pytest.raises(ValueError, match=r"1 documents to evaluate have no score \(0 human, 1 AI"):
        merge_scores(df, scores[scores["id"] != ai_id])


def test_extra_scores_are_ignored():
    df = dataset(n_groups=100)
    merged = merge_scores(df, scores_for(df, 1.0))
    assert len(merged) == len(eval_subset(df))


def test_frame_is_unchanged():
    df = dataset(n_groups=30)
    before = df.copy()
    eval_subset(df, ai_fraction=0.5)
    pd.testing.assert_frame_equal(df, before)
