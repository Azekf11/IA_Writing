# Style corpus and vector search

The rewriter shows Claude a few excerpts of published prose as a guide to rhythm and
concreteness. Claude does not learn from them: they are looked up per request
(retrieval), then dropped into the prompt.

```
sources -> clean passages -> embeddings -> pgvector -> top 3 -> Claude prompt
```

## Sources

| Source | What | Period | Script |
| ------ | ---- | ------ | ------ |
| Project Gutenberg | 123 hand-picked books and essays, en/fr | 1600s to 1950 | `build_style_corpus.py` |
| Common Corpus (Pleias) | Public-domain books and newspapers, en/fr | 1531 to 1950 | `build_common_corpus.py` |
| C4 realnewslike | News articles from reputable sites, en | crawled 2019 | `build_web_corpus.py` |
| FineWeb-2 | News and magazine pages, fr | crawls 2013 to 2022 | `build_web_corpus.py` |

The web sources are filtered to the sites listed in `backend/src/aiwd/style/web.py`
(press, magazines, public broadcasters). Editing that list is the editorial control:
add or remove a domain and rebuild. No single site may exceed 12% of its language.

Why crawls stop at 2022: from late 2022 a growing share of web text is written by language
models, which would defeat the point of a human-written reference. This is a cut-off by
date, not a detector: some earlier text may still have been machine-assisted.

Other rules, whatever the source:
- Gutenberg metadata (title, author, language, death year) comes from its official catalog,
  and the build stops if an author died after 1955. Gutenberg forbids automated downloads
  from its website, so books are read from disk (see `aiwd/style/gutenberg.py`).
- Book, newspaper and web text is OCR or HTML, so every passage goes through the noise filter
  in `aiwd/style/quality.py` and is deduplicated.
- Excerpts stay on the server. The browser only receives an author, a site or a title.

## Rebuild from scratch

From `backend/`:

```bash
uv sync --extra ml --group dev

# 1. Catalog (once), kept out of git
mkdir -p data/style
curl -o data/style/pg_catalog.csv https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv

# 2. Download the books (cached in data/style/raw) and sample passages
uv run python scripts/build_style_corpus.py            # -> data/style/passages.jsonl

# 2b. Same for the other sources (parquet files are cached by huggingface_hub)
uv run python scripts/build_vocab.py                   # word lists for the noise filter
uv run python scripts/build_common_corpus.py           # -> data/style/passages_cc.jsonl
uv run python scripts/build_web_corpus.py              # -> data/style/passages_web.jsonl

# 3. Shrink the embedding model into frontend/data/embedder (committed, ~29 MB)
uv run python scripts/export_embedder.py

# 4. Embed and load into Supabase
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SECRET_KEY=...     # Dashboard > Settings > API Keys. Never commit it.
uv run python scripts/ingest_style.py                  # every passages*.jsonl; --dry-run first
```

Step 4 is safe to repeat: rows are upserted by id.

## How it fits together

| Piece | Where |
| ----- | ----- |
| Passage cleaning and sampling (seeded) | `backend/src/aiwd/style/clean.py` |
| Static multilingual embeddings, int8, 256 dims | `backend/src/aiwd/style/embed.py` |
| Same maths in the Next.js route | `frontend/lib/style/embedder.ts` |
| Table, HNSW index, `match_style_passages()` | `supabase/migrations/20261029000000_style_passages.sql` |
| Lookup and prompt assembly | `frontend/lib/style/retrieve.ts`, `frontend/lib/rewrite/prompt.ts` |

- Model: `sentence-transformers/static-similarity-mrl-multilingual-v1` (Apache-2.0).
  First 256 of 1024 dimensions, stored as int8 with one scale per token.
- `frontend/tests/embedder.test.ts` checks that the TypeScript vectors match the
  Python ones. If you change the model or dimension, regenerate
  `frontend/tests/fixtures/embedder-parity.json` (see `backend/tests`).
- The table has no grants for `anon` or `authenticated`. Signed-in users only
  reach it through `match_style_passages()`, which returns at most 10 rows.
- Set `STYLE_REFERENCES=off` in Vercel to switch the references off without a
  deploy of new code. The rewrite then works as before.

## Known limits

- The corpus holds 45,527 passages (online, 161 MB of the 500 MB free limit):
  Gutenberg 4,920, Common Corpus 24,607, recent news 16,000 (9,000 en, 7,000 fr).
- The search always returns the nearest passages, however far they are. A text
  about business gets loosely related excerpts (similarity around 0.35), and code
  or gibberish still scores 0.2 to 0.33. Measured, so no threshold separates
  related from unrelated; `MIN_SIMILARITY` (0.2) only drops the weakest matches.
- Recent French web text covers crawls from 2013 to 2022, and English news is a
  single 2019 crawl. Neither is guaranteed human-written: the 2022 cut-off lowers
  the risk, it does not remove it.
- Measured on the corpus itself (not on rewrite quality): 96% of neighbours are
  in the same language, 80% are the same kind (fiction or essay), and 19% come
  from the same book against 0.8% by chance.
- Nobody has measured whether the references make rewrites better. Compare
  rewrites with and without `STYLE_REFERENCES=off` on texts you know well.
