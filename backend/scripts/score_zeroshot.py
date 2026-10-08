"""Score the evaluation splits with Binoculars, Fast-DetectGPT, log-likelihood and log-rank.

One pass of two language models gives all four criteria. Needs the `ml` extra and,
for anything but the smallest pair, a GPU (see notebooks/zeroshot_colab.ipynb).

Usage (from backend/):
    uv run python scripts/score_zeroshot.py --pair qwen2.5-1.5b --limit 40   # smoke test
    uv run python scripts/score_zeroshot.py --pair qwen2.5-1.5b --ai-fraction 0.25
    uv run python scripts/score_zeroshot.py --pair falcon-7b --ai-fraction 0.25
Then evaluate with the same fraction:
    uv run python scripts/run_eval.py --name binoculars-qwen2.5-1.5b --ai-fraction 0.25 \\
        --scores data/scores/binoculars-qwen2.5-1.5b.parquet
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import pandas as pd
import torch

from aiwd.data.build import load_dataset
from aiwd.eval.scores import save_scores
from aiwd.eval.subset import eval_subset
from aiwd.normalize import normalize_text
from aiwd.zeroshot.criteria import SCORE_SIGN
from aiwd.zeroshot.lm_pair import MAX_TOKENS, PAIRS, load_pair, score_texts

BACKEND = Path(__file__).resolve().parents[1]
DTYPES = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pair", choices=sorted(PAIRS), default="qwen2.5-1.5b")
    parser.add_argument("--observer", help="custom base model (Hugging Face id or local path)")
    parser.add_argument("--performer", help="custom instruct model sharing its tokenizer")
    parser.add_argument("--name", help="name used in output files for a custom pair")
    parser.add_argument("--dataset", default=str(BACKEND / "data/datasets/raid-v1.parquet"))
    parser.add_argument(
        "--ai-fraction", type=float, default=1.0, help="share of the test AI texts to score"
    )
    parser.add_argument("--limit", type=int, default=None, help="score only N texts (smoke test)")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--max-tokens", type=int, default=MAX_TOKENS)
    parser.add_argument("--dtype", choices=sorted(DTYPES), default=None)
    args = parser.parse_args()

    try:
        dataset = load_dataset(args.dataset)
    except FileNotFoundError as e:
        raise SystemExit(str(e)) from None
    docs = eval_subset(dataset, args.ai_fraction)
    if args.limit:
        docs = docs.sample(n=min(args.limit, len(docs)), random_state=0).sort_values("id")
    print(f"{len(docs)} texts to score: {int((docs['y'] == 0).sum())} human, "
          f"{int((docs['y'] == 1).sum())} AI")  # fmt: skip

    if bool(args.observer) != bool(args.performer) or (args.observer and not args.name):
        raise SystemExit("a custom pair needs --observer, --performer and --name")
    observer, performer = (args.observer, args.performer) if args.observer else PAIRS[args.pair]
    pair_name = args.name or args.pair
    pair = load_pair(observer, performer, DTYPES.get(args.dtype), name=pair_name)
    print(f"observer on {pair.observer.device}, performer on {pair.performer.device}, "
          f"dtype {pair.observer.dtype}")  # fmt: skip

    def progress(done: int, total: int, elapsed: float) -> None:
        if done == total or done % (args.batch_size * 25) < args.batch_size:
            eta = elapsed / done * (total - done)
            print(
                f"  {done}/{total} texts, {elapsed / 60:.1f} min elapsed, ~{eta / 60:.1f} min left"
            )

    texts = [normalize_text(t).text for t in docs["text"]]
    results = score_texts(pair, texts, args.batch_size, args.max_tokens, progress)
    features = pd.DataFrame(results).assign(id=docs["id"].to_numpy())
    suffix = f"{pair_name}-smoke" if args.limit else pair_name
    out_features = BACKEND / "data/features" / f"zeroshot-{suffix}.parquet"
    out_features.parent.mkdir(parents=True, exist_ok=True)
    features.to_parquet(out_features, index=False)
    print(f"features -> {out_features}")

    finite = features["binoculars"].map(math.isfinite)
    if not finite.all():
        print(f"WARNING: {int((~finite).sum())} texts have fewer than 2 tokens and get no "
              f"score: {features.loc[~finite, 'id'].tolist()[:10]}")  # fmt: skip
    features = features[finite]
    for criterion, sign in SCORE_SIGN.items():
        name = f"{criterion.replace('_', '-')}-{suffix}"
        path = save_scores(
            BACKEND / "data/scores" / f"{name}.parquet",
            features["id"].tolist(),
            (sign * features[criterion]).tolist(),
        )
        print(f"scores -> {path}")


if __name__ == "__main__":
    main()
