// Signing in and out, through the real mailbox and the real auth service.
import { readFile } from "node:fs/promises";
import { openPage, overflowX } from "../browser.mjs";
import {
  accountExists,
  check,
  clearMailbox,
  createUser,
  deleteUser,
  expect,
  getUsage,
  historyRows,
  magicLinkFor,
  expiringCookies,
  seedHistory,
  sessionCookies,
  setUsage,
  ticketsOf,
  until,
} from "../lib.mjs";

const SAMPLE =
  "In today's fast-paced world, it is crucial to understand that communication matters.";

const deleteRow = (page) =>
  page.getByRole("button", { name: /^Delete the rewrite of/ }).first();
const yesDelete = (page) =>
  page.getByRole("button", { name: "Yes, delete", exact: true });
const deleteAccount = (page) =>
  page.getByRole("button", { name: "Delete my account" });
const yesDeleteAccount = (page) =>
  page.getByRole("button", { name: "Yes, delete my account" });
const sessionCookieNames = async (ctx) =>
  (await ctx.cookies()).filter(({ name }) => name.includes("auth-token"));

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
      "a link asked for on the history page comes back to it",
      async () => {
        const visitor = await newUser("from-history");
        await clearMailbox(env);
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByLabel("Email").fill(visitor.email);
        await page
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        await page.getByText("Check your inbox").waitFor({ timeout: 5000 });
        await page.goto(await magicLinkFor(env, visitor.email));
        await page.waitForURL("**/en/history", { timeout: 8000 });
        await page.getByText("No rewrites yet.").waitFor({ timeout: 5000 });
        await ctx.close();
      },
    );

    await check(
      "auth",
      "a text typed before asking for a link is in the tab the link opens, and the tab that asked follows",
      async () => {
        mock.reset();
        const visitor = await newUser("text-kept");
        await clearMailbox(env);
        const ctx = await t.browser.newContext();
        const asking = await openPage(ctx, "auth");
        await asking.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await asking.getByLabel("Your text").fill(SAMPLE);
        await asking.getByRole("button", { name: "Rewrite" }).click();
        const refusal = asking.getByText("Sign in to rewrite your text.");
        await refusal.waitFor({ timeout: 5000 });
        await asking.getByLabel("Email").fill(visitor.email);
        await asking
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        await asking.getByText("Check your inbox").waitFor({ timeout: 5000 });

        const opened = await openPage(ctx, "auth");
        await opened.goto(await magicLinkFor(env, visitor.email));
        await opened.waitForURL("**/en", { timeout: 8000 });
        await opened.getByText(visitor.email).waitFor({ timeout: 5000 });
        await opened.waitForFunction(
          (text) => document.querySelector("textarea")?.value === text,
          SAMPLE,
          { timeout: 5000 },
        );
        expect(
          (await opened.evaluate(() => JSON.stringify(localStorage))).includes(
            SAMPLE,
          ) === false,
          "the copy was still in the browser's storage once used",
        );

        // Playwright does not move the focus between pages by itself
        await asking.evaluate(() => window.dispatchEvent(new Event("focus")));
        await asking
          .getByText(`Signed in as ${visitor.email}`)
          .waitFor({ timeout: 5000 });
        await refusal.waitFor({ state: "detached", timeout: 5000 });
        expect(
          (await asking.getByLabel("Your text").inputValue()) === SAMPLE,
          "the tab that asked lost its text",
        );
        expect(mock.received.length === 0, "the model was called");
        await ctx.close();
      },
    );

    await check(
      "auth",
      "a text kept for a sign-in link does not outlive a sign-out",
      async () => {
        const member = await newUser("kept-signout");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.evaluate(() =>
          localStorage.setItem(
            "rewrity:sign-in-draft",
            JSON.stringify({
              text: "Kept for a link",
              strength: "standard",
              at: Date.now(),
            }),
          ),
        );
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        expect(
          (await page.getByLabel("Your text").inputValue()) === "",
          "a text came back after signing out",
        );
        expect(
          (await page.evaluate(() =>
            localStorage.getItem("rewrity:sign-in-draft"),
          )) === null,
          "the copy stayed in the browser after signing out",
        );
        await ctx.close();
      },
    );

    await check(
      "auth",
      "signing out in one browser leaves the reader's other devices signed in",
      async () => {
        const member = await newUser("two-devices");
        // Its own session, due for a refresh
        const otherDevice = await expiringCookies(env, member);
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        await ctx.close();
        const next = await fetch(`${t.base}/en`, {
          headers: { Cookie: otherDevice },
        });
        // A refused refresh would still show the reader until the token's end: only a new session
        // proves that this one was left alone
        expect(
          /auth-token[^=]*=base64-/.test(next.headers.get("set-cookie") ?? ""),
          "the other device was signed out too",
        );
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
      "signing out in one tab ends the session in the browser's other tabs, without bringing them to the front",
      async () => {
        const member = await newUser("tabs");
        await seedHistory(env, member, 2);
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const history = await openPage(ctx, "auth");
        await history.goto(`${t.base}/en/history`, {
          waitUntil: "networkidle",
        });
        await history.getByText("2 rewrites").waitFor();
        const french = await openPage(ctx, "auth");
        await french.goto(`${t.base}/fr`, { waitUntil: "networkidle" });
        await french.getByText(member.email).waitFor();
        await french
          .getByLabel("Votre texte")
          .fill("Un texte laissé dans un autre onglet.");
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });

        await history.waitForURL(`${t.base}/en`, { timeout: 5000 });
        await history.getByLabel("Email").waitFor({ timeout: 5000 });
        await french.getByLabel("E-mail").waitFor({ timeout: 5000 });
        expect(
          (await french.getByText(member.email).count()) === 0,
          "the other tab still shows the account",
        );
        expect(
          (await french.getByLabel("Votre texte").inputValue()) === "",
          "the other tab's text stayed",
        );
        await ctx.close();
      },
    );

    await check(
      "auth",
      "a sign-out whose script cannot be fetched says so, and the reader stays signed in",
      async () => {
        const member = await newUser("signout-offline");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByLabel("Your text").fill("Still here.");
        // Every script the page asks for from now on: the client's, fetched on use, is one
        await page.route("**/_next/static/**", (route) =>
          route.abort("aborted"),
        );
        await page.getByRole("button", { name: "Sign out" }).click();
        await page
          .getByRole("alert")
          .filter({ hasText: "Could not sign out" })
          .waitFor({ timeout: 5000 });
        expect(
          new URL(page.url()).pathname === "/en" &&
            (await page.getByText(member.email).count()) === 1,
          "the page went on as if signed out",
        );
        expect(
          (await page.getByLabel("Your text").inputValue()) === "Still here.",
          "the text went",
        );
        expect(
          (await sessionCookieNames(ctx)).length > 0,
          "the session went after all",
        );
        // What the message asks for works
        await page.unroute("**/_next/static/**");
        await page.reload({ waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        await ctx.close();
      },
    );

    await check(
      "auth",
      "a sign-in whose script cannot be fetched asks for a reload, not for another address",
      async () => {
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.route("**/_next/static/**", (route) =>
          route.abort("aborted"),
        );
        await page.getByLabel("Email").fill("reload@example.com");
        await page
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        const said = await page
          .getByRole("alert")
          .filter({ hasText: "Could not send the link" })
          .textContent({ timeout: 5000 });
        expect(
          said.includes("Reload the page") && !said.includes("address"),
          said,
        );
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
        await deleteRow(page).click();
        await yesDelete(page).click();
        await page
          .getByText("Sign in to see your history.")
          .waitFor({ timeout: 5000 });
        const rows = await historyRows(env, member);
        await ctx.close();
        expect(rows.length === 2, `${rows.length} rows left`);
      },
    );

    await check(
      "account",
      "a tab left open on one account cannot delete the rows of the account signed in now, and says nothing was deleted",
      async () => {
        const first = await newUser("stale-a");
        const second = await newUser("stale-b");
        await seedHistory(env, first, 2);
        await seedHistory(env, second, 3);
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, first));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByText("2 rewrites").waitFor();

        await ctx.clearCookies();
        await ctx.addCookies(await sessionCookies(env, second));
        // Nothing matches the first account any more: the page says it is out of date, on the row
        // and then at the top, and keeps showing what it was opened for
        const stale = page.getByRole("alert").filter({
          hasText: "This page is out of date, so nothing was deleted.",
        });
        await deleteRow(page).click();
        await yesDelete(page).click();
        await page
          .locator("li")
          .filter({ has: stale })
          .waitFor({ timeout: 5000 });
        await page.getByRole("button", { name: "Delete all" }).click();
        await page.getByRole("button", { name: "Yes, delete all" }).click();
        await page.locator("li [role=alert]").waitFor({ state: "detached" });
        await stale.waitFor({ timeout: 5000 });
        const shown = await page.getByText("2 rewrites").count();
        const [theirs, mine] = [
          await historyRows(env, second),
          await historyRows(env, first),
        ];
        await ctx.close();
        expect(
          shown === 1,
          "the page no longer shows the rows it was opened for",
        );
        expect(theirs.length === 3, `${theirs.length} rows left to the other`);
        expect(mine.length === 2, `${mine.length} rows left to the first`);
      },
    );

    await check(
      "account",
      "a tab left open on one account cannot delete the account signed in now",
      async () => {
        const first = await newUser("stale-account-a");
        const second = await newUser("stale-account-b");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, first));
        const page = await openPage(ctx, "auth", {
          refused: "/api/account",
          status: 409,
        });
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });

        await ctx.clearCookies();
        const cookies = await sessionCookies(env, second);
        await ctx.addCookies(cookies);
        await deleteAccount(page).click();
        await yesDeleteAccount(page).click();
        await page
          .getByText("no longer the one signed in here")
          .waitFor({ timeout: 5000 });
        const left = (await sessionCookieNames(ctx)).length;
        await ctx.close();
        expect(await accountExists(env, second), "the other account is gone");
        expect(await accountExists(env, first), "the first account is gone");
        expect(left === cookies.length, "the session did not survive");
      },
    );

    await check(
      "account",
      "another site's request cannot delete an account",
      async () => {
        const member = await newUser("cross-site");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const response = await ctx.request.post(`${t.base}/api/account`, {
          headers: { Origin: "https://evil.example" },
          data: { account: member.id },
        });
        await ctx.close();
        expect(response.status() === 403, `status ${response.status()}`);
        expect(await accountExists(env, member), "the account is gone");
      },
    );

    await check("account", "no session, no deletion", async () => {
      const member = await newUser("no-session");
      const response = await fetch(`${t.base}/api/account`, {
        method: "POST",
        headers: { Origin: t.base, "Content-Type": "application/json" },
        body: JSON.stringify({ account: member.id }),
      });
      expect(response.status === 401, `status ${response.status}`);
      expect(await accountExists(env, member), "the account is gone");
    });

    await check(
      "account",
      "downloading the history brings every row, in a file named for it",
      async () => {
        const member = await newUser("export");
        await seedHistory(env, member, 120);
        const ctx = await t.browser.newContext({ acceptDownloads: true });
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByText("120 rewrites").waitFor();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.getByRole("button", { name: "Download my history" }).click(),
        ]);
        expect(
          download.suggestedFilename() === "rewrity-history.json",
          `named ${download.suggestedFilename()}`,
        );
        const rows = JSON.parse(await readFile(await download.path(), "utf8"));
        await page
          .getByText("120 rewrites saved in rewrity-history.json.")
          .waitFor({ timeout: 5000 });
        await ctx.close();
        expect(rows.length === 120, `${rows.length} rows in the file`);
        const originals = new Set(rows.map((row) => row.original));
        expect(originals.size === 120, `${originals.size} different rows`);
        // What the privacy page lists as stored for each rewrite
        expect(
          Object.keys(rows[0]).sort().join() ===
            "created_at,edits,locale,original",
          `keys: ${Object.keys(rows[0]).join()}`,
        );
        return `${rows.length} rows`;
      },
    );

    await check(
      "account",
      "deleting an account asks first, removes everything and brings the sign-in form back",
      async () => {
        const member = await newUser("delete-me");
        await seedHistory(env, member, 3);
        await setUsage(env, member, 2);
        const other = await newUser("delete-me-not");
        await seedHistory(env, other, 2);
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.evaluate(() => {
          localStorage.setItem(
            "rewrity:sign-in-draft",
            JSON.stringify({
              text: "Kept for a link",
              strength: "standard",
              at: Date.now(),
            }),
          );
        });

        await deleteAccount(page).dblclick();
        await page.getByText("This cannot be undone. What Anthropic").waitFor();
        expect(await accountExists(env, member), "gone before the answer");

        await page.getByRole("button", { name: "Cancel" }).click();
        await yesDeleteAccount(page).waitFor({ state: "detached" });
        expect(await accountExists(env, member), "gone after Cancel");

        await deleteAccount(page).click();
        await yesDeleteAccount(page).dblclick();
        await page.waitForURL("**/en", { timeout: 8000 });
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        made.splice(made.indexOf(member), 1);

        expect(
          (await sessionCookieNames(ctx)).length === 0,
          "the session cookies stayed",
        );
        expect(
          (await page.evaluate(() =>
            localStorage.getItem("rewrity:sign-in-draft"),
          )) === null,
          "the kept text stayed in the browser",
        );
        expect(
          !(await accountExists(env, member)),
          "the account is still there",
        );
        const [rows, usage, tickets] = await Promise.all([
          historyRows(env, member),
          getUsage(env, member),
          ticketsOf(env, member),
        ]);
        expect(rows.length === 0, `${rows.length} rows left`);
        expect(usage === 0, `${usage} attempts left`);
        expect(tickets.length === 0, `${tickets.length} tickets left`);
        expect(
          (await historyRows(env, other)).length === 2,
          "another account's rows went too",
        );

        // The page reloaded signed out, in the language it was in, and stays that way
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByText("Sign in to see your history.").waitFor();
        await ctx.close();
      },
    );

    await check(
      "account",
      "someone with no rewrite can leave too, and a French page goes back to French",
      async () => {
        const member = await newUser("delete-empty");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/fr/history`, { waitUntil: "networkidle" });
        await page.getByText("Aucune réécriture pour le moment.").waitFor();
        expect(
          (await page
            .getByRole("button", { name: "Télécharger mon historique" })
            .count()) === 0,
          "a download was offered with nothing to download",
        );
        await page
          .getByRole("button", { name: "Supprimer mon compte" })
          .click();
        await page
          .getByRole("button", { name: "Oui, supprimer mon compte" })
          .click();
        await page.waitForURL("**/fr", { timeout: 8000 });
        made.splice(made.indexOf(member), 1);
        const gone = await until(
          async () => !(await accountExists(env, member)),
          { timeout: 4000 },
        );
        await ctx.close();
        expect(gone, "the account is still there");
      },
    );

    await check(
      "account",
      "deleting the account in one tab ends the session in the browser's other tabs",
      async () => {
        const member = await newUser("delete-tabs");
        const ctx = await t.browser.newContext();
        await ctx.addCookies(await sessionCookies(env, member));
        const other = await openPage(ctx, "auth");
        await other.goto(`${t.base}/fr`, { waitUntil: "networkidle" });
        await other.getByText(member.email).waitFor();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await deleteAccount(page).click();
        await yesDeleteAccount(page).click();
        await page.waitForURL("**/en", { timeout: 8000 });
        made.splice(made.indexOf(member), 1);
        await other.getByLabel("E-mail").waitFor({ timeout: 5000 });
        await ctx.close();
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
      "a session that nears its end during a rewrite is refreshed by the next page",
      async () => {
        mock.reset();
        const member = await newUser("ending");
        // Past the 90 s margin only by the time the answer ends. The route's bookkeeping uses the
        // server's key and leaves the session alone, so the next page presents an unused refresh token.
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
