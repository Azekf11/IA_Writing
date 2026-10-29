// Guard rails: what the route does with bad input, a failing model, a spent quota, parallel calls,
// plus the history page. Uses fresh users so one check cannot spoil another.
import { openPage } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  getUsage,
  historyRows,
  sessionCookies,
  setUsage,
  sleep,
  until,
} from "../lib.mjs";

const TEXT =
  "The mayor spoke for an hour. Nobody in the room moved at all until the very end of it.";

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
          text: "Sales rose 12% last year. Costs stayed flat across every region of the company.",
          locale: "en",
        });
        const { edits } = await response.json();
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
        const { edits } = await response.json();
        expect(
          !JSON.stringify(edits).includes("not in the input"),
          "phantom edit came through",
        );
      },
    );

    await check(
      "limits",
      "a model failure gives a friendly error and gives the request back",
      async () => {
        await sleep(600);
        const before = await getUsage(env, a.user);
        const response = await post(a.ctx, {
          text: `FAILAPI ${TEXT}`,
          locale: "en",
        });
        expect(response.status() === 503, `status ${response.status()}`);
        expect((await response.json()).error === "busy", "wrong error code");
        const same = await until(
          async () => (await getUsage(env, a.user)) === before && "same",
          { timeout: 4000 },
        );
        expect(
          same === "same",
          `quota ${before} -> ${await getUsage(env, a.user)}`,
        );
        const rows = await historyRows(env, a.user);
        expect(
          !rows.some((r) => r.original.startsWith("FAILAPI")),
          "failed rewrite was saved",
        );
      },
    );

    await check(
      "limits",
      "a successful rewrite spends one request and is saved to history",
      async () => {
        const before = await getUsage(env, a.user);
        await post(a.ctx, { text: TEXT, locale: "en" });
        const saved = await until(
          async () =>
            (await historyRows(env, a.user)).some((r) => r.original === TEXT),
          { timeout: 4000 },
        );
        expect(saved, "not in history");
        expect(
          (await getUsage(env, a.user)) === before + 1,
          "quota did not move by one",
        );
      },
    );

    await check(
      "limits",
      "after the daily limit the UI shows the quota message",
      async () => {
        const b = await member("quota");
        await setUsage(env, b.user, 20);
        mock.reset();
        await b.page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await b.page.getByLabel("Your text").fill(TEXT);
        await b.page.getByRole("button", { name: "Rewrite" }).click();
        await b.page
          .getByText("You've reached today's limit.")
          .waitFor({ timeout: 5000 });
        expect(
          mock.received.length === 0,
          "the model was called after the limit",
        );
        await b.ctx.close();
      },
    );
    await a.ctx.close();
  } finally {
    for (const user of made) await deleteUser(env, user);
  }
}
