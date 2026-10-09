"""Rebuild the score files of a zero-shot run from its saved features (no GPU, no torch).

Usage (from backend/):
    uv run python scripts/rescore_zeroshot.py data/features/zeroshot-qwen2.5-1.5b.parquet
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from aiwd.data.build import load_dataset
from aiwd.zeroshot.scorefiles import write_score_files

BACKEND = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("features", help="data/features/zeroshot-<pair>.parquet")
    parser.add_argument("--dataset", default=str(BACKEND / "data/datasets/raid-v1.parquet"))
    args = parser.parse_args()

    path = Path(args.features).expanduser()
    if not path.stem.startswith("zeroshot-") or path.suffix != ".parquet":
        raise SystemExit(f"{path.name} is not a zeroshot-<pair>.parquet features file")
    if not path.is_file():
        raise SystemExit(
            f"{path} not found: run this from backend/ (the file comes from the Colab zip)"
        )
    features = pd.read_parquet(path)
    suffix = path.stem.removeprefix("zeroshot-")
    paths, abstained = write_score_files(features, suffix, BACKEND / "data/scores")
    for p in paths:
        print(f"scores -> {p}")
    if abstained:
        print(f"\n{len(abstained)} texts could not be scored and count as not flagged:")
        try:
            dataset = load_dataset(args.dataset).set_index("id")
        except FileNotFoundError:
            dataset = None
        n_tokens = features.set_index("id")["n_tokens"]
        for doc_id in abstained:
            line = f"  {doc_id}: {int(n_tokens[doc_id])} token(s)"
            if dataset is not None and doc_id in dataset.index:
                row = dataset.loc[doc_id]
                line += (
                    f" [{row['label']}, {row['generator']}, {row['domain']}] {row['text'][:80]!r}"
                )
            print(line)


if __name__ == "__main__":
    main()
