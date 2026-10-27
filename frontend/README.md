# IA Writing: frontend

Next.js app (App Router, TypeScript, Tailwind) deployed on Vercel.
Rewrites text with Claude and stores history in Supabase.

## Setup

```bash
cp .env.example .env.local   # then fill in your keys
npm install
npm run dev                  # http://localhost:3000
```

## Scripts

| Command             | What it does                |
| ------------------- | --------------------------- |
| `npm run dev`       | Start the dev server        |
| `npm run build`     | Production build            |
| `npm run lint`      | ESLint                      |
| `npm run typecheck` | TypeScript check, no emit   |
| `npm run test`      | Unit tests (Vitest)         |
| `npm run format`    | Format all files (Prettier) |

## i18n

English and French via `next-intl`, with prefixed routes (`/en`, `/fr`).
The locale comes from the URL, then the `NEXT_LOCALE` cookie, then `Accept-Language`.

- Texts live in `messages/en.json` and `messages/fr.json`, never in components.
- English is the source of truth: keys are type-checked against it.
- A test fails if the two files do not have the same keys.
- To add a language: add it in `i18n/routing.ts` and create `messages/<locale>.json`.

## Deploy

Vercel project with root directory set to `frontend`.
Environment variables go in the Vercel dashboard, never in git.
