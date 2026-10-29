"""Trivial detectors used to sanity-check the evaluation pipeline.

A random detector must land near AUROC 0.5. If the length detector scores far
from 0.5, the dataset has a length shortcut that a real model could exploit.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np


def random_scores(texts: Sequence[str], seed: int = 0) -> list[float]:
    rng = np.random.default_rng(seed)
    return rng.random(len(texts)).tolist()


def length_scores(texts: Sequence[str]) -> list[float]:
    return [float(len(t.split())) for t in texts]
