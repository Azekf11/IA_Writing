"""Evaluate a score file on the frozen dataset and write a JSON + Markdown report.

Usage (from backend/):
    uv run python scripts/run_eval.py --scores data/scores/random.parquet --name random
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from aiwd.data.build import load_dataset
from aiwd.eval.report import evaluate_detector, to_markdown
from aiwd.eval.scores import load_scores

BACKEND = Path(__file__).resolve().parents[1]


ZEROSHOT_CRITERIA = ("binoculars", "fast-detectgpt", "loglik", "logrank")


def _rescore_hint(message: str, scores: str) -> str:
    """Point to rescore_zeroshot.py when a zero-shot run predates abstentions."""
    stem = Path(scores).stem
    criterion = next((c for c in ZEROSHOT_CRITERIA if stem.startswith(c + "-")), None)
    if "have no score" not in message or criterion is None:
        return ""
    features = BACKEND / "data/features" / f"zeroshot-{stem.removeprefix(criterion + '-')}.parquet"
    if not features.is_file():
        return ""
    return (
        "\nThese zero-shot score files may come from a run that dropped unscoreable texts. "
        f"Rebuild them with:\n  uv run python scripts/rescore_zeroshot.py {features}"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scores", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--dataset", default=str(BACKEND / "data/datasets/raid-v1.parquet"))
    parser.add_argument("--out-dir", default=str(BACKEND / "reports"))
    parser.add_argument("--fprs", type=float, nargs="+", default=[0.01, 0.05])
    parser.add_argument(
        "--ai-fraction", type=float, default=1.0, help="same value as used when scoring"
    )
    args = parser.parse_args()

    try:
        dataset, scores = load_dataset(args.dataset), load_scores(args.scores)
        report = evaluate_detector(dataset, scores, args.fprs, ai_fraction=args.ai_fraction)
    except (FileNotFoundError, ValueError) as e:
        raise SystemExit(f"error: {e}{_rescore_hint(str(e), args.scores)}") from None
    report["detector"] = args.name
    report["dataset"] = str(args.dataset)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{args.name}.json").write_text(json.dumps(report, indent=2) + "\n")
    markdown = to_markdown(report, args.name)
    (out_dir / f"{args.name}.md").write_text(markdown)
    print(markdown)


if __name__ == "__main__":
    main()
