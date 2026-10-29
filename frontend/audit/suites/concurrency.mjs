// History page, parallel requests, and the isolation between users.
import { openPage } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  getUsage,
  historyRows,
  sessionCookies,
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
    return { user, ctx };
  };
  const post = (ctx, text = TEXT) =>
    ctx.request.post(`${t.base}/api/rewrite`, { data: { text, locale: "en" } });

  try {
    const a = await member("hist");
    const page = await openPage(a.ctx, "history");

    await check(
      "history",
      "lists rewrites newest first; delete removes one from the page and the database",
      async () => {
        for (const n of [1, 2, 3]) {
          await post(a.ctx, `${TEXT} Entry ${n}.`);
          await sleep(150);
        }
        await until(async () => (await historyRows(env, a.user)).length === 3, {
          timeout: 5000,
        });
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        const cards = page.locator("main ul > li");
        await cards.first().waitFor();
        expect(
          (await cards.first().textContent()).includes("Entry 3"),
          "newest is not first",
        );
        await page.getByRole("button", { name: "Delete" }).first().click();
        await until(async () => (await cards.count()) === 2, { timeout: 4000 });
        expect((await cards.count()) === 2, "entry still listed");
        expect(
          (await historyRows(env, a.user)).length === 2,
          "still in the database",
        );
      },
    );

    await check(
      "history",
      "the empty state shows after the last delete",
      async () => {
        for (let i = 0; i < 2; i++)
          await page.getByRole("button", { name: "Delete" }).first().click();
        await page.getByText("No rewrites yet.").waitFor({ timeout: 4000 });
      },
    );

    await check(
      "concurrency",
      "two at once are allowed, the third is refused and costs nothing",
      async () => {
        const b = await member("burst");
        mock.reset();
        const slow = `SLOW ${TEXT}`;
        const calls = [post(b.ctx, slow), post(b.ctx, slow), post(b.ctx, slow)];
        const statuses = (await Promise.all(calls))
          .map((r) => r.status())
          .sort();
        expect(
          statuses.join() === "200,200,429",
          `statuses ${statuses.join()}`,
        );
        await sleep(500);
        expect(
          (await getUsage(env, b.user)) === 2,
          `spent ${await getUsage(env, b.user)} instead of 2`,
        );
        const after = await post(b.ctx);
        expect(
          after.status() === 200,
          `a new request after they finished got ${after.status()}`,
        );
        await b.ctx.close();
      },
    );

    await check(
      "concurrency",
      "a user cannot see or delete another user's history",
      async () => {
        const x = await member("owner");
        const y = await member("other");
        await post(x.ctx, `${TEXT} Private to the owner.`);
        await until(async () => (await historyRows(env, x.user)).length === 1, {
          timeout: 5000,
        });
        const rows = await historyRows(env, x.user);
        const p = await y.ctx.newPage();
        await p.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await p.getByText("No rewrites yet.").waitFor();
        const hacked = await p.evaluate(
          async ([url, key, id]) => {
            const r = await fetch(`${url}/rest/v1/rewrites?id=eq.${id}`, {
              method: "DELETE",
              headers: { apikey: key },
            });
            return r.status;
          },
          [env.API_URL, env.PUBLISHABLE_KEY, rows[0].id],
        );
        expect(
          hacked === 401 || hacked === 403 || hacked === 204,
          `status ${hacked}`,
        );
        expect(
          (await historyRows(env, x.user)).length === 1,
          "the owner's entry was deleted by someone else",
        );
        await x.ctx.close();
        await y.ctx.close();
      },
    );

    await a.ctx.close();
  } finally {
    for (const user of made) await deleteUser(env, user);
  }
}
