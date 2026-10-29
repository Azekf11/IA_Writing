// A full rewrite, button by button. Real route, real database, stand-in model.
import { frameStats, openPage } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  sessionCookies,
} from "../lib.mjs";

export const SAMPLE =
  "In today's fast-paced world, it is crucial to understand that effective communication plays a pivotal role. " +
  "Moreover, it is important to note that listening is not just a skill, but a journey. " +
  "In conclusion, by embracing these principles, we can unlock our full potential.";

const FRENCH =
  "Dans un monde en constante évolution, il est crucial de comprendre que la communication joue un rôle essentiel. " +
  "De plus, écouter n'est pas seulement une compétence, mais un voyage.";

export async function run(t) {
  const { env, mock } = t;
  const user = await createUser(env, "rewrite");
  try {
    const ctx = await t.browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addCookies(await sessionCookies(env, user));
    const page = await openPage(ctx, "rewrite");
    await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
    const s = { ctx, page, mock, t, env };
    s.open = () =>
      page
        .getByRole("heading", { name: "Suggested edits" })
        .waitFor({ timeout: 5000 });
    s.back = () => page.getByRole("button", { name: "Edit the text" }).click();
    s.send = async (text) => {
      await page.getByLabel("Your text").fill(text);
      await page.getByRole("button", { name: "Rewrite" }).click();
    };

    await editorChecks(s);
    await reviewChecks(s);
    await moreChecks(s);
    await ctx.close();
  } finally {
    await deleteUser(env, user);
  }
}

async function editorChecks({ page }) {
  await check(
    "editor",
    "the example button fills the editor, then it disappears",
    async () => {
      await page.getByRole("button", { name: "Try an example" }).click();
      expect(
        (await page.getByLabel("Your text").inputValue()).length > 100,
        "editor not filled",
      );
      expect(
        (await page.getByRole("button", { name: "Try an example" }).count()) ===
          0,
        "button stayed",
      );
    },
  );

  await check("editor", "the counter follows the text", async () => {
    await page.getByLabel("Your text").fill("one two three");
    await page.getByText("3 words").waitFor();
    await page.getByLabel("Your text").fill("");
    await page.getByText("0 words").waitFor();
  });

  await check(
    "editor",
    "submit is off when empty, and too-long text is blocked",
    async () => {
      const button = page.getByRole("button", { name: "Rewrite" });
      expect(await button.isDisabled(), "enabled while empty");
      await page.getByLabel("Your text").fill("a".repeat(5001));
      expect(await button.isDisabled(), "enabled above the limit");
      await page.getByText("This text is too long").waitFor();
    },
  );
}

async function reviewChecks(s) {
  const { page, mock } = s;
  mock.reset();
  let timing = "";

  await check(
    "rewrite",
    "button: loading state, then edits with their reasons",
    async () => {
      await page.getByLabel("Your text").fill(SAMPLE);
      const answer = page.waitForResponse((r) =>
        r.url().includes("/api/rewrite"),
      );
      await page.getByRole("button", { name: "Rewrite" }).click();
      await page
        .getByRole("button", { name: "Rewriting..." })
        .waitFor({ timeout: 2000 });
      expect(
        (await page.getByLabel("Your text").getAttribute("readonly")) !== null,
        "editor still editable",
      );
      timing = (await answer).headers()["server-timing"] ?? "";
      await s.open();
      expect(
        (await page.getByText("Shorter and plainer.").count()) >= 1,
        "no reason shown",
      );
    },
  );

  await check(
    "rewrite",
    "the model got the text and style references read from the database",
    async () => {
      const call = mock.received.at(-1);
      expect(
        call && call.text.startsWith("In today's"),
        "wrong or missing call",
      );
      expect(
        call.hasReferences && call.referenceCount >= 1,
        "no style reference in the prompt",
      );
      return `${call.referenceCount} reference(s)`;
    },
  );

  await check(
    "rewrite",
    "the answer reports how long preparing took",
    async () => {
      expect(/^prep;dur=\d+$/.test(timing), `header: "${timing}"`);
      return timing;
    },
  );

  await check(
    "rewrite",
    "accept, reject and undo update the counter and the result",
    async () => {
      const result = page.getByTestId("result");
      const before = await result.textContent();
      await page
        .getByRole("button", { name: "Accept", exact: true })
        .first()
        .click();
      expect((await result.textContent()) !== before, "Accept changed nothing");
      await page.getByText(/1 of \d+ accepted/).waitFor();
      await page.getByRole("button", { name: "Undo" }).first().click();
      expect(
        (await result.textContent()) === before,
        "Undo did not restore the text",
      );
      await page
        .getByRole("button", { name: "Reject", exact: true })
        .first()
        .click();
      expect(
        (await result.textContent()) === before,
        "Reject changed the text",
      );
      await page.getByRole("button", { name: "Accept all" }).click();
      await page.getByText(/(\d+) of \1 accepted/).waitFor();
      await page.getByRole("button", { name: "Reject all" }).click();
      await page.getByText(/^0 of \d+ accepted/).waitFor();
    },
  );
}

async function moreChecks(s) {
  const { page, ctx, mock, t } = s;

  await check(
    "rewrite",
    "copy puts the final text on the clipboard",
    async () => {
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: t.base,
      });
      await page.getByRole("button", { name: "Accept all" }).click();
      const expected = await page.getByTestId("result").textContent();
      await page.getByRole("button", { name: "Copy text" }).click();
      await page.getByText("Copied").waitFor();
      expect(
        (await page.evaluate(() => navigator.clipboard.readText())) ===
          expected,
        "clipboard differs",
      );
    },
  );

  await check("rewrite", "the review scrolls itself into view", async () => {
    const top = await page.evaluate(() =>
      Math.round(
        document.querySelector("h2")?.getBoundingClientRect().top ?? 9999,
      ),
    );
    expect(top >= -5 && top < 400, `heading is ${top}px from the top`);
  });

  await check(
    "rewrite",
    "editing again keeps the text, and Ctrl+Enter submits",
    async () => {
      await s.back();
      expect(
        (await page.getByLabel("Your text").inputValue()) === SAMPLE,
        "text was lost",
      );
      await page.getByLabel("Your text").press("Control+Enter");
      await s.open();
      await s.back();
    },
  );

  await check("rewrite", "French text gets French references", async () => {
    mock.reset();
    await s.send(FRENCH);
    await s.open();
    expect(
      mock.received.at(-1).referenceCount >= 1,
      "no reference for French text",
    );
    await s.back();
  });

  await check(
    "rewrite",
    "the review opens smoothly (at most 2 frames over 50 ms)",
    async () => {
      await s.send(SAMPLE);
      const stats = await frameStats(page, s.open);
      await s.back();
      expect(
        stats.slow <= 2,
        `${stats.slow} slow frames, worst ${stats.worst} ms`,
      );
      return `p95 ${stats.p95} ms over ${stats.frames} frames`;
    },
  );
}
