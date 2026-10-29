"""Sample clean passages from public-domain books and newspapers in Common Corpus.

Usage (from backend/):
    uv run python scripts/build_common_corpus.py            # reads the cached parquet files
    uv run python scripts/build_common_corpus.py --per-doc 6

Download the parquet files first (about 430 MB each, cached by huggingface_hub):
    uv run python -c "from huggingface_hub import hf_hub_download as d; \\
        d('PleIAs/common_corpus', 'common_corpus_1/subset_100_1.parquet', repo_type='dataset')"

Writes data/style/passages_cc.jsonl in the same shape as passages.jsonl. Sampling is seeded.
"""

from __future__ import annotations

import argparse
import glob
import json
import re
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq

from aiwd.style.clean import word_count
from aiwd.style.commoncorpus import (
    COLUMNS,
    credit_for,
    document_passages,
    fix_mojibake,
    select_documents,
)
from aiwd.style.quality import load_vocabulary

BACKEND = Path(__file__).resolve().parents[1]
HUB = "~/.cache/huggingface/hub/datasets--PleIAs--common_corpus/snapshots"
CACHE = f"{HUB}/*/common_corpus_*/*.parquet"

# Most passages per (language, kind). Keeps the corpus balanced and the database small.
CAP = {("en", "book"): 9000, ("fr", "book"): 8000, ("en", "news"): 7000, ("fr", "news"): 5000}

_NORMAL = re.compile(r"[\W_]+")


def signature(text: str) -> str:
    """Same passage, different punctuation or spacing: reprints and syndicated articles."""
    return _NORMAL.sub("", text.lower())[:160]


def main() -> None:
    parser = argparse.ArgumentParser()
    cached = sorted(glob.glob(str(Path(CACHE).expanduser())))
    parser.add_argument("--files", nargs="*", default=cached)
    parser.add_argument("--out", default=str(BACKEND / "data/style/passages_cc.jsonl"))
    parser.add_argument("--per-doc", type=int, default=5)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()
    if not args.files:
        raise SystemExit("no parquet files found: see the docstring for how to download them")

    vocab = {lang: load_vocabulary(lang) for lang in ("en", "fr")}
    seen: set[str] = set()
    counts: Counter[tuple[str, str]] = Counter()
    by_collection: Counter[str] = Counter()
    rows: list[dict] = []

    for path in args.files:
        parquet = pq.ParquetFile(path)
        docs = select_documents(parquet.read(columns=COLUMNS).to_pandas())
        texts = parquet.read(columns=["text"]).column("text")
        print(f"{Path(path).name}: {len(docs)} candidate documents", flush=True)

        for index, doc in docs.iterrows():
            group = (doc["lang"], doc["kind"])
            if counts[group] >= CAP[group]:
                continue
            text = fix_mojibake(texts[index].as_py())
            key = f"{args.seed}-{doc['identifier']}"
            author, title = credit_for(doc)
            for number, passage in enumerate(
                document_passages(text, vocab[doc["lang"]], args.per_doc, key)
            ):
                sig = signature(passage)
                if sig in seen or counts[group] >= CAP[group]:
                    continue
                seen.add(sig)
                counts[group] += 1
                by_collection[doc["collection"]] += 1
                rows.append(
                    dict(
                        id=f"cc-{doc['identifier']}-{number}",
                        source="common-corpus",
                        collection=doc["collection"],
                        gutenberg_id=None,
                        year=int(doc["date"]),
                        author=author[:120],
                        title=title[:160],
                        lang=doc["lang"],
                        kind=doc["kind"],
                        n_words=word_count(passage),
                        text=passage,
                    )
                )  # fmt: skip
        del texts
        print(f"  -> {len(rows)} passages so far", flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"\n{len(rows)} passages -> {out}")
    for (lang, kind), n in sorted(counts.items()):
        print(f"  {lang} {kind}: {n} (cap {CAP[(lang, kind)]})")
    for collection, n in by_collection.most_common():
        print(f"  {collection}: {n}")


if __name__ == "__main__":
    main()
