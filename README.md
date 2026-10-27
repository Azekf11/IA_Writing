# IA Writing

A bilingual (EN/FR) web app that suggests edits to make a text read naturally.
You review each edit, accept or reject it, then copy the result.

- `frontend/`: Next.js app (UI, `/api/rewrite`, Supabase auth, history, quota)
- `supabase/`: database migrations and a manual RLS check
- `backend/`: research code for AI-text detection (not used by the site yet)
- `PLAN.md`: long-term plan, including the detector
- `docs/DEPLOY.md`: Vercel and Supabase setup

## How a rewrite works

1. The user signs in with a magic link (Supabase Auth).
2. `POST /api/rewrite` checks the session and takes one unit of the daily quota.
3. Claude returns a list of `{original, replacement, reason}` edits, never a full rewrite.
4. The server finds each quote in the text to compute offsets, and drops any it can't find.
5. The edits are saved to the history and shown as a reviewable diff.

The Claude key stays on the server. If the call fails, the quota is refunded.

## Local development

```bash
# Database (needs Docker)
supabase start

# App
cd frontend
cp .env.example .env.local   # fill in the keys, see docs/DEPLOY.md
npm install
npm run dev                  # http://localhost:3000
```

Local magic-link emails show up in Mailpit at http://127.0.0.1:54324.

## Checks

```bash
cd frontend
npm run lint && npm run typecheck && npm test && npm run build
```

CI runs the same commands on every push and pull request touching `frontend/`.

To check row-level security and the quota functions against the local database:

```bash
docker exec -i supabase_db_IA_Writing psql -U postgres -d postgres < supabase/tests/rls_check.sql
```

## Conventions

- Comments are in English, short, and explain why rather than what.
- UI text lives only in `frontend/messages/{en,fr}.json`; a test enforces the same keys in both.
- Secrets never go in git. `frontend/.env.example` lists every variable.
