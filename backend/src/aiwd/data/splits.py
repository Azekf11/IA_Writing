from __future__ import annotations

import hashlib
from collections.abc import Mapping

DEFAULT_WEIGHTS: Mapping[str, float] = {
    "train": 0.70,
    "val": 0.10,
    "calibration": 0.10,
    "test": 0.10,
}


def assign_split(
    group_id: str, weights: Mapping[str, float] = DEFAULT_WEIGHTS, seed: str = "v1"
) -> str:
    """Deterministic split from a hash of the group id.

    The same group always gets the same split, across runs and machines,
    so a human text and its AI counterparts can never leak across splits.
    """
    total = sum(weights.values())
    if total <= 0 or any(w < 0 for w in weights.values()):
        raise ValueError("weights must be non-negative and sum to a positive value")
    digest = hashlib.sha256(f"{seed}:{group_id}".encode()).digest()
    u = int.from_bytes(digest[:8], "big") / 2**64
    cumulative = 0.0
    for name, weight in weights.items():
        cumulative += weight / total
        if u < cumulative:
            return name
    return next(reversed(list(weights)))
