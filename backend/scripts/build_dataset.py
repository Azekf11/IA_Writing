"""Build the frozen dataset v1 from RAID.

Usage (from backend/):
    uv run python scripts/build_dataset.py
    uv run python scripts/build_dataset.py --csv ~/.cache/raid/train_none.csv --per-domain 500
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aiwd.data.build import build_raid_dataset, save_dataset
from aiwd.data.raid import cache_dir

BACKEND = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=str(cache_dir() / "train_none.csv"))
    parser.add_argument("--per-domain", type=int, default=500)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=str(BACKEND / "data/datasets/raid-v1.parquet"))
    args = parser.parse_args()

    csv = Path(args.csv).expanduser()
    if not csv.is_file():
        raise SystemExit(f"{csv} not found: download it first (see aiwd/data/raid.py)")
    df, manifest = build_raid_dataset(
        csv, per_domain=args.per_domain, seed=args.seed, name=Path(args.out).stem
    )
    out, manifest_path = save_dataset(df, manifest, args.out)
    print(
        json.dumps(
            {
                k: manifest[k]
                for k in ("n_rows", "n_groups", "n_sources_merged_by_title", "counts", "dropped")
            },
            indent=2,
        )
    )
    print(f"\nwrote {out} and {manifest_path}")
    print(f"content_sha256 = {manifest['content_sha256']}")


if __name__ == "__main__":
    main()
