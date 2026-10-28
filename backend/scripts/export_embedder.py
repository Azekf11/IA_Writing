"""Shrink the static embedding model and write it where the Next.js route can read it.

Usage (from backend/):
    uv run python scripts/export_embedder.py

Downloads ~430 MB once (Hugging Face cache), writes ~30 MB to frontend/data/embedder/.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from huggingface_hub import snapshot_download
from safetensors.numpy import load_file

from aiwd.style.embed import DIM, MODEL_ID, TOKENIZER_FILE, write_artifacts

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "frontend/data/embedder"))
    parser.add_argument("--dim", type=int, default=DIM)
    args = parser.parse_args()

    source = Path(snapshot_download(MODEL_ID, allow_patterns=["0_StaticEmbedding/*"]))
    weights = load_file(str(source / "0_StaticEmbedding/model.safetensors"))["embedding.weight"]
    tokenizer = source / "0_StaticEmbedding" / TOKENIZER_FILE
    meta = write_artifacts(Path(args.out), weights, tokenizer, args.dim)
    print(f"{meta['vocab']} tokens x {meta['dim']} dims -> {args.out}")
    for name, digest in meta["sha256"].items():
        print(f"  {name}: {digest[:16]}...")


if __name__ == "__main__":
    main()
