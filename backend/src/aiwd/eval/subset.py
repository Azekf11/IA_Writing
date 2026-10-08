"""The documents a detector must score to be evaluated (PLAN.md section 14).

Thresholds only use the human texts of the calibration split, and TPR only uses the AI
texts of the test split, so those are the only documents to score: every human text of
both splits, plus the test AI texts. For detectors that are expensive to run, a fraction
of the test AI texts can be kept: each text is kept when a hash of its id falls below the
fraction, so the subset is deterministic, nested (a smaller fraction is a subset of a
larger one) and keeps the proportions of domains and generators (in expectation).
"""

from __future__ import annotations

import hashlib

import pandas as pd


def hash_uniform(doc_id: str, seed: int = 0) -> float:
    digest = hashlib.sha256(f"{seed}:{doc_id}".encode()).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


def eval_subset(
    dataset: pd.DataFrame,
    ai_fraction: float = 1.0,
    calibration_split: str = "calibration",
    test_split: str = "test",
    seed: int = 0,
) -> pd.DataFrame:
    if not 0.0 < ai_fraction <= 1.0:
        raise ValueError("ai_fraction must be in (0, 1]")
    humans = dataset[dataset["split"].isin([calibration_split, test_split]) & (dataset["y"] == 0)]
    test_ai = dataset[(dataset["split"] == test_split) & (dataset["y"] == 1)]
    if ai_fraction < 1.0:
        keep = [hash_uniform(i, seed) < ai_fraction for i in test_ai["id"]]
        test_ai = test_ai[keep]
    return pd.concat([humans, test_ai]).sort_values("id").reset_index(drop=True)
