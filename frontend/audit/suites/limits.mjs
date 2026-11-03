// Guard rails: what the route does with bad input, a failing model and each limit.
// Every way an attempt can end is checked against the database: how its ticket closed, whether
// it stayed counted, and what reached the history. Uses fresh users so one check cannot spoil
// another.
import { openPage } from "../browser.mjs";
import {
  check,
  closedAs,
  createUser,
  deleteUser,
  expect,
  getLimits,
  getUsage,
  globalThisMonth,
  globalToday,
  historyRows,
  passageBodies,
  sessionCookies,
  setUsage,
  ticketsOf,
  withLimits,
} from "../lib.mjs";

const TEXT =
  "The mayor spoke for an hour. Nobody in the room moved at all until the very end of it.";
const ORIGINAL_LIMITS = {
  user_daily: 5,
};

export async function run(t) {
  const { env, mock } = t;
  const made = [];
  const member = async (label) => {
    const user = await createUser(env, label);
    made.push(user);
    const ctx = await t.browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addCookies(await sessionCookies(env, user));
    return { user, ctx, page: await openPage(ctx, label) };
  };
  const post = (ctx, body) =>
    ctx.request.post(`${t.base}/api/rewrite`, { data: body });

  // Asks for a streamed answer, as the page does, and returns its events
  const stream = async (ctx, text) => {
    const response = await post(ctx, { text, locale: "en", stream: true });
    expect(response.status() === 200, `status ${response.status()}`);
    return (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  };

  // The attempt must end as `outcome`, counted once, with or without a history row
  const settled = async (user, before, outcome, saved) => {
    const state = await closedAs(env, user);
    expect(state === outcome, `ticket closed as ${state}`);
    const usage = await getUsage(env, user);
    expect(usage === before + 1, `usage ${before} -> ${usage}`);
    const rows = await historyRows(env, user);
    expect(
      rows.length === saved,
      `${rows.length} history rows, expected ${saved}`,
    );
  };

  try {
    const a = await member("guards");

    await check(
      "limits",
      "malformed, empty, oversized and unknown-language bodies are refused",
      async () => {
        mock.reset();
        const bad = [
          { text: "" },
          { text: "   " },
          { text: "a".repeat(5001) },
          { text: "hi", locale: "de" },
          "nope",
        ];
        for (const body of bad) {
          const response =
            typeof body === "string"
              ? await a.ctx.request.post(`${t.base}/api/rewrite`, {
                  data: body,
                  headers: { "content-type": "application/json" },
                })
              : await post(a.ctx, body);
          expect(
            response.status() === 400,
            `${JSON.stringify(body).slice(0, 30)} -> ${response.status()}`,
          );
        }
        const huge = await a.ctx.request.post(`${t.base}/api/rewrite`, {
          data: JSON.stringify({ text: "x".repeat(60000) }),
          headers: { "content-type": "application/json" },
        });
        expect(huge.status() === 413, `huge body -> ${huge.status()}`);
        expect(
          mock.received.length === 0,
          "the model was called for bad input",
        );
      },
    );

    await check(
      "limits",
      "a number changed by the model never reaches the user",
      async () => {
        const response = await post(a.ctx, {
          text: "Sales across the whole company rose 12% last year. Costs stayed flat across every region of the company.",
          locale: "en",
        });
        expect(response.status() === 200, `status ${response.status()}`);
        const { edits } = await response.json();
        expect(edits.length === 1, `${edits.length} edits`);
        expect(
          !JSON.stringify(edits).includes("15%"),
          "the altered number came through",
        );
      },
    );

    await check(
      "limits",
      "an edit quoting text that is not there is dropped",
      async () => {
        const response = await post(a.ctx, {
          text: `MISSING ${TEXT}`,
          locale: "en",
        });
        expect(response.status() === 200, `status ${response.status()}`);
        const { edits } = await response.json();
        expect(
          !JSON.stringify(edits).includes("not in the input"),
          "phantom edit came through",
        );
      },
    );

    await check(
      "limits",
      "a success is counted once, saved to history, and closes its ticket",
      async () => {
        const u = await member("success");
        await post(u.ctx, { text: TEXT, locale: "en" });
        await settled(u.user, 0, "succeeded", 1);
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "excerpts reach the model but not the browser, and the writing sample is not stored",
      async () => {
        const u = await member("privacy");
        const voice = "My own unmistakable way of writing short lines.";
        mock.reset();
        const response = await post(u.ctx, { text: TEXT, locale: "en", voice });
        const answer = await response.text();
        const call = mock.received.at(-1);
        expect(call.voice === voice, "the sample did not reach the model");
        const seen = passageBodies().filter((b) => call.content.includes(b));
        expect(seen.length >= 1, "no excerpt reached the model");
        expect(
          !passageBodies().some((b) => answer.includes(b)),
          "an excerpt was sent to the browser",
        );
        await closedAs(env, u.user);
        const rows = await historyRows(env, u.user);
        expect(rows.length === 1, `${rows.length} history rows`);
        expect(
          !JSON.stringify(rows).includes("unmistakable"),
          "the writing sample was stored",
        );
        await u.ctx.close();
        return `${seen.length} excerpt(s) sent to the model, none to the browser`;
      },
    );

    await check(
      "limits",
      "a model failure gives a friendly error and stays counted",
      async () => {
        const u = await member("failure");
        mock.reset();
        const response = await post(u.ctx, {
          text: `FAILAPI ${TEXT}`,
          locale: "en",
        });
        expect(response.status() === 503, `status ${response.status()}`);
        expect((await response.json()).error === "busy", "wrong error code");
        await settled(u.user, 0, "failed", 0);
        // The ceilings count attempts: one attempt must stay one paid call
        expect(
          mock.received.length === 1,
          `${mock.received.length} calls for one attempt`,
        );
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "a model failure before the first edit, streamed: error event, counted, nothing saved",
      async () => {
        const u = await member("failure-stream");
        mock.reset();
        const events = await stream(u.ctx, `FAILAPI ${TEXT}`);
        const last = events.at(-1);
        expect(
          last.type === "error" && last.error === "busy",
          JSON.stringify(last),
        );
        await settled(u.user, 0, "failed", 0);
        expect(
          mock.received.length === 1,
          `${mock.received.length} calls for one attempt`,
        );
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "a refusal is explained in the page, and stays counted",
      async () => {
        const u = await member("refusal");
        await u.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await u.page.getByLabel("Your text").fill(`REFUSE ${TEXT}`);
        await u.page.getByRole("button", { name: "Rewrite" }).click();
        await u.page
          .getByText("The assistant declined")
          .waitFor({ timeout: 6000 });
        await settled(u.user, 0, "failed", 0);
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "an answer cut off after an edit keeps that edit, says so, and counts as failed",
      async () => {
        const u = await member("truncated");
        const events = await stream(u.ctx, `TRUNCATE ${TEXT}`);
        const types = events.map((event) => event.type).join();
        expect(types === "start,edit,done", `events ${types}`);
        expect(events.at(-1).partial === true, "not marked as cut short");
        await settled(u.user, 0, "failed", 1);

        await u.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await u.page.getByLabel("Your text").fill(`TRUNCATE ${TEXT}`);
        await u.page.getByRole("button", { name: "Rewrite" }).click();
        await u.page
          .getByText("The answer was cut short.")
          .waitFor({ timeout: 6000 });
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "an answer whose every edit fails a check is an error, not 'nothing to change'",
      async () => {
        const u = await member("allbad");
        const events = await stream(u.ctx, `ALLBAD ${TEXT}`);
        const last = events.at(-1);
        expect(
          last.type === "error" && last.error === "upstream_error",
          JSON.stringify(last),
        );
        await settled(u.user, 0, "failed", 0);

        await u.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await u.page.getByLabel("Your text").fill(`ALLBAD ${TEXT}`);
        await u.page.getByRole("button", { name: "Rewrite" }).click();
        await u.page
          .getByText("The assistant could not answer.")
          .waitFor({ timeout: 6000 });
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "edits written out of reading order keep the result whole, at every step",
      async () => {
        const u = await member("reverse");
        const text =
          "REVERSE This is the first sentence of the text here now. " +
          "Second sentence stays as it is. " +
          "Then comes a third sentence of the text right here. " +
          "And the last one stays too.";
        mock.state.gapMs = 800;
        await u.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await u.page.getByLabel("Your text").fill(text);
        await u.page.getByRole("button", { name: "Rewrite" }).click();
        const result = u.page.getByTestId("result");
        await u.page.getByText("2 edits so far").waitFor({ timeout: 8000 });
        expect(
          (await result.textContent()) === text,
          `while writing: ${await result.textContent()}`,
        );
        await u.page
          .getByRole("button", { name: "Edit the text" })
          .waitFor({ timeout: 8000 });
        mock.state.gapMs = 350;
        await u.page.getByRole("button", { name: "Accept all" }).click();
        const accepted = await result.textContent();
        expect(
          accepted ===
            "Sentence of the text here now. Second sentence stays as it is. " +
              "Sentence of the text right here. And the last one stays too.",
          `after Accept all: ${accepted}`,
        );
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "an answer cut off before any edit is an error, and counts",
      async () => {
        const u = await member("toolong");
        const events = await stream(u.ctx, `TOOLONG ${TEXT}`);
        const last = events.at(-1);
        expect(
          last.type === "error" && last.error === "upstream_error",
          JSON.stringify(last),
        );
        await settled(u.user, 0, "failed", 0);
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "a connection lost after an edit keeps that edit, as a failed attempt",
      async () => {
        const u = await member("cutoff");
        const events = await stream(u.ctx, `CUTOFF ${TEXT}`);
        const types = events.map((event) => event.type).join();
        expect(types === "start,edit,done", `events ${types}`);
        expect(events.at(-1).partial === true, "not marked as cut short");
        await settled(u.user, 0, "failed", 1);
        await u.ctx.close();
      },
    );

    await check(
      "limits",
      "after the daily limit the page shows the quota message and nothing is spent",
      async () => {
        const b = await member("quota");
        await withLimits(env, ORIGINAL_LIMITS, async () => {
          await setUsage(env, b.user, ORIGINAL_LIMITS.user_daily);
          mock.reset();
          await b.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
          await b.page.getByLabel("Your text").fill(TEXT);
          await b.page.getByRole("button", { name: "Rewrite" }).click();
          await b.page
            .getByText("You've reached today's limit.")
            .waitFor({ timeout: 5000 });
          const refused = await post(b.ctx, { text: TEXT, locale: "en" });
          expect(refused.status() === 429, `status ${refused.status()}`);
          expect(
            (await refused.json()).error === "quota_exceeded",
            "wrong error code",
          );
        });
        expect(
          mock.received.length === 0,
          "the model was called after the limit",
        );
        const tickets = await ticketsOf(env, b.user);
        expect(tickets.length === 0, "a refused request made a ticket");
        await b.ctx.close();
      },
    );

    await check(
      "limits",
      "at the app's daily ceiling a brand-new account is refused too, and nothing is spent",
      async () => {
        const c = await member("ceiling");
        const used = await globalToday(env);
        await withLimits(env, { global_daily: used }, async () => {
          mock.reset();
          await c.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
          await c.page.getByLabel("Your text").fill(TEXT);
          await c.page.getByRole("button", { name: "Rewrite" }).click();
          await c.page
            .getByText("overall usage limit")
            .waitFor({ timeout: 5000 });
          const refused = await post(c.ctx, { text: TEXT, locale: "en" });
          expect(refused.status() === 429, `status ${refused.status()}`);
          expect(
            (await refused.json()).error === "global_quota_exceeded",
            "wrong error code",
          );
        });
        expect(mock.received.length === 0, "the model was called");
        expect((await getUsage(env, c.user)) === 0, "the refusal was counted");
        await c.ctx.close();
      },
    );

    await check(
      "limits",
      "at the app's monthly ceiling a brand-new account is refused too",
      async () => {
        const d = await member("monthly");
        const used = await globalThisMonth(env);
        await withLimits(env, { global_monthly: used }, async () => {
          mock.reset();
          const refused = await post(d.ctx, { text: TEXT, locale: "en" });
          expect(refused.status() === 429, `status ${refused.status()}`);
          expect(
            (await refused.json()).error === "global_quota_exceeded",
            "wrong error code",
          );
        });
        expect(mock.received.length === 0, "the model was called");
        await d.ctx.close();
      },
    );

    await check(
      "limits",
      "the limits in force are back once a limit check is over",
      async () => {
        const limits = await getLimits(env);
        expect(limits.user_daily > 5, `user_daily is ${limits.user_daily}`);
      },
    );

    await a.ctx.close();
  } finally {
    for (const user of made) await deleteUser(env, user);
  }
}
