"""Embed data/style/passages*.jsonl and upsert it into a Supabase project.

Usage (from backend/):
    export SUPABASE_URL=http://127.0.0.1:54321
    export SUPABASE_SECRET_KEY=...
    uv run python scripts/ingest_style.py

The secret key bypasses row-level security: keep it in your shell, never in git or in Vercel.
Get it with `supabase status -o env` (local) or Dashboard > Settings > API Keys (hosted).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from aiwd.style.embed import Embedder
from aiwd.style.ingest import batches, read_passages, to_rows, upsert

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"


def main() -> None:
    parser = argparse.ArgumentParser()
    names = ("passages.jsonl", "passages_cc.jsonl")
    default = [str(BACKEND / "data/style" / name) for name in names]
    parser.add_argument("--passages", nargs="+", default=default)
    parser.add_argument("--embedder", default=str(ROOT / "frontend/data/embedder"))
    parser.add_argument("--dry-run", action="store_true", help="embed but do not write")
    args = parser.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SECRET_KEY")
    if not args.dry_run and not (url and key):
        raise SystemExit("set SUPABASE_URL and SUPABASE_SECRET_KEY (or use --dry-run)")

    files = [Path(path) for path in args.passages if Path(path).exists()]
    passages = [passage for path in files for passage in read_passages(path)]
    embedder = Embedder.load(Path(args.embedder))
    rows = list(to_rows(passages, embedder))
    print(f"{len(rows)} of {len(passages)} passages embedded ({embedder.dim} dims)")
    if args.dry_run:
        return

    written = 0
    for batch in batches(rows):
        upsert(url, key, batch)
        written += len(batch)
        print(f"  {written}/{len(rows)}", end="\r")
    print(f"\nupserted {written} rows into {url}")


if __name__ == "__main__":
    main()
