# Deploy

Supabase, then Vercel, with a spending cap at Anthropic first. Keys go in dashboards, never in git.

## 1. Anthropic

1. Create an API key in the Anthropic console.
2. **Set a monthly spending limit there.** The limits in the database cap the number of calls, not
   the money. This is the only real cap on what the key can spend.

## 2. Supabase

1. Create a project. Vercel's function is pinned to Dublin (`frontend/vercel.json`), so pick
   `eu-west-1` or change that file to match. The route makes several database calls per request.
2. Apply the schema from the repository root:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   Do not run `supabase config push`: `supabase/config.toml` holds local settings (localhost URLs, no
   email confirmation) and would overwrite the hosted ones.

3. Authentication > URL Configuration:
   - **Site URL:** your production URL, for example `https://rewrity.vercel.app`.
   - **Redirect URLs:** `https://rewrity.vercel.app/**` and `http://localhost:3000/**`.
4. Authentication > Emails: the built-in mailer is heavily rate limited. It is fine for a small demo.
   For anything else, configure your own SMTP.
5. Settings > API Keys: copy the project URL and the **publishable** key. The secret key is only for
   loading the corpus from your machine and never goes in Vercel.
6. Database > Extensions: leave `pg_graphql` off. The app does not use it, and one long GraphQL document
   could hold the quota lock for seconds (see `docs/ARCHITECTURE.md`).

## 3. Vercel

1. Import the GitHub repository.
2. Set **Root Directory** to `frontend`. Framework preset: Next.js. Node.js 22 or newer: the route uses
   `Promise.withResolvers`, and CI runs on 24.
3. Add the variables for Production and Preview:

   | Name                                   | Value                                      |
   | -------------------------------------- | ------------------------------------------ |
   | `ANTHROPIC_API_KEY`                    | Your Anthropic key                         |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                       |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key                   |
   | `ANTHROPIC_MODEL`                      | Optional, defaults to `claude-sonnet-5-5`  |
   | `STYLE_REFERENCES`                     | Optional, `off` removes the style excerpts |

   Vercel applies a changed variable to new deployments, so redeploy after changing one.

4. Deploy, then run the checks below.

## After a deployment

Checks 3 and 5 spend real attempts on purpose: a wrong key or model name fails every call, and each
failure counts against the day's allowance.

1. `/` redirects to `/en` or `/fr` according to the browser language.
2. Sign in: the email arrives and its link, opened in the same browser, brings you back signed in.
3. Run a rewrite: edits appear, and accepting one changes the result. The history page lists it, and
   deleting removes it.
4. In the SQL editor, check that the ticket closed:

   ```sql
   select state, count(*) from public.quota_reservations group by state;
   ```

5. Run a rewrite on a long text and press Stop after the first edit. The same query should then show
   one more `cancelled` ticket within seconds, and a new rewrite should start right away. If the ticket
   ends as `succeeded` instead, the model kept writing after Stop: `supportsCancellation` in
   `frontend/vercel.json` did not take effect. Nothing has checked this on a deployment yet.
6. Check where the function runs: a response to `POST /api/rewrite` with an empty JSON body is a 400
   that spends nothing, and its `x-vercel-id` header should name `dub1`.

## Applying a migration to a running site

The quota migration (`20261105000000_quota_policy.sql`) changes function signatures that the app calls.

1. **Before anything else,** set the Anthropic spending limit.
2. Check what the new ceilings will see, since requests already counted carry over:

   ```sql
   select
     coalesce(sum(count) filter (where day = (now() at time zone 'utc')::date), 0) as today,
     coalesce(sum(count) filter (
       where day >= date_trunc('month', now() at time zone 'utc')::date
     ), 0) as this_month
   from public.usage;
   ```

   If `today` is 15 or more, or `this_month` 300 or more, rewrites are refused for everyone right
   after the migration, until the day or the month ends or the limits are raised.

3. Merge, wait for the production deployment, then run `supabase db push` straight away. Between
   the two, the app and the database do not share the same functions, so rewrites fail with an error
   **before** any model call. Nothing is spent, but the site cannot rewrite during that window, and
   previews that use the production database fail the same way.
4. Run the checks above.

Migrations are named with dates ahead of the real calendar. A new one must sort after the last file in
`supabase/migrations`, so choose its timestamp by hand rather than relying on `supabase migration new`.

## Changing the limits

One row, no deploy. In the SQL editor:

```sql
select * from public.quota_limits;
update public.quota_limits set user_daily = 10, global_daily = 30;
```

To see how the budget is being used:

```sql
select * from public.usage_global order by day desc limit 31;
```

## What is set where

| Setting                                                                           | Where                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Tables, RLS, grants, functions, quota limits (initial values)                     | `supabase/migrations`, versioned                                                         |
| Function region, duration and cancellation, security headers                      | `frontend/vercel.json`, `frontend/next.config.ts`, versioned                             |
| Local Supabase settings                                                           | `supabase/config.toml`, versioned, **local only**                                        |
| Current quota limits                                                              | Database row, SQL editor                                                                 |
| Monthly spending limit, key rotation                                              | Anthropic console                                                                        |
| Extensions (`pg_graphql` stays off)                                               | Supabase dashboard, Database                                                             |
| Environment variables, root directory, firewall rules                             | Vercel dashboard                                                                         |
| Site URL, redirect URLs, sign-ups, email confirmation, SMTP, rate limits, captcha | Supabase dashboard, Authentication                                                       |
| JWT signing keys                                                                  | Supabase dashboard. With asymmetric keys the route checks signatures locally (see below) |

With asymmetric keys the route still fetches the public keys from Supabase on a cold instance, and
caches them for 10 minutes. With the legacy shared secret it calls Supabase Auth on every request.

The sign-in email comes from one project-wide template in the Supabase dashboard (Authentication >
Emails). To serve both languages, write it in both.

Do not turn on captcha in the Supabase dashboard without changing the sign-in form first: it sends no
captcha token, so every sign-in would be refused.

Nothing in this repository can tell you the state of the console settings. Check them directly,
especially the spending limit, whether sign-ups are open, and the email rate limit.

If the Anthropic key is ever exposed, rotate it in the console and update Vercel.
