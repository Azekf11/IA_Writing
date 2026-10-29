"""Week 1 sanity check: load a balanced RAID sample and evaluate trivial detectors.

Usage (from backend/):
    uv run python scripts/sanity_check_raid.py --per-domain 200
    uv run python scripts/sanity_check_raid.py --csv ~/Downloads/train_none.csv
"""

from __future__ import annotations

import argparse
import json
from collections import Counter

from aiwd.data.raid import load_raid
from aiwd.eval.baselines import length_scores, random_scores
from aiwd.eval.metrics import bootstrap_ci, evaluate, roc_auc
from aiwd.normalize import normalize_text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-domain", type=int, default=200)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--csv", default=None, help="local RAID CSV (skips the download)")
    args = parser.parse_args()

    docs = load_raid(
        "train",
        include_adversarial=False,
        sample_per_domain=args.per_domain,
        seed=args.seed,
        path=args.csv,
    )
    print(f"{len(docs)} documents:", dict(Counter(d.label for d in docs)))
    print("domains:", dict(Counter(d.domain for d in docs)))

    texts = [normalize_text(d.text).text for d in docs]
    y = [d.y for d in docs]
    groups = [d.group_id for d in docs]

    for name, scores in [
        ("random", random_scores(texts, args.seed)),
        ("length", length_scores(texts)),
    ]:
        report = evaluate(y, scores)
        low, _, high = bootstrap_ci(roc_auc, y, scores, n_boot=300, seed=args.seed, groups=groups)
        report["auroc_ci95"] = [round(low, 3), round(high, 3)]
        print(f"\n== {name} ==")
        print(
            json.dumps(
                {k: round(v, 4) if isinstance(v, float) else v for k, v in report.items()}, indent=2
            )
        )


if __name__ == "__main__":
    main()
