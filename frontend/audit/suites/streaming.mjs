// What streaming changes for the person waiting: when the first edit shows up.
// The stand-in model writes one edit every 350 ms, like a model that is still writing.
import { openPage } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  historyRows,
  sessionCookies,
  until,
} from "../lib.mjs";

const TEXT =
  "In today's fast-paced world, it is crucial to understand that communication matters a great deal. " +
  "Moreover, it is important to note that listening is a journey worth taking. " +
  "In conclusion, by embracing these principles, we can unlock our full potential together.";

export async function run(t) {
  const { env, mock } = t;
  const user = await createUser(env, "stream");
  try {
    const ctx = await t.browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addCookies(await sessionCookies(env, user));
    const page = await openPage(ctx, "streaming");
    await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });

    await check(
      "streaming",
      "the first edit appears before the model has finished",
      async () => {
        mock.state.gapMs = 900;
        await page.getByLabel("Your text").fill(TEXT);
        const started = Date.now();
        await page.getByRole("button", { name: "Rewrite" }).click();
        await page
          .getByText("Plainer")
          .first()
          .waitFor({ state: "attached", timeout: 100 })
          .catch(() => {});
        await page
          .getByRole("button", { name: "Stop" })
          .waitFor({ timeout: 8000 });
        const first = Date.now() - started;
        await page
          .getByRole("button", { name: "Edit the text" })
          .waitFor({ timeout: 10000 });
        const last = Date.now() - started;
        mock.state.gapMs = 350;
        expect(
          first < last - 500,
          `first edit at ${first} ms, whole answer at ${last} ms`,
        );
        return `first edit after ${first} ms, whole answer after ${last} ms`;
      },
    );

    await check(
      "streaming",
      "while it writes: counter grows, bulk buttons wait, Stop is offered",
      async () => {
        await page.getByRole("button", { name: "Edit the text" }).click();
        mock.state.gapMs = 1200;
        await page.getByRole("button", { name: "Rewrite" }).click();
        await page
          .getByRole("button", { name: "Stop" })
          .waitFor({ timeout: 8000 });
        expect(
          await page.getByRole("button", { name: "Accept all" }).isDisabled(),
          "Accept all was usable",
        );
        await page.getByText(/\d+ edits? so far/).waitFor();
        await page
          .getByRole("button", { name: "Edit the text" })
          .waitFor({ timeout: 15000 });
        expect(
          await page.getByRole("button", { name: "Accept all" }).isEnabled(),
          "Accept all stayed off",
        );
        mock.state.gapMs = 350;
      },
    );

    await check(
      "streaming",
      "a decision made early survives the edits that arrive after it",
      async () => {
        await page.getByRole("button", { name: "Edit the text" }).click();
        mock.state.gapMs = 1200;
        await page.getByRole("button", { name: "Rewrite" }).click();
        await page
          .getByRole("button", { name: "Stop" })
          .waitFor({ timeout: 8000 });
        await page
          .getByRole("button", { name: "Accept", exact: true })
          .first()
          .click();
        await page
          .getByRole("button", { name: "Edit the text" })
          .waitFor({ timeout: 15000 });
        await page.getByText(/^1 of \d+ accepted/).waitFor();
        mock.state.gapMs = 350;
      },
    );

    await check(
      "streaming",
      "Stop keeps what arrived and the request still counts",
      async () => {
        await page.getByRole("button", { name: "Edit the text" }).click();
        mock.state.gapMs = 1500;
        await page.getByRole("button", { name: "Rewrite" }).click();
        await page
          .getByRole("button", { name: "Stop" })
          .waitFor({ timeout: 8000 });
        await page.getByRole("button", { name: "Stop" }).click();
        await page.getByText(/Stopped/).waitFor();
        expect(
          (await page.getByText(/accepted/).count()) >= 1,
          "no summary after stopping",
        );
        mock.state.gapMs = 350;
        const saved = await until(
          async () => (await historyRows(env, user)).length >= 3,
          { timeout: 8000 },
        );
        expect(saved, "the stopped rewrite was not saved to history");
      },
    );

    await check(
      "streaming",
      "closing the page mid-answer gives the request back when nothing arrived",
      async () => {
        const other = await createUser(env, "leaver");
        const c2 = await t.browser.newContext();
        await c2.addCookies(await sessionCookies(env, other));
        const p2 = await openPage(c2, "streaming");
        await p2.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        mock.state.delayMs = 2500;
        await p2.getByLabel("Your text").fill(TEXT);
        await p2.getByRole("button", { name: "Rewrite" }).click();
        await p2.getByRole("button", { name: "Rewriting..." }).waitFor();
        await p2.close();
        await c2.close();
        mock.state.delayMs = 400;
        const { getUsage } = await import("../lib.mjs");
        const back = await until(
          async () => (await getUsage(env, other)) === 0 && "zero",
          { timeout: 9000 },
        );
        await deleteUser(env, other);
        expect(back === "zero", "the request was not given back");
      },
    );

    await ctx.close();
  } finally {
    await deleteUser(env, user);
  }
}
