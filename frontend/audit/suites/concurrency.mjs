// History page, parallel requests, and the isolation between users.
import { openPage } from "../browser.mjs";
import {
  accessToken,
  check,
  createUser,
  deleteUser,
  expect,
  getUsage,
  historyRows,
  seedHistory,
  seedRewrite,
  sessionCookies,
  sleep,
  ticketsOf,
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
          const response = await post(a.ctx, `${TEXT} Entry ${n}.`);
          expect(response.status() === 200, `status ${response.status()}`);
          await sleep(150);
        }
        const saved = await until(
          async () => (await historyRows(env, a.user)).length === 3,
          { timeout: 5000 },
        );
        expect(saved, "the three rewrites were not saved");
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        const cards = page.locator("main ul > li");
        await cards.first().waitFor();
        expect(
          (await cards.first().textContent()).includes("Entry 3"),
          "newest is not first",
        );
        await page
          .getByRole("button", { name: "Delete", exact: true })
          .first()
          .click();
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
          await page
            .getByRole("button", { name: "Delete", exact: true })
            .first()
            .click();
        await page.getByText("No rewrites yet.").waitFor({ timeout: 4000 });
      },
    );

    await check(
      "history",
      "with more entries than it lists: it says so, and Delete all reaches them all",
      async () => {
        const c = await member("hist-many");
        await seedHistory(env, c.user, 55);
        const p = await openPage(c.ctx, "history");
        await p.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await p.getByText("55 rewrites").waitFor();
        await p
          .getByText(
            "Only your 50 most recent rewrites are listed and searched.",
          )
          .waitFor();
        const cards = p.locator("main ul > li");
        expect((await cards.count()) === 50, `${await cards.count()} listed`);

        // One delete: the list fills up again from the older entries
        await p
          .getByRole("button", { name: "Delete", exact: true })
          .first()
          .click();
        await p.getByText("54 rewrites").waitFor({ timeout: 4000 });
        const refilled = await until(async () => (await cards.count()) === 50, {
          timeout: 4000,
        });
        expect(refilled, `${await cards.count()} listed after a delete`);

        await p.getByRole("button", { name: "Delete all" }).click();
        await p.getByRole("button", { name: "Yes, delete all" }).click();
        await p.getByText("No rewrites yet.").waitFor({ timeout: 4000 });
        const rows = await historyRows(env, c.user);
        expect(rows.length === 0, `${rows.length} rows left in the database`);

        // Going elsewhere and coming back must not bring them back from the browser's copy
        await p.getByRole("link", { name: "Rewrite" }).click();
        await p.getByLabel("Your text").waitFor();
        await p.goBack();
        await p.getByText("No rewrites yet.").waitFor({ timeout: 4000 });
        await c.ctx.close();
      },
    );

    await check(
      "history",
      "Reopen shows the review again every time, without calling the model",
      async () => {
        const c = await member("reopen");
        const original = "It is crucial to act now.";
        await seedRewrite(env, c.user, original, {
          id: "edit-0",
          original: "crucial",
          replacement: "important",
          reason: "Plainer word",
          start: 6,
          end: 13,
        });
        const p = await openPage(c.ctx, "reopen");
        mock.reset();
        // How long the list stays on screen decides whether React renders the editor twice
        for (const pause of [0, 300, 1000, 2000, 0, 300, 1000, 2000]) {
          await p.goto(`${t.base}/en`, { waitUntil: "networkidle" });
          await p.getByRole("link", { name: "History" }).click();
          const reopen = p.getByRole("button", { name: "Reopen" });
          await reopen.waitFor();
          await sleep(pause);
          await reopen.click();
          await p
            .getByText("Plainer word", { exact: true })
            .waitFor({ timeout: 4000 });
          expect(
            (await p.getByTestId("result").textContent()) === original,
            "the review shows another text",
          );
          expect(
            (await p.evaluate(() => sessionStorage.length)) === 0,
            "the stash stayed behind",
          );
        }
        expect(mock.received.length === 0, "the model was called");
        await c.ctx.close();
      },
    );

    await check(
      "history",
      "a double click on a row's Delete removes that row, not the next one",
      async () => {
        const c = await member("dbl-row");
        await seedHistory(env, c.user, 6);
        const p = await openPage(c.ctx, "history");
        await p.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        const cards = p.locator("main ul > li");
        const box = await p
          .getByRole("button", { name: "Delete", exact: true })
          .first()
          .boundingBox();
        await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await p.mouse.down({ clickCount: 1 });
        await p.mouse.up({ clickCount: 1 });
        // The list closes up, so the second click lands on the next row's Delete
        await until(async () => (await cards.count()) === 5, { timeout: 4000 });
        await p.mouse.down({ clickCount: 2 });
        await p.mouse.up({ clickCount: 2 });
        await sleep(300);
        expect((await cards.count()) === 5, `${await cards.count()} listed`);
        const rows = await historyRows(env, c.user);
        expect(rows.length === 5, `${rows.length} rows in the database`);
        await c.ctx.close();
      },
    );

    await check(
      "history",
      "the search box keeps room to type on a small phone, in French too",
      async () => {
        const c = await member("narrow");
        await seedHistory(env, c.user, 2);
        const p = await openPage(c.ctx, "history");
        await p.setViewportSize({ width: 320, height: 640 });
        await p.goto(`${t.base}/fr/history`, { waitUntil: "networkidle" });
        const box = await p.getByRole("searchbox").boundingBox();
        expect(box.width >= 160, `${box.width}px wide`);
        await c.ctx.close();
      },
    );

    await check(
      "history",
      "a double click on Yes stays on the emptied history, on a phone too",
      async () => {
        const cases = [
          ["en", 390, "Delete all", "Yes, delete all"],
          ["fr", 414, "Tout supprimer", "Oui, tout supprimer"],
        ];
        for (const [lang, width, clear, yes] of cases) {
          const c = await member(`dbl-yes-${lang}`);
          await seedHistory(env, c.user, 3);
          const p = await openPage(c.ctx, "history");
          await p.setViewportSize({ width, height: 800 });
          await p.goto(`${t.base}/${lang}/history`, {
            waitUntil: "networkidle",
          });
          await p.getByRole("button", { name: clear, exact: true }).click();
          await p.getByRole("button", { name: yes }).dblclick();
          const emptied = await until(
            async () => (await historyRows(env, c.user)).length === 0,
            { timeout: 4000 },
          );
          expect(emptied, `${lang}: rows left`);
          await sleep(300);
          const { pathname } = new URL(p.url());
          expect(pathname === `/${lang}/history`, `${lang}: on ${pathname}`);
          await c.ctx.close();
        }
      },
    );

    await check(
      "history",
      "a double click on Delete all cannot confirm it, in any language or width",
      async () => {
        const c = await member("dbl-all");
        await seedHistory(env, c.user, 3);
        const p = await openPage(c.ctx, "history");
        const texts = [
          ["en", "Delete all", "Yes, delete all", "Cancel"],
          ["fr", "Tout supprimer", "Oui, tout supprimer", "Annuler"],
        ];
        for (const [lang, clear, yes, cancel] of texts) {
          for (const width of [1280, 360]) {
            await p.setViewportSize({ width, height: 800 });
            await p.goto(`${t.base}/${lang}/history`, {
              waitUntil: "networkidle",
            });
            const button = p.getByRole("button", { name: clear, exact: true });
            const box = await button.boundingBox();
            await button.dblclick();
            const confirm = p.getByRole("button", { name: yes });
            await confirm.waitFor();
            const under = await confirm.boundingBox();
            expect(
              under.y >= box.y + box.height,
              `${lang} ${width}: Yes opens under the pointer`,
            );
            const rows = await historyRows(env, c.user);
            expect(rows.length === 3, `${rows.length} rows left`);
            await p.getByRole("button", { name: cancel }).click();
          }
        }
        await c.ctx.close();
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
        const responses = await Promise.all(calls);
        const statuses = responses.map((r) => r.status()).sort();
        expect(
          statuses.join() === "200,200,429",
          `statuses ${statuses.join()}`,
        );
        const refused = responses.find((r) => r.status() === 429);
        expect(
          (await refused.json()).error === "too_many_requests",
          "wrong error code",
        );
        expect(
          (await getUsage(env, b.user)) === 2,
          `spent ${await getUsage(env, b.user)} instead of 2`,
        );
        expect(
          mock.received.length === 2,
          `${mock.received.length} calls reached the model instead of 2`,
        );
        // The slots are free again once both tickets are closed
        const closed = await until(
          async () => {
            const tickets = await ticketsOf(env, b.user);
            return (
              tickets.length === 2 &&
              tickets.every((ticket) => ticket.state === "succeeded")
            );
          },
          { timeout: 4000 },
        );
        expect(closed, "the two tickets were not closed");
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
        const posted = await post(x.ctx, `${TEXT} Private to the owner.`);
        expect(posted.status() === 200, `status ${posted.status()}`);
        const saved = await until(
          async () => (await historyRows(env, x.user)).length === 1,
          { timeout: 5000 },
        );
        expect(saved, "the owner's rewrite was not saved");
        const rows = await historyRows(env, x.user);
        const p = await openPage(y.ctx, "history");
        await p.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await p.getByText("No rewrites yet.").waitFor();
        // From the other user's browser, with their own session
        const hacked = await p.evaluate(
          async ([url, key, token, id]) => {
            const r = await fetch(`${url}/rest/v1/rewrites?id=eq.${id}`, {
              method: "DELETE",
              headers: {
                apikey: key,
                Authorization: `Bearer ${token}`,
                Prefer: "return=representation",
              },
            });
            return { status: r.status, deleted: (await r.json()).length };
          },
          [
            env.API_URL,
            env.PUBLISHABLE_KEY,
            await accessToken(env, y.user),
            rows[0].id,
          ],
        );
        expect(
          hacked.status === 200 && hacked.deleted === 0,
          `delete gave ${JSON.stringify(hacked)}`,
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
