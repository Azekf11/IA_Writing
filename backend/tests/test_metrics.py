import numpy as np
import pytest

from aiwd.eval import (
    bootstrap_ci,
    evaluate,
    expected_calibration_error,
    fpr_upper_bound,
    roc_auc,
    threshold_at_fpr,
    tpr_at_fpr,
)


@pytest.mark.parametrize("n", [1, 7, 100, 999, 5000])
@pytest.mark.parametrize("target", [0.05, 0.01, 0.001])
def test_threshold_uses_the_full_fpr_budget(n, target):
    human = np.random.default_rng(n).normal(size=n)
    thr = threshold_at_fpr(human, target)
    assert (human > thr).sum() == int(np.floor(n * target + 1e-9))


def test_threshold_example_100_humans_at_1_percent():
    human = np.arange(100, dtype=float)
    assert threshold_at_fpr(human, 0.01) == 98.0
    assert (human > 98.0).sum() == 1


def test_threshold_with_discrete_scores_stays_under_budget():
    human = np.random.default_rng(4).integers(0, 5, size=1000).astype(float)
    for target in (0.01, 0.05, 0.2):
        assert (human > threshold_at_fpr(human, target)).mean() <= target


@pytest.mark.parametrize("bad", [[0.1, float("nan")], [[0.1, 0.2]], []])
def test_threshold_rejects_bad_human_scores(bad):
    with pytest.raises(ValueError):
        threshold_at_fpr(bad, 0.05)


def test_threshold_with_ties():
    assert threshold_at_fpr([1.0] * 50, 0.01) == 1.0


def test_perfect_detector():
    y = [0] * 100 + [1] * 100
    s = list(range(200))
    r = tpr_at_fpr(y, s, 0.01)
    assert r["tpr"] == 1.0 and r["fpr"] <= 0.01
    assert roc_auc(y, s) == 1.0


def test_inverted_detector_has_zero_auc():
    y = [0] * 10 + [1] * 10
    s = list(range(20, 0, -1))
    assert roc_auc(y, s) == 0.0


def test_random_detector_is_near_chance():
    rng = np.random.default_rng(1)
    y = np.array([0] * 4000 + [1] * 4000)
    s = rng.random(8000)
    assert abs(roc_auc(y, s) - 0.5) < 0.03
    assert tpr_at_fpr(y, s, 0.05)["tpr"] == pytest.approx(0.05, abs=0.02)


def test_rule_of_three():
    assert fpr_upper_bound(300) == pytest.approx(1 - 0.05 ** (1 / 300))
    assert fpr_upper_bound(300) == pytest.approx(3 / 300, rel=0.01)
    assert fpr_upper_bound(3000) == pytest.approx(0.001, rel=0.01)
    assert fpr_upper_bound(10, 10) == 1.0
    assert fpr_upper_bound(1000, 5) > fpr_upper_bound(1000, 0)
    assert fpr_upper_bound(1000, 5) > 5 / 1000


def test_ece_single_class_and_bins():
    assert expected_calibration_error([1, 1, 1], [1.0, 1.0, 1.0]) == 0.0
    with pytest.raises(ValueError):
        expected_calibration_error([0, 1], [0.2, 0.8], n_bins=0)


def test_ece_calibrated_vs_overconfident():
    rng = np.random.default_rng(2)
    p = rng.random(20000)
    y = (rng.random(20000) < p).astype(int)
    assert expected_calibration_error(y, p) < 0.02
    overconfident = np.where(p > 0.5, 1.0, 0.0)
    assert expected_calibration_error(y, overconfident) > 0.2


def test_bootstrap_is_ordered_and_deterministic():
    rng = np.random.default_rng(3)
    y = np.array([0] * 200 + [1] * 200)
    s = np.concatenate([rng.normal(0, 1, 200), rng.normal(1, 1, 200)])
    a = bootstrap_ci(roc_auc, y, s, n_boot=200, seed=7)
    b = bootstrap_ci(roc_auc, y, s, n_boot=200, seed=7)
    assert a == b
    low, point, high = a
    assert low <= point <= high


def test_grouped_bootstrap_is_wider_when_groups_are_duplicated():
    rng = np.random.default_rng(5)
    base_y = np.array([0] * 40 + [1] * 40)
    base_s = np.concatenate([rng.normal(0, 1, 40), rng.normal(1, 1, 40)])
    y, s = np.repeat(base_y, 5), np.repeat(base_s, 5)
    groups = np.repeat(np.arange(80).astype(str), 5)
    low_i, _, high_i = bootstrap_ci(roc_auc, y, s, n_boot=300, seed=0)
    low_g, _, high_g = bootstrap_ci(roc_auc, y, s, n_boot=300, seed=0, groups=groups)
    assert high_g - low_g > 1.5 * (high_i - low_i)
    assert bootstrap_ci(roc_auc, y, s, n_boot=50, seed=1, groups=groups) == bootstrap_ci(
        roc_auc, y, s, n_boot=50, seed=1, groups=groups
    )


def test_evaluate_upper_bound_uses_fpr_budget():
    y = [0] * 300 + [1] * 300
    s = list(range(600))
    report = evaluate(y, s, fprs=(0.01,))
    assert report["fpr_upper95@0.01"] == pytest.approx(fpr_upper_bound(300, 3))


def test_evaluate_report_keys():
    y = [0] * 50 + [1] * 50
    s = list(range(100))
    report = evaluate(y, s)
    assert report["n_human"] == 50 and report["n_ai"] == 50
    for key in ["auroc", "tpr@0.01", "fpr@0.01", "fpr_upper95@0.01", "tpr@0.05", "threshold@0.05"]:
        assert key in report


@pytest.mark.parametrize(
    "y, s",
    [
        ([0, 1, 2], [0.1, 0.2, 0.3]),
        ([0, 0, 0], [0.1, 0.2, 0.3]),
        ([0, 1], [0.1]),
        ([0, 1], [0.1, float("nan")]),
    ],
)
def test_invalid_inputs_raise(y, s):
    with pytest.raises(ValueError):
        evaluate(y, s)


@pytest.mark.parametrize("rate", [0.0, 1.0, -0.1, 1.5])
def test_invalid_target_fpr(rate):
    with pytest.raises(ValueError):
        threshold_at_fpr([0.1, 0.2], rate)
