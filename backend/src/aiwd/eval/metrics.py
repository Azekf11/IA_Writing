"""Evaluation metrics for AI-text detectors.

Conventions: y_true is 1 for AI-generated text and 0 for human text;
scores are "higher = more likely AI". Negate a detector's output first if needed
(Binoculars, for example, gives lower scores to AI text).
Thresholds are exclusive: a text is flagged when score > threshold
(RAID's official evaluation uses >=, so do not mix thresholds between the two).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

import numpy as np
from scipy.stats import beta
from sklearn.metrics import roc_auc_score

ArrayLike = Sequence[float] | np.ndarray


def _labels_and_values(y_true: ArrayLike, values: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
    y = np.asarray(y_true)
    v = np.asarray(values, dtype=float)
    if y.shape != v.shape or y.ndim != 1:
        raise ValueError("y_true and scores must be 1-D arrays of the same length")
    if y.size == 0:
        raise ValueError("inputs are empty")
    if not np.isin(y, (0, 1)).all():
        raise ValueError("y_true must only contain 0 (human) and 1 (AI)")
    if not np.isfinite(v).all():
        raise ValueError("scores must be finite")
    return y.astype(int), v


def _as_arrays(y_true: ArrayLike, scores: ArrayLike) -> tuple[np.ndarray, np.ndarray]:
    y, s = _labels_and_values(y_true, scores)
    if (y == 0).sum() == 0 or (y == 1).sum() == 0:
        raise ValueError("both classes (human and AI) must be present")
    return y, s


def _check_rate(rate: float, name: str) -> None:
    if not 0.0 < rate < 1.0:
        raise ValueError(f"{name} must be in (0, 1), got {rate}")


def _allowed_false_positives(n_human: int, target_fpr: float) -> int:
    return math.floor(n_human * target_fpr + 1e-9)


def threshold_at_fpr(human_scores: ArrayLike, target_fpr: float) -> float:
    """Lowest observed threshold with at most floor(n * target_fpr) human scores above it."""
    _check_rate(target_fpr, "target_fpr")
    s = np.asarray(human_scores, dtype=float)
    if s.ndim != 1 or s.size == 0:
        raise ValueError("human_scores must be a non-empty 1-D array")
    if not np.isfinite(s).all():
        raise ValueError("human_scores must be finite")
    s = np.sort(s)
    k = _allowed_false_positives(s.size, target_fpr)
    return float(s[s.size - 1 - k])


def conformal_threshold(human_scores: ArrayLike, target_fpr: float) -> tuple[float, int]:
    """Threshold to apply to NEW texts, with expected FPR <= target_fpr (split conformal).

    Allows k = floor(target * (n + 1)) - 1 calibration humans above the threshold.
    Returns (threshold, k). Raises if there are too few humans (n < 1 / target - 1).
    """
    _check_rate(target_fpr, "target_fpr")
    s = np.asarray(human_scores, dtype=float)
    if s.ndim != 1 or s.size == 0:
        raise ValueError("human_scores must be a non-empty 1-D array")
    if not np.isfinite(s).all():
        raise ValueError("human_scores must be finite")
    k = math.floor(target_fpr * (s.size + 1) + 1e-9) - 1
    if k < 0:
        need = math.ceil(1 / target_fpr - 1)
        raise ValueError(
            f"{s.size} calibration humans are too few for a {target_fpr:g} FPR target "
            f"(need at least {need})"
        )
    s = np.sort(s)
    return float(s[s.size - 1 - k]), k


def tpr_at_fpr(y_true: ArrayLike, scores: ArrayLike, target_fpr: float) -> dict[str, float]:
    """TPR at a threshold calibrated on the human scores (in-sample)."""
    y, s = _as_arrays(y_true, scores)
    threshold = threshold_at_fpr(s[y == 0], target_fpr)
    return {
        "threshold": threshold,
        "tpr": float((s[y == 1] > threshold).mean()),
        "fpr": float((s[y == 0] > threshold).mean()),
    }


def roc_auc(y_true: ArrayLike, scores: ArrayLike) -> float:
    y, s = _as_arrays(y_true, scores)
    return float(roc_auc_score(y, s))


def fpr_upper_bound(n_human: int, n_false_positives: int = 0, confidence: float = 0.95) -> float:
    """One-sided Clopper-Pearson upper bound on the true FPR.

    With 0 false positives this equals 1 - (1 - confidence) ** (1 / n), close to 3 / n at 95 %.
    """
    if n_human <= 0:
        raise ValueError("n_human must be positive")
    if not 0 <= n_false_positives <= n_human:
        raise ValueError("n_false_positives must be between 0 and n_human")
    _check_rate(confidence, "confidence")
    if n_false_positives == n_human:
        return 1.0
    return float(beta.ppf(confidence, n_false_positives + 1, n_human - n_false_positives))


def expected_calibration_error(y_true: ArrayLike, probs: ArrayLike, n_bins: int = 15) -> float:
    """ECE with equal-width bins over [0, 1]; probs are calibrated P(AI)."""
    if n_bins < 1:
        raise ValueError("n_bins must be >= 1")
    y, p = _labels_and_values(y_true, probs)
    if ((p < 0) | (p > 1)).any():
        raise ValueError("probs must be in [0, 1]")
    bins = np.minimum((p * n_bins).astype(int), n_bins - 1)
    ece = 0.0
    for b in range(n_bins):
        mask = bins == b
        if mask.any():
            ece += mask.mean() * abs(y[mask].mean() - p[mask].mean())
    return float(ece)


def bootstrap_ci(
    metric: Callable[[np.ndarray, np.ndarray], float],
    y_true: ArrayLike,
    scores: ArrayLike,
    n_boot: int = 1000,
    alpha: float = 0.05,
    seed: int = 0,
    groups: Sequence[str] | None = None,
) -> tuple[float, float, float]:
    """(low, point estimate, high) percentile bootstrap.

    Without `groups`, texts are resampled independently within each class.
    With `groups` (e.g. Document.group_id), whole groups are resampled, which keeps
    intervals honest when several texts share a prompt or source.
    """
    y, s = _as_arrays(y_true, scores)
    _check_rate(alpha, "alpha")
    if n_boot < 1:
        raise ValueError("n_boot must be >= 1")
    rng = np.random.default_rng(seed)
    if groups is None:
        idx_human, idx_ai = np.flatnonzero(y == 0), np.flatnonzero(y == 1)

        def draw() -> np.ndarray:
            return np.concatenate(
                [rng.choice(idx_human, idx_human.size), rng.choice(idx_ai, idx_ai.size)]
            )
    else:
        g = np.asarray(groups)
        if g.shape != y.shape:
            raise ValueError("groups must have the same length as y_true")
        members = [np.flatnonzero(g == key) for key in np.unique(g)]

        def draw() -> np.ndarray:
            picked = rng.integers(0, len(members), len(members))
            return np.concatenate([members[i] for i in picked])

    values = np.empty(n_boot)
    for b in range(n_boot):
        for _ in range(100):
            idx = draw()
            if 0 < y[idx].sum() < idx.size:
                break
        else:
            raise ValueError("could not draw a resample containing both classes")
        values[b] = metric(y[idx], s[idx])
    low, high = np.quantile(values, [alpha / 2, 1 - alpha / 2])
    return float(low), float(metric(y, s)), float(high)


def evaluate(
    y_true: ArrayLike, scores: ArrayLike, fprs: Sequence[float] = (0.01, 0.05)
) -> dict[str, float]:
    """Headline metrics: AUROC, then threshold, TPR, observed FPR and a 95 % FPR upper bound.

    The threshold is chosen on these same human texts, so the upper bound uses
    k = floor(n_human * target), which is exact for an in-sample order statistic.
    To estimate the FPR of a frozen threshold, apply it to a held-out split instead.
    """
    y, s = _as_arrays(y_true, scores)
    n_human = int((y == 0).sum())
    report: dict[str, float] = {
        "n_human": n_human,
        "n_ai": int((y == 1).sum()),
        "auroc": roc_auc(y, s),
    }
    for target in fprs:
        r = tpr_at_fpr(y, s, target)
        report[f"threshold@{target:g}"] = r["threshold"]
        report[f"tpr@{target:g}"] = r["tpr"]
        report[f"fpr@{target:g}"] = r["fpr"]
        report[f"fpr_upper95@{target:g}"] = fpr_upper_bound(
            n_human, _allowed_false_positives(n_human, target)
        )
    return report
