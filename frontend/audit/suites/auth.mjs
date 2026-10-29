// Signing in and out, through the real mailbox and the real auth service.
import { openPage } from "../browser.mjs";
import {
  check,
  clearMailbox,
  createUser,
  deleteUser,
  expect,
  magicLinkFor,
  sessionCookies,
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
      const page = await ctx.newPage();
      await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
      await page.getByText("Sign in to see your history.").waitFor();
      await ctx.close();
    });

    await check(
      "auth",
      "magic link: email arrives, link signs you in, you land on your page",
      async () => {
        const visitor = await newUser("magic");
        await clearMailbox();
        const ctx = await t.browser.newContext();
        const page = await openPage(ctx, "auth");
        await page.goto(`${t.base}/fr`, { waitUntil: "networkidle" });
        await page.getByLabel("E-mail").fill(visitor.email);
        await page
          .getByRole("button", { name: "Recevoir un lien de connexion" })
          .click();
        await page.getByText("Vérifiez votre boîte").waitFor({ timeout: 5000 });
        const link = await magicLinkFor(visitor.email);
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
        await page
          .getByText("The sign-in link is invalid or expired.")
          .waitFor();
        await ctx.close();
      },
    );

    await check(
      "auth",
      "the sign-in redirect refuses other sites",
      async () => {
        const ctx = await t.browser.newContext();
        const page = await ctx.newPage();
        await page.goto(`${t.base}/auth/callback?code=x&next=//evil.example`);
        expect(
          new URL(page.url()).origin === t.base,
          `ended up on ${page.url()}`,
        );
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
        await page.getByRole("button", { name: "Sign out" }).click();
        await page.getByLabel("Email").waitFor({ timeout: 5000 });
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByText("Sign in to see your history.").waitFor();
        await ctx.close();
      },
    );

    await check(
      "auth",
      "the API refuses a request with a forged session cookie",
      async () => {
        const ctx = await t.browser.newContext();
        await ctx.addCookies([
          {
            name: "sb-127-auth-token",
            value: "base64-ZmFrZQ",
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
