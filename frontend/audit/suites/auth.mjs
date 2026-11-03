// Signing in and out, through the real mailbox and the real auth service.
import { openPage, overflowX } from "../browser.mjs";
import {
  check,
  clearMailbox,
  createUser,
  deleteUser,
  expect,
  historyRows,
  magicLinkFor,
  expiringCookies,
  seedHistory,
  sessionCookies,
  sleep,
} from "../lib.mjs";

const SAMPLE =
  "In today's fast-paced world, it is crucial to understand that communication matters.";

export async function run(t) {
  const { env, mock } = t;
  const made = [];
  const newUser = async (label) => {
    const user = await createUser(env, label);
    made.push(user);
    return user;
  };

  try {
    await check(
      "auth",
      "signed out: a rewrite is refused with a clear message, model never called",
      async () => {
        mock.reset();
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByLabel("Your text").fill(SAMPLE);
        await page.getByRole("button", { name: "Rewrite" }).click();
        await page
          .getByText("Sign in to rewrite your text.")
          .waitFor({ timeout: 5000 });
        expect(
          mock.received.length === 0,
          "the model was called without a session",
        );
        await ctx.close();
      },
    );

    await check("auth", "signed out: history asks you to sign in", async () => {
      const ctx = await t.browser.newContext();
      const page = await openPage(ctx, "auth");
      await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
      await page.getByText("Sign in to see your history.").waitFor();
      await ctx.close();
    });

    await check(
      "auth",
      "magic link: email arrives, link signs you in, you land on your page",
      async () => {
        const visitor = await newUser("magic");
        await clearMailbox(env);
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/fr`, { waitUntil: "networkidle" });
        await page.getByLabel("E-mail").fill(visitor.email);
        await page
          .getByRole("button", { name: "Recevoir un lien de connexion" })
          .click();
        await page.getByText("Vérifiez votre boîte").waitFor({ timeout: 5000 });
        const link = await magicLinkFor(env, visitor.email);
        await page.goto(link);
        await page.waitForURL("**/fr", { timeout: 8000 });
        await page.getByText(visitor.email).waitFor({ timeout: 5000 });
        await ctx.close();
      },
    );

    await check(
      "auth",
      "an invalid link shows the failure message",
      async () => {
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/auth/callback?code=nonsense&next=/en`);
        await page.waitForURL("**auth_error=1");
        await page.getByText("This sign-in link did not work.").waitFor();
        await ctx.close();
      },
    );

    await check(
      "auth",
      "the sign-in redirect refuses other sites",
      async () => {
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        // "@evil.example" is the one that would really leave: pasted after the origin, it makes
        // the site the user name of a URL on evil.example
        for (const next of [
          "@evil.example",
          ".evil.example",
          "//evil.example",
        ]) {
          await page.goto(`${t.base}/auth/callback?code=x&next=${next}`);
          expect(
            new URL(page.url()).origin === t.base,
            `next=${next} ended up on ${page.url()}`,
          );
        }
        await ctx.close();
      },
    );

    await check(
      "auth",
      "signed in: the account chip shows, and sign out brings the form back",
      async () => {
        const member = await newUser("chip");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByText(member.email).waitFor();
        await page.getByLabel("Your text").fill("Text from a shared computer.");
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        expect(
          (await page.getByLabel("Your text").inputValue()) === "",
          "the text stayed on the screen after signing out",
        );
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByText("Sign in to see your history.").waitFor();
        await ctx.close();
      },
    );

    await check(
      "auth",
      "a delete with the session gone brings the sign-in form, and keeps the rows",
      async () => {
        const member = await newUser("gone");
        await seedHistory(env, member, 2);
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth", {
          refused: "/rest/v1/rewrites",
        });
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await ctx.clearCookies();
        await page
          .getByRole("button", { name: "Delete", exact: true })
          .first()
          .click();
        await page
          .getByText("Sign in to see your history.")
          .waitFor({ timeout: 5000 });
        const rows = await historyRows(env, member);
        await ctx.close();
        expect(rows.length === 2, `${rows.length} rows left`);
      },
    );

    await check(
      "layout",
      "a very long address stays inside the page on a phone",
      async () => {
        const member = await newUser("x".repeat(60));
        const ctx = await t.browser.newContext({
          viewport: { width: 320, height: 640 },
        });
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByText(member.email).waitFor();
        const over = await overflowX(page);
        await ctx.close();
        expect(over <= 0, `${over}px too wide`);
      },
    );

    await check(
      "auth",
      "a page that refreshes the session cannot be kept by a shared cache",
      async () => {
        const member = await newUser("cache");
        const response = await fetch(`${t.base}/en/privacy`, {
          headers: { Cookie: await expiringCookies(env, member) },
          redirect: "manual",
        });
        expect(response.status === 200, `status ${response.status}`);
        expect(
          (response.headers.get("set-cookie") ?? "").includes("auth-token"),
          "the session was not refreshed",
        );
        const cache = response.headers.get("cache-control") ?? "";
        expect(
          /no-store/.test(cache) && !/s-maxage/.test(cache),
          `cache-control: ${cache}`,
        );
      },
    );

    await check(
      "auth",
      "a session that nears its end during a rewrite still works on the next page",
      async () => {
        mock.reset();
        const member = await newUser("ending");
        // Past the 90 s margin only by the time the answer ends, so the route's bookkeeping refreshes
        // the session and the new cookies cannot reach the browser. It comes back with the used token,
        // past the 10 s anyone may reuse one, and Auth must still hand over the token that replaced it.
        const cookie = await expiringCookies(env, member, 92);
        const answer = await fetch(`${t.base}/api/rewrite`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `SLOW ${SAMPLE}`,
            locale: "en",
            stream: true,
          }),
        });
        expect(answer.status === 200, `status ${answer.status}`);
        expect(
          !(answer.headers.get("set-cookie") ?? "").includes("auth-token"),
          "refreshed on arrival: this check needs a faster start",
        );
        await answer.text();
        await sleep(11_000);
        const next = await fetch(`${t.base}/en`, {
          headers: { Cookie: cookie },
        });
        // A refused refresh would still show the reader until the token's end, so the page alone
        // proves nothing: it has to come with a new session
        expect(
          (next.headers.get("set-cookie") ?? "").includes("auth-token"),
          "Auth did not hand over a new session",
        );
        expect(
          (await next.text()).includes(member.email),
          "the next page no longer knows the reader",
        );
      },
    );

    await check(
      "auth",
      "the API refuses a request with a forged session cookie",
      async () => {
        mock.reset();
        const ctx = await t.browser.newContext();
        // A session that reads as valid and carries a token with a made-up signature: the route
        // must verify the signature, not just read the session. The name is the one the Supabase
        // client gives its cookie, from the API's hostname.
        const project = new URL(env.API_URL).hostname.split(".")[0];
        const encode = (value) =>
          Buffer.from(JSON.stringify(value)).toString("base64url");
        const id = crypto.randomUUID();
        const expires = Math.floor(Date.now() / 1000) + 3600;
        const token = [
          encode({ alg: "HS256", typ: "JWT" }),
          encode({
            sub: id,
            role: "authenticated",
            aud: "authenticated",
            exp: expires,
          }),
          encode("not a signature"),
        ].join(".");
        const session = {
          access_token: token,
          refresh_token: "made-up",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: expires,
          user: {
            id,
            aud: "authenticated",
            role: "authenticated",
            email: "forged@example.com",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          },
        };
        await ctx.addCookies([
          {
            name: `sb-${project}-auth-token`,
            value: `base64-${encode(session)}`,
            domain: "localhost",
            path: "/",
          },
        ]);
        const response = await ctx.request.post(`${t.base}/api/rewrite`, {
          data: { text: SAMPLE, locale: "en" },
        });
        await ctx.close();
        expect(response.status() === 401, `status ${response.status()}`);
        expect(mock.received.length === 0, "the model was called");
      },
    );
  } finally {
    for (const user of made) await deleteUser(env, user);
  }
}
