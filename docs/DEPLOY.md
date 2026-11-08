# Deploy

Supabase, then Vercel, with a spending cap at Anthropic first. Keys go in dashboards, never in git.

**Manual** marks what happens in a console or on the hosted project, or calls the real model. Nothing in
this repository can do those steps or check them, and no local test stands in for them.

## Two separate ceilings

|              | SQL limits                                                                           | Spending limit                              |
| ------------ | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| Caps         | Attempts: 5 per account per UTC day, 2 at once, 15 per day and 300 per month overall | Money, per month                            |
| Lives in     | One row of `public.quota_limits`                                                     | The app's own workspace at Anthropic        |
| Acts         | Before any model call, for requests that come through the route                      | At Anthropic, whatever uses the key         |
| Cannot see   | Tokens, prices, another model, the key used elsewhere                                | Who is asking, or how the day's places went |
| Changed with | One SQL `update`, no deployment                                                      | The Claude Console                          |

The SQL limits bound the bill only indirectly. At today's prices, an attempt costs at most about $0.09 on
ordinary prose and about $0.125 at worst, so 15 attempts a day and 300 a month come to at most about
$1.90 and $38 ([how that is estimated](ARCHITECTURE.md#what-one-attempt-costs)). The spending limit is
what still holds when one of those assumptions fails, so set it just above that, for example $40 a month.

## 1. Anthropic

**Manual.** In the [Claude Console](https://platform.claude.com/settings/workspaces):

1. Create a workspace for this app and nothing else. The Default Workspace cannot have a spending limit.
2. Select it and open **Spend limits**: set the monthly limit and alerts at the thresholds you want.
3. Create the API key inside that workspace. Use no key from another workspace on the site.

To check them:

- The workspace's panel shows the limit and the thresholds, and the list of API keys shows the key under
  that workspace. After the smoke test below, the console's Usage page should show its calls under that
  workspace too.
- Anthropic's documentation says where alerts are set, not who receives them, so try one: lower a threshold
  to just above the month's spending, run one attempt, confirm that the alert reaches you, and put it back.
- Once the limit is reached, the API answers HTTP 400, saying that the workspace's usage limits are reached.
  The route logs `Anthropic API error 400` and shows its usual error, and the attempt stays counted. Pause the
  site ([below](#pausing-the-site)) if that happens.

Console names as documented by Anthropic on 4 November 2026; they can change.

## 2. Supabase

**Manual,** all of it.

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
5. Settings > API Keys: copy the project URL and the **publishable** key, and create a **secret key for
   the route alone**, for example `rewrity-route`. It goes in Vercel, Production only. Loading the corpus
   from your machine uses a different one, so that each can be rotated without the other.
6. Database > Extensions: leave `pg_graphql` off. The app does not use it.
7. The sign-up settings, under Authentication. This public endpoint shows the current state:

   ```bash
   curl -s "https://<your-project-ref>.supabase.co/auth/v1/settings" -H "apikey: <publishable key>"
   ```

   `disable_signup: false` means that any email address can create an account, and
   `mailer_autoconfirm: false` that a new address has to confirm by email. The ceilings hold however many
   accounts exist, but three accounts can use up a day's places for everyone. For a demo that needs no new
   accounts, close sign-ups once yours exist. Email rate limits are not in that answer: read them under
   Authentication > Rate Limits.

## 3. Vercel

**Manual,** all of it.

1. Import the GitHub repository.
2. Set **Root Directory** to `frontend`. Framework preset: Next.js. Node.js 22 or newer: the route uses
   `Promise.withResolvers`, and CI runs on 24.
3. Add the variables. **The two secrets go in Production only,** so that a preview cannot spend or reach
   the database as the server:

   | Name                                   | Value                                                                              | Environments        |
   | -------------------------------------- | ---------------------------------------------------------------------------------- | ------------------- |
   | `ANTHROPIC_API_KEY`                    | The key from the app's workspace                                                   | Production          |
   | `SUPABASE_SECRET_KEY`                  | The route's secret key                                                             | Production          |
   | `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                                               | Production, Preview |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key                                                           | Production, Preview |
   | `STYLE_REFERENCES`                     | `off` until the [corpus rights](STYLE_CORPUS.md#licences-and-credits) are reviewed | Production          |
   | `ANTHROPIC_MODEL`                      | Optional, defaults to `claude-sonnet-5-5`                                          | Production          |

   Vercel applies a changed variable to new deployments, so redeploy after changing one. The home page's
   note and the privacy page are built with `STYLE_REFERENCES`, so that one takes a deployment anyway.

4. Deploy, then run the smoke test below.

**Manual,** preview isolation. The variables page should show the two secrets ticked for Production alone.
Then open a preview deployment, signing in to Vercel if its deployment protection asks but not to the app, and
run this in the browser's console. Without a session in the app, it spends nothing whatever the answer:

```js
(
  await fetch("/api/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"text":"x"}',
  })
).status;
```

`401` means that both secrets have reached previews, and only the missing app session stopped it there.
`503` means that at least one is missing, which is the answer you want but does not clear the other, so the
variables page stays the check for each secret.

## After a deployment

A smoke test on production. **Manual.** One run makes three real model calls, a rewrite in check 3 and two in
check 5, about $0.27 at most, and uses three of the account's five attempts for the day. They are worth it: a
wrong key or model name fails every call, and each failure counts against the day's allowance.

1. `/` redirects to `/en` or `/fr` according to the browser language.
2. **Connection.** Sign in: the email arrives and its link, opened in the same browser, brings you back
   signed in.
3. **Generation.** Run a rewrite: edits appear, and accepting one changes the result. The history page
   lists it, and deleting removes it. Vercel's logs for that request hold one line
   `Rewrite attempt {"state":"succeeded","model":"claude-sonnet-5-5",...,"input_tokens":...}`, with the
   tokens that price the attempt and no text. With `STYLE_REFERENCES=off`, that line says `"references":0`
   and the home page has no section "Where the style references come from".
4. In the SQL editor, check that the ticket closed:

   ```sql
   select state, count(*) from public.quota_reservations group by state;
   ```

5. **Cancellation.** Run a rewrite on a long text and press Stop after the first edit. The same query
   should then show one more `cancelled` ticket within seconds, the log line should say
   `"state":"cancelled"`, with no output count since the answer was cut short, and a new rewrite should start
   right away. If the ticket ends as `succeeded`
   instead, the model kept writing after Stop: `supportsCancellation` in `frontend/vercel.json` did not take
   effect. Nothing has checked this on a deployment yet.
6. Check where the function runs: a response to `POST /api/rewrite` with an empty JSON body is a 400
   that spends nothing, and its `x-vercel-id` header should name `dub1`.
7. Check the bound on the body. This prints `413` and spends nothing:

   ```bash
   head -c 50000 /dev/zero | tr '\0' 'a' | curl -s -o /dev/null -w '%{http_code}\n' --data-binary @- https://<your-domain>/api/rewrite
   ```

## Moving a running site to server-only operations

The quota functions and the corpus search used to be open to signed-in browsers. Two migrations move them
to the server. Run them apart, because the app has to change between the two:

| File                                        | What it does                                         | App versions that work with it |
| ------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| `20261106000000_server_quota_functions.sql` | Adds the server's functions next to the old ones     | Old and new                    |
| `20261107000000_close_direct_access.sql`    | Drops the old functions and closes the direct insert | New only                       |

A new project needs none of this: `supabase db push` applies both, and the app only knows the new functions.

Each file goes in a version of its own. The first holds `20261106000000_server_quota_functions.sql`, the new
app and the tests that pass on both schemas. The second adds `20261107000000_close_direct_access.sql`, with
`supabase/tests/access.test.mjs` and `frontend/audit/suites/limits.mjs`, which check the closed state and fail
without it. `limits.mjs` also brings the audit's two HTTP checks of the 40,000-byte bound on the body, which
pass on either schema; in the first version, `frontend/tests/rewrite-route.test.ts` checks that bound.

**Manual,** all of it:

1. Set the Anthropic spending limit if that is not done, create the route's secret key
   ([Supabase, step 5](#2-supabase)) and add it to Vercel as `SUPABASE_SECRET_KEY`, Production only
   ([above](#3-vercel)). Remove `ANTHROPIC_API_KEY` from Preview, where the earlier guide put it. Without
   `SUPABASE_SECRET_KEY` the new version refuses every rewrite with a 503. Set `STYLE_REFERENCES=off` there too
   unless the corpus has been reviewed, since a site that leaves it unset keeps sending excerpts.
2. From the first version, run `supabase db push --dry-run`: it should list
   `20261106000000_server_quota_functions.sql` alone. Then run `supabase db push`, which applies it. The running
   site keeps calling the old functions.
3. Merge that version and wait for the production deployment. From here the route calls the new functions.
   An attempt still running on the old version ends on the old ones, which work on the same tickets and
   counters.
4. Run the smoke test.
5. Wait at least 90 seconds after the deployment, the life of a ticket, so that no attempt of the old
   version is left. Then, from the second version, run `supabase db push --dry-run`, which should list
   `20261107000000_close_direct_access.sql` alone, then `supabase db push`, and merge that version, so that
   `main` holds what the database has.
6. In the SQL editor, check what browsers can reach. This query only reads:

   ```sql
   select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
     has_function_privilege('authenticated', p.oid, 'execute') as browser_can_call
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('reserve_quota', 'start_rewrite', 'finish_rewrite', 'release_quota',
       'search_style_passages', 'read_style_passages');

   select has_table_privilege('authenticated', 'public.rewrites', 'insert') as browser_can_insert;
   ```

   It should give five functions, all `false`, no `read_style_passages`, and `false` for the insert. Between
   steps 2 and 5, the old functions appear next to them with `true`.

7. Run the smoke test again, with a second account or on the next UTC day: two runs use six attempts, and an
   account has five. Raising `user_daily` for the test also works ([below](#changing-the-limits)), if you put it
   back.

**Rolling back.** Until step 5, roll the app back in Vercel: the old functions are still there, and the first
file can stay. After step 5, the old version no longer works, so moving forward with a fix is simpler. Going
back would first take a new migration restoring what the second file removed: the six functions and the
`search_results` column of `20261105000000_quota_policy.sql`, and the policy and grant of
`20261027000000_init.sql`.

These steps were tried locally on a database at the previous schema, with old and new calls mixed between
the two migrations. They have not been run on the hosted project.

Migrations are named with dates ahead of the real calendar. A new one must sort after the last file in
`supabase/migrations`, so choose its timestamp by hand rather than relying on `supabase migration new`.

## Changing the limits

**Manual.** One row, no deploy. In the SQL editor:

```sql
select * from public.quota_limits;
update public.quota_limits set user_daily = 10, global_daily = 30;
```

To see how the budget is being used:

```sql
select * from public.usage_global order by day desc limit 31;
```

### Pausing the site

**Manual.** To stop new model calls at once, with no deployment, note the current value, then set it to 0 in
the SQL editor:

```sql
select global_daily from public.quota_limits;
update public.quota_limits set global_daily = 0;
```

Every new attempt is then refused with `global_quota_exceeded`, before any embedding, search or model call,
and the page says "Rewrity has reached its overall usage limit for now. Try again later." Pages, sign-in and
the history keep working, attempts already started end normally, and no counter changes.

An account's own limits are checked first, so one at its daily limit or with two attempts running gets those
refusals instead. To check the pause, use an account under its daily limit with nothing running, and run one
rewrite, which should show that message. To resume, put back the value you noted, 15 unless it had been
changed:

```sql
update public.quota_limits set global_daily = 15;
```

## What is set where

| Setting                                                                           | Where                                                                                    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Tables, RLS, grants, functions, quota limits (initial values)                     | `supabase/migrations`, versioned                                                         |
| Function region, duration and cancellation, security headers                      | `frontend/vercel.json`, `frontend/next.config.ts`, versioned                             |
| Local Supabase settings                                                           | `supabase/config.toml`, versioned, **local only**                                        |
| Current quota limits, pause                                                       | Database row, SQL editor                                                                 |
| Workspace, spending limit, alerts, Anthropic key rotation                         | Claude Console                                                                           |
| Secret and publishable keys                                                       | Supabase dashboard, Settings                                                             |
| Extensions (`pg_graphql` stays off)                                               | Supabase dashboard, Database                                                             |
| Environment variables, `STYLE_REFERENCES`, root directory, firewall rules         | Vercel dashboard                                                                         |
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

If a key is ever exposed, replace it. For the Anthropic key: create a new one in the same workspace, update
Vercel, redeploy, then delete the old one. For the route's secret key: the same in Supabase, Settings > API
Keys. It acts as `service_role` and reaches the whole database, so also check `public.usage_global` and
recent rows for anything you do not recognise.
