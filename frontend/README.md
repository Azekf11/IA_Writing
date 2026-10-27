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
| `npm run format`    | Format all files (Prettier) |

## Deploy

Vercel project with root directory set to `frontend`.
Environment variables go in the Vercel dashboard, never in git.
