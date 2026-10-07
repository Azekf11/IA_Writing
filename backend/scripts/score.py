"""Score the calibration and test splits with a detector and save a score file.

Usage (from backend/):
    uv run python scripts/score.py --detector random
    uv run python scripts/score.py --detector length
"""

from __future__ import annotations

import argparse
from pathlib import Path

from aiwd.data.build import load_dataset
from aiwd.eval.baselines import length_scores, random_scores
from aiwd.eval.scores import save_scores
from aiwd.normalize import normalize_text

BACKEND = Path(__file__).resolve().parents[1]

DETECTORS = {
    "random": random_scores,
    "length": length_scores,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detector", choices=sorted(DETECTORS), required=True)
    parser.add_argument("--dataset", default=str(BACKEND / "data/datasets/raid-v1.parquet"))
    parser.add_argument("--splits", nargs="+", default=["calibration", "test"])
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    try:
        df = load_dataset(args.dataset)
    except FileNotFoundError as e:
        raise SystemExit(str(e)) from None
    df = df[df["split"].isin(args.splits)].sort_values("id")
    texts = [normalize_text(t).text for t in df["text"]]
    scores = DETECTORS[args.detector](texts)
    out = args.out or BACKEND / "data/scores" / f"{args.detector}.parquet"
    out = save_scores(out, df["id"].tolist(), scores)
    print(f"scored {len(df)} documents -> {out}")


if __name__ == "__main__":
    main()
