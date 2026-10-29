"""Build the word lists the OCR filter uses, from the hand-checked Gutenberg books.

Usage (from backend/), after build_style_corpus.py has the books in data/style/raw:
    uv run python scripts/build_vocab.py

Writes data/style/vocab_en.txt and vocab_fr.txt (the 40,000 most frequent words of each language).
"""

from __future__ import annotations

from aiwd.style.books import KIND_BY_ID
from aiwd.style.catalog import load_catalog
from aiwd.style.gutenberg import read_book, strip_boilerplate
from aiwd.style.quality import DATA_DIR, build_vocabulary


def main() -> None:
    catalog = load_catalog(DATA_DIR / "pg_catalog.csv")
    books = {gid: strip_boilerplate(read_book(gid, DATA_DIR / "raw")) for gid in KIND_BY_ID}
    for lang in ("en", "fr"):
        texts = [text for gid, text in books.items() if catalog[gid].lang == lang]
        vocabulary = build_vocabulary(texts)
        lines = "\n".join(sorted(vocabulary)) + "\n"
        (DATA_DIR / f"vocab_{lang}.txt").write_text(lines, encoding="utf-8")
        print(f"{lang}: {len(texts)} books -> {len(vocabulary)} words")


if __name__ == "__main__":
    main()
