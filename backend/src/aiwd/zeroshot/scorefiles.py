"""Turn the features of a zero-shot run into score files. Needs no torch.

A text with fewer than 2 tokens cannot be scored (there is no next token to predict), nor
can one whose criteria are non-finite: the detector abstains on it, and an abstention counts
as "not flagged".
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from aiwd.eval.scores import ABSTAIN_SCORE, save_scores

# Direction of each criterion as a score file ("higher = more likely AI").
SCORE_SIGN = {"binoculars": -1.0, "fast_detectgpt": 1.0, "loglik": 1.0, "logrank": -1.0}
# Values this large only come from degenerate logits; treating them as abstentions keeps
# ABSTAIN_SCORE below every real score and the four files consistent.
EXTREME = 1e29


def write_score_files(
    features: pd.DataFrame, suffix: str, out_dir: str | Path
) -> tuple[list[Path], list[str]]:
    """Write one score file per criterion; return their paths and the abstained ids."""
    values = features[list(SCORE_SIGN)].to_numpy(dtype=float)
    with np.errstate(invalid="ignore"):
        scored = (np.isfinite(values) & (np.abs(values) < EXTREME)).all(axis=1)
    ids = features["id"].astype(str).tolist()
    paths = []
    for column, (criterion, sign) in enumerate(SCORE_SIGN.items()):
        scores = np.where(scored, sign * values[:, column], ABSTAIN_SCORE)
        name = f"{criterion.replace('_', '-')}-{suffix}.parquet"
        paths.append(save_scores(Path(out_dir) / name, ids, scores))
    abstained = [i for i, ok in zip(ids, scored, strict=True) if not ok]
    return paths, abstained
