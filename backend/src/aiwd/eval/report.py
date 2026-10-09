"""Held-out evaluation of a detector on a frozen dataset.

Protocol (PLAN.md section 14): thresholds are chosen on the human texts of the
calibration split with the split-conformal rule (expected FPR on new texts <= target),
then frozen and applied to the test split. The reported test FPR is an honest
out-of-sample estimate, with a Clopper-Pearson upper bound.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import pandas as pd

from aiwd.data.build import LENGTH_BUCKETS, LONGEST_BUCKET
from aiwd.eval.metrics import bootstrap_ci, conformal_threshold, fpr_upper_bound, roc_auc
from aiwd.eval.scores import ABSTAIN_SCORE
from aiwd.eval.subset import eval_subset


def merge_scores(
    dataset: pd.DataFrame,
    scores: pd.DataFrame,
    calibration_split: str = "calibration",
    test_split: str = "test",
    ai_fraction: float = 1.0,
) -> pd.DataFrame:
    """The documents of the evaluation subset (aiwd.eval.subset), with their scores.

    Every one of them must be scored: a detector cannot silently skip texts.
    Scores of other documents are ignored.
    """
    expected = eval_subset(dataset, ai_fraction, calibration_split, test_split)
    merged = expected.merge(scores, on="id", how="left", validate="one_to_one")
    missing = merged["score"].isna()
    if missing.any():
        n_human = int((missing & (merged["y"] == 0)).sum())
        raise ValueError(
            f"{int(missing.sum())} documents to evaluate have no score ({n_human} human, "
            f"{int(missing.sum()) - n_human} AI; ai_fraction={ai_fraction:g})"
        )
    return merged


def _rates(human: np.ndarray, ai: np.ndarray, threshold: float) -> dict:
    out: dict = {"n_human": int(human.size), "n_ai": int(ai.size)}
    if ai.size:
        out["tpr"] = float((ai > threshold).mean())
    if human.size:
        n_fp = int((human > threshold).sum())
        out["fpr"] = n_fp / human.size
        out["fpr_upper95"] = fpr_upper_bound(int(human.size), n_fp)
    return out


def _slice(part: pd.DataFrame, humans: pd.DataFrame, thresholds: dict[str, float]) -> dict:
    """Metrics of one slice; `humans` is the human reference for AUROC (and FPR)."""
    ai = part.loc[part["y"] == 1, "score"].to_numpy(dtype=float)
    human = humans["score"].to_numpy(dtype=float)
    out: dict = {"n_human": int(human.size), "n_ai": int(ai.size)}
    if ai.size and human.size:
        y = np.r_[np.zeros(human.size), np.ones(ai.size)]
        out["auroc"] = roc_auc(y, np.r_[human, ai])
    for target, thr in thresholds.items():
        out[target] = _rates(human, ai, thr)
    return out


def evaluate_detector(
    dataset: pd.DataFrame,
    scores: pd.DataFrame,
    fprs: Sequence[float] = (0.01, 0.05),
    calibration_split: str = "calibration",
    test_split: str = "test",
    n_boot: int = 500,
    seed: int = 0,
    ai_fraction: float = 1.0,
) -> dict:
    df = merge_scores(dataset, scores, calibration_split, test_split, ai_fraction)
    abstain = df["score"] <= ABSTAIN_SCORE
    calib_human = df[(df["split"] == calibration_split) & (df["y"] == 0)]["score"]
    if calib_human.empty:
        raise ValueError(f"no human texts in the {calibration_split!r} split")
    thresholds: dict[str, float] = {}
    allowed: dict[str, int] = {}
    for t in fprs:
        thresholds[f"{t:g}"], allowed[f"{t:g}"] = conformal_threshold(
            calib_human.to_numpy(dtype=float), t
        )

    test = df[df["split"] == test_split]
    test_human = test[test["y"] == 0]
    if test_human.empty or (test["y"] == 1).sum() == 0:
        raise ValueError(f"the {test_split!r} split needs both human and AI texts")

    overall = _slice(test, test_human, thresholds)
    low, _, high = bootstrap_ci(
        roc_auc, test["y"], test["score"], n_boot=n_boot, seed=seed, groups=test["group_id"]
    )
    overall["auroc_ci95"] = [low, high]

    report: dict = {
        "protocol": {
            "calibration_split": calibration_split,
            "test_split": test_split,
            "n_calibration_human": int(calib_human.size),
            "ai_fraction": ai_fraction,
            "n_abstained": {
                "calibration_human": int((abstain & (df["split"] == calibration_split)).sum()),
                "test_human": int((abstain & (df["split"] == test_split) & (df["y"] == 0)).sum()),
                "test_ai": int((abstain & (df["split"] == test_split) & (df["y"] == 1)).sum()),
            },
            "thresholds": thresholds,
            "calibration_humans_above_threshold": allowed,
            "threshold_rule": "split conformal: k = floor(target * (n + 1)) - 1",
            "flag_rule": "score > threshold",
        },
        "overall": overall,
        "by_domain": {},
        "by_generator": {},
        "by_decoding": {},
        "by_length_bucket": {},
    }
    for domain, part in test.groupby("domain"):
        report["by_domain"][str(domain)] = _slice(part, part[part["y"] == 0], thresholds)
    order = [name for _, name in LENGTH_BUCKETS] + [LONGEST_BUCKET]
    buckets = dict(list(test.groupby("length_bucket")))
    for bucket in sorted(buckets, key=lambda b: order.index(b) if b in order else len(order)):
        part = buckets[bucket]
        report["by_length_bucket"][str(bucket)] = _slice(part, part[part["y"] == 0], thresholds)
    ai = test[test["y"] == 1]
    for column, key in (("generator", "by_generator"), ("decoding", "by_decoding")):
        for value, part in ai.groupby(column):
            report[key][str(value)] = _slice(part, test_human, thresholds)
    return report


def _cell(value: str) -> str:
    """Escape characters that would break a Markdown table cell."""
    return str(value).replace("|", "\\|").replace("\n", " ")


def _fmt(value: float | None, pct: bool = True) -> str:
    if value is None:
        return "-"
    return f"{100 * value:.1f}" if pct else f"{value:.3f}"


def _too_few_humans(n_human: int, target: float) -> bool:
    """True if even 0 false positives could not show FPR <= target at 95 % confidence."""
    return n_human == 0 or fpr_upper_bound(n_human, 0) > target


def to_markdown(report: dict, name: str) -> str:
    targets = list(report["protocol"]["thresholds"])
    strictest = min(float(t) for t in targets)
    o = report["overall"]
    lines = [
        f"# Evaluation: {name}",
        "",
        f"Thresholds calibrated on {report['protocol']['n_calibration_human']} human texts "
        f"of the `{report['protocol']['calibration_split']}` split (split-conformal rule), "
        f"applied to `{report['protocol']['test_split']}` ({o['n_human']} human, {o['n_ai']} AI).",
        "",
    ]
    abstained = report["protocol"].get("n_abstained", {})
    if abstained.get("test_human") or abstained.get("test_ai"):
        lines += [
            f"Test split: the detector could not score {abstained['test_human']} human and "
            f"{abstained['test_ai']} AI texts; they count as not flagged (and rank lowest "
            "in the AUROC).",
            "",
        ]
    if abstained.get("calibration_human"):
        lines += [
            f"Calibration split: {abstained['calibration_human']} human texts could not be "
            "scored; they sit below every threshold.",
            "",
        ]
    fraction = report["protocol"].get("ai_fraction", 1.0)
    if fraction < 1.0:
        lines += [
            f"AI texts: a deterministic {100 * fraction:g}% sample of the test split "
            "(proportions of domains and generators kept); all human texts are scored.",
            "",
        ]
    lines += [
        f"AUROC: **{_fmt(o.get('auroc'), pct=False)}** "
        f"(95% CI {_fmt(o['auroc_ci95'][0], pct=False)}-{_fmt(o['auroc_ci95'][1], pct=False)})",
        "",
        "| Target FPR | TPR (%) | Test FPR (%) | FPR upper 95% (%) |",
        "|---|---|---|---|",
    ]
    for t in targets:
        r = o[t]
        lines.append(
            f"| {100 * float(t):g}% | {_fmt(r['tpr'])} | {_fmt(r['fpr'])} | "
            f"{_fmt(r['fpr_upper95'])} |"
        )
    sections = (
        ("by_domain", "Domain"),
        ("by_generator", "Generator (vs all test humans)"),
        ("by_decoding", "Decoding (vs all test humans)"),
        ("by_length_bucket", "Length (words)"),
    )
    rate_headers = []
    for t in targets:
        pct = f"{100 * float(t):g}%"
        rate_headers += [f"TPR@{pct}", f"FPR@{pct}", f"FPR up95@{pct}"]
    for key, title in sections:
        if not report[key]:
            continue
        lines += [
            "",
            f"## {title}",
            "",
            f"| {title.split(' ')[0]} | n human | n AI | AUROC | "
            + " | ".join(rate_headers)
            + " |",
            "|" + "---|" * (4 + len(rate_headers)),
        ]
        for value, r in report[key].items():
            cells = []
            for t in targets:
                rates = r[t]
                cells += [
                    _fmt(rates.get("tpr")),
                    _fmt(rates.get("fpr")),
                    _fmt(rates.get("fpr_upper95")),
                ]
            mark = " \u2020" if _too_few_humans(r["n_human"], strictest) else ""
            lines.append(
                f"| {_cell(value)}{mark} | {r['n_human']} | {r['n_ai']} | "
                f"{_fmt(r.get('auroc'), pct=False)} | " + " | ".join(cells) + " |"
            )
    need = math.ceil(math.log(0.05) / math.log(1 - strictest))
    while _too_few_humans(need, strictest):
        need += 1
    lines += [
        "",
        "Rates are percentages. FPR up95 is the 95% upper bound on the true FPR.",
        f"\u2020 fewer than {need} human texts: even with zero false positives this slice cannot "
        f"show an FPR below {100 * strictest:g}%.",
        "",
    ]
    return "\n".join(lines)
