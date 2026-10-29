"""Sample clean passages from recent journalism: C4 realnewslike (en), FineWeb-2 (fr).

Usage (from backend/):
    uv run python scripts/build_web_corpus.py
    uv run python scripts/build_web_corpus.py --per-article 4 --fr-files 8

Only pages from the news and magazine sites listed in aiwd/style/web.py, and crawls up to 2022,
are used. Writes data/style/passages_web.jsonl in the same shape as the other corpora. Seeded.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from aiwd.style.clean import spread, word_count
from aiwd.style.commoncorpus import fix_mojibake, reject_reason, windows
from aiwd.style.quality import dehyphenate, load_vocabulary
from aiwd.style.web import clean_article, registered_domain, usable_article
from aiwd.style.webreaders import english_articles, french_articles

BACKEND = Path(__file__).resolve().parents[1]

# Passages per language, and the share one site may take (so no outlet dominates)
CAP = {"en": 9000, "fr": 7000}
PER_SITE_SHARE = 0.12

_NORMAL = re.compile(r"[\W_]+")


def signature(text: str) -> str:
    """Same passage with different punctuation: syndicated or repeated text."""
    return _NORMAL.sub("", text.lower())[:160]


def passages_of(article: dict, vocab: frozenset[str], per_article: int, seed: int) -> list[str]:
    body = clean_article(fix_mojibake(article["text"]))
    if not usable_article(body):
        return []
    pool = [w for w in windows(dehyphenate(body, vocab)) if reject_reason(w, vocab) is None]
    key = f"{seed}-{article['id']}"
    return [pool[i] for i in spread(len(pool), per_article, key)]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(BACKEND / "data/style/passages_web.jsonl"))
    parser.add_argument("--per-article", type=int, default=4)
    parser.add_argument("--en-articles", type=int, default=200000)
    parser.add_argument("--fr-files", type=int, default=36)
    parser.add_argument("--fr-groups", type=int, default=12)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    sources = {
        "en": english_articles(args.en_articles),
        "fr": french_articles(args.fr_files, args.fr_groups),
    }
    seen: set[str] = set()
    rows: list[dict] = []

    for lang, articles in sources.items():
        vocab = load_vocabulary(lang)
        per_site: Counter[str] = Counter()
        site_cap = int(CAP[lang] * PER_SITE_SHARE)
        count = 0
        for article in articles:
            if count >= CAP[lang]:
                break
            domain = registered_domain(article["url"])
            if per_site[domain] >= site_cap:
                continue
            for number, text in enumerate(passages_of(article, vocab, args.per_article, args.seed)):
                signature_ = signature(text)
                if signature_ in seen or count >= CAP[lang] or per_site[domain] >= site_cap:
                    continue
                seen.add(signature_)
                count += 1
                per_site[domain] += 1
                rows.append(
                    dict(
                        id=f"web-{article['id']}-{number}",
                        source="web",
                        collection=domain,
                        gutenberg_id=None,
                        year=article["year"],
                        author=domain,
                        title=domain,
                        lang=lang,
                        kind="news",
                        n_words=word_count(text),
                        text=text,
                    )
                )  # fmt: skip
        print(f"{lang}: {count} passages from {len(per_site)} sites", flush=True)
        print("  ", dict(per_site.most_common(8)), flush=True)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    years = Counter(row["year"] for row in rows)
    print(f"\n{len(rows)} passages -> {out}\nyears: {sorted(years.items())}")


if __name__ == "__main__":
    main()
