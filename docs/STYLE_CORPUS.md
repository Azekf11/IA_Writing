# Style corpus and vector search

The rewriter shows Claude a few excerpts of good prose as a guide to rhythm and
concreteness. Claude does not learn from them: they are looked up per request
(retrieval), then dropped into the prompt.

```
Gutenberg books -> clean passages -> embeddings -> pgvector -> top 3 -> Claude prompt
```

## Sources

- Public-domain books from Project Gutenberg, picked by hand in
  `backend/src/aiwd/style/books.py` (123 books, English and French, fiction and
  essays). No Wikipedia, no web scraping, no translations.
- Title, author, language and death year are read from the official Gutenberg
  catalog, never typed by hand. The build stops if an author died after 1955.
- Excerpts stay on the server. The browser only receives author and title.

## Rebuild from scratch

From `backend/`:

```bash
uv sync --extra ml --group dev

# 1. Catalog (once), kept out of git
mkdir -p data/style
curl -o data/style/pg_catalog.csv https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv

# 2. Download the books (cached in data/style/raw) and sample passages
uv run python scripts/build_style_corpus.py            # -> data/style/passages.jsonl

# 3. Shrink the embedding model into frontend/data/embedder (committed, ~29 MB)
uv run python scripts/export_embedder.py

# 4. Embed and load into Supabase
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SECRET_KEY=...     # Dashboard > Settings > API Keys. Never commit it.
uv run python scripts/ingest_style.py                  # --dry-run to check first
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

- The search always returns the nearest passages, however far they are. A text
  about business gets loosely related excerpts (similarity around 0.25). There is
  no minimum score yet.
- Measured on the corpus itself (not on rewrite quality): 96% of neighbours are
  in the same language, 80% are the same kind (fiction or essay), and 19% come
  from the same book against 0.8% by chance.
- Nobody has measured whether the references make rewrites better. Compare
  rewrites with and without `STYLE_REFERENCES=off` on texts you know well.
