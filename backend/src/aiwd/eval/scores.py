"""Score files: one row per document, columns `id` and `score` (higher = more likely AI).

Every detector, local or run on a remote GPU, writes this format; run_eval reads it.
A detector that cannot score a text abstains: the text gets ABSTAIN_SCORE, lower than any
real score, so it is never flagged (an abstention counts as "not AI").
"""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pandas as pd

ABSTAIN_SCORE = -1e30


def save_scores(path: str | Path, ids: Sequence[str], scores: Sequence[float]) -> Path:
    path = Path(path)
    if len(ids) != len(scores):
        raise ValueError("ids and scores must have the same length")
    df = pd.DataFrame({"id": [str(i) for i in ids], "score": np.asarray(scores, dtype=float)})
    _validate(df)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == ".csv":
        df.to_csv(path, index=False)
    else:
        df.to_parquet(path, index=False)
    return path


def load_scores(path: str | Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix == ".csv":
        df = pd.read_csv(
            path,
            dtype={"id": str},
            keep_default_na=False,
            na_values={"score": ["", "nan", "NaN", "NA"]},
        )
    else:
        df = pd.read_parquet(path)
    missing = {"id", "score"} - set(df.columns)
    if missing:
        raise ValueError(f"{path} is missing columns {sorted(missing)}")
    df = df[["id", "score"]].assign(id=lambda d: d["id"].astype(str))
    _validate(df)
    return df


def _validate(df: pd.DataFrame) -> None:
    if df["id"].duplicated().any():
        raise ValueError("duplicate ids in scores")
    if not np.isfinite(df["score"].to_numpy(dtype=float)).all():
        raise ValueError("scores must be finite (no NaN or inf)")
