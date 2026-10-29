"""Sample clean prose passages from the curated Gutenberg books.

Usage (from backend/):
    uv run python scripts/build_style_corpus.py
    uv run python scripts/build_style_corpus.py --per-book 40 --seed 0

The catalog (data/style/pg_catalog.csv) is Gutenberg's machine-readable catalog, and the books
must already be in data/style/raw/<id>.txt (see aiwd/style/gutenberg.py for how to get them).
Sampling is seeded, so the same books give the same passages on every run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

from aiwd.style.books import KIND_BY_ID
from aiwd.style.catalog import load_catalog
from aiwd.style.clean import sample_passages, word_count
from aiwd.style.gutenberg import read_book, strip_boilerplate

BACKEND = Path(__file__).resolve().parents[1]
STYLE_DIR = BACKEND / "data/style"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default=str(STYLE_DIR / "pg_catalog.csv"))
    parser.add_argument("--raw", default=str(STYLE_DIR / "raw"))
    parser.add_argument("--out", default=str(STYLE_DIR / "passages.jsonl"))
    parser.add_argument("--per-book", type=int, default=40)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    catalog_path = Path(args.catalog)
    if not catalog_path.is_file():
        raise SystemExit(f"{catalog_path} not found: see the docstring for where to get it")
    catalog = load_catalog(catalog_path)

    rows: list[dict] = []
    for gutenberg_id, kind in sorted(KIND_BY_ID.items()):
        book = catalog.get(gutenberg_id)
        # The list is hand-written, so every entry is re-checked against the catalog
        if book is None or not book.public_domain or book.lang not in ("en", "fr"):
            raise SystemExit(f"book {gutenberg_id} is missing, not public domain or not en/fr")

        raw = strip_boilerplate(read_book(gutenberg_id, Path(args.raw)))
        passages = sample_passages(gutenberg_id, raw, args.per_book, args.seed)
        print(f"{gutenberg_id:>6} {book.author[:22]:<22} {book.title[:40]:<40} {len(passages):>3}")
        for passage in passages:
            rows.append(
                dict(
                    id=f"{gutenberg_id}-{passage.position}",
                    gutenberg_id=gutenberg_id,
                    position=passage.position,
                    author=book.author,
                    title=book.title,
                    lang=book.lang,
                    kind=kind,
                    n_words=word_count(passage.text),
                    text=passage.text,
                    sha256=hashlib.sha256(passage.text.encode()).hexdigest(),
                )
            )  # fmt: skip

    # The same text must never be stored twice (reprints, repeated refrains)
    unique = list({row["sha256"]: row for row in rows}.values())
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in unique:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    by = Counter((row["lang"], row["kind"]) for row in unique)
    n_books = len({row["gutenberg_id"] for row in unique})
    print(f"\n{len(unique)} passages from {n_books} books -> {out}")
    for (lang, kind), count in sorted(by.items()):
        print(f"  {lang} {kind}: {count}")


if __name__ == "__main__":
    main()
