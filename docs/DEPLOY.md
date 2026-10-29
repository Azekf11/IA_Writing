# Deploy: Supabase + Vercel

Do these once, in this order. Keys go in dashboards, never in git.

## 1. Anthropic

1. Create an API key in the Anthropic Console.
2. Set a monthly spend limit there. It is your last line of defence, on top of the in-app daily quota.

## 2. Supabase (hosted)

1. Create a project. Pick the region closest to your users.
2. Link and push the schema from the repo root:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   Do not run `supabase config push`: `supabase/config.toml` holds local-only settings (localhost URLs, no email confirmation) and would overwrite your hosted Auth config. Change hosted settings in the dashboard instead.

3. Dashboard > Authentication > URL Configuration:
   - **Site URL**: your production URL, for example `https://rewrity.vercel.app`.
   - **Redirect URLs**: add `https://rewrity.vercel.app/**` and `http://localhost:3000/**`. For Vercel preview deployments, add `https://*-<your-team>.vercel.app/**`.
4. Dashboard > Authentication > Emails: the built-in mailer is rate limited. For real use, configure a custom SMTP provider.
5. Dashboard > Project Settings > API: copy the project URL and the **publishable** key.

## 3. Vercel

1. Import the GitHub repo.
2. Set **Root Directory** to `frontend`. Framework preset: Next.js.
3. Add these environment variables (Production and Preview):

   | Name                                   | Value                                     |
   | -------------------------------------- | ----------------------------------------- |
   | `ANTHROPIC_API_KEY`                    | your Anthropic key                        |
   | `ANTHROPIC_MODEL`                      | optional, defaults to `claude-sonnet-5-5` |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                      |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key                  |

4. Deploy, then open `/en` and `/fr` and run a full sign-in and rewrite.

## Smoke test

- `/` redirects to `/en` or `/fr` depending on the browser language.
- Signing in sends an email, and the link brings you back signed in.
- A rewrite returns edits; accepting one changes the result text.
- The history page lists the rewrite, and delete removes it.
- After `DAILY_LIMIT` rewrites (see `frontend/lib/rewrite/limits.ts`) the next one shows the quota message.
- A user can have at most `MAX_IN_FLIGHT` rewrites running at once; more get a "already running" message.
- Quota is taken with `reserve_quota()` and given back only with the reservation id (`release_quota()`), so a user cannot refund themselves by calling the API directly.

## Costs and safety

- Each rewrite costs one Claude call on up to 5000 characters. Lower `DAILY_LIMIT` or `MAX_CHARS` to cap spend.
- The route refuses to run without a signed-in user and a working quota check, so an unauthenticated visitor can never spend your key.
- Rotate the Anthropic key from the Console if it is ever exposed.
