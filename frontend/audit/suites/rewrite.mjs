// A full rewrite, button by button. Real route, real database, stand-in model.
import { frameStats, openPage } from "../browser.mjs";
import {
  check,
  closedAs,
  createUser,
  deleteUser,
  expect,
  getUsage,
  historyRows,
  passageBodies,
  sessionCookies,
  ticketsOf,
  until,
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
    const s = { ctx, page, mock, t, env, user };
    s.open = () =>
      page
        .getByRole("heading", { name: "Suggested edits" })
        .waitFor({ timeout: 5000 });
    s.back = () =>
      page.getByRole("button", { name: "Back to the original text" }).click();
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

// Fails if the page asks the rewrite route anything while `act` runs
async function sendsNothing(page, act) {
  const sent = [];
  const watch = (request) => {
    if (request.url().includes("/api/rewrite")) sent.push(request.url());
  };
  page.on("request", watch);
  try {
    await act();
  } finally {
    page.off("request", watch);
  }
  expect(sent.length === 0, `sent to the server: ${sent.join(", ")}`);
}

async function editorChecks(s) {
  const { page, env, user, open } = s;
  await check(
    "editor",
    "the example opens a review, spends nothing, and leaves the box empty",
    async () => {
      const before = (await historyRows(env, user)).length;
      const used = await getUsage(env, user);
      await sendsNothing(page, async () => {
        await page.getByRole("button", { name: "Try an example" }).click();
        await open();
        await page
          .getByText(/A sample, with edits prepared in advance/)
          .waitFor();
        expect(
          (await page
            .getByRole("button", { name: "Edit this result" })
            .count()) === 0,
          "a sample can be carried into the box",
        );
        await page.getByRole("button", { name: "Use your own text" }).click();
      });
      expect(
        (await page.getByLabel("Your text").inputValue()) === "",
        "box not empty after a sample",
      );
      expect(
        (await page
          .getByRole("button", { name: "Back to the review" })
          .count()) === 0,
        "a way back to the sample",
      );
      expect(
        (await historyRows(env, user)).length === before,
        "the sample went into the history",
      );
      expect(
        (await getUsage(env, user)) === used,
        "the sample used an attempt",
      );
    },
  );

  await check(
    "editor",
    "the free check opens a review from the box and spends nothing",
    async () => {
      const before = (await historyRows(env, user)).length;
      const used = await getUsage(env, user);
      await page.getByLabel("Your text").fill(SAMPLE);
      await sendsNothing(page, async () => {
        await page.getByRole("button", { name: "Free check" }).click();
        await open();
        await page.getByText(/a short list of stock phrases/).waitFor();
      });
      expect(
        (await page.locator("[data-decision]").count()) > 0,
        "nothing found in a text full of stock phrases",
      );
      expect(
        (await historyRows(env, user)).length === before,
        "the check went into the history",
      );
      expect((await getUsage(env, user)) === used, "the check used an attempt");
      await s.back();
      await page.getByLabel("Your text").fill("");
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

  await check("rewrite", "the review scrolls itself into view", async () => {
    // Where the animated scroll ends, read before anything else moves the page: a click brings its
    // own button into view, and U brings back a card
    let last = -1;
    const settled = await until(
      async () => {
        const y = await page.evaluate(() => window.scrollY);
        const same = y === last;
        last = y;
        return same;
      },
      { every: 200 },
    );
    expect(settled, "the page kept scrolling");
    const top = await page.evaluate(() =>
      Math.round(
        document.querySelector("h2")?.getBoundingClientRect().top ?? 9999,
      ),
    );
    expect(top >= -5 && top < 400, `heading is ${top}px from the top`);
  });

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
      await page.getByText(/^1 accepted, 0 rejected, \d+ to decide/).waitFor();
      await page
        .getByRole("button", { name: "Undo", exact: true })
        .first()
        .click();
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
      // One edit is rejected: the bulk button leaves it so, and only "all" reaches it
      const total = await page.locator("[data-decision]").count();
      await page.getByRole("button", { name: "Accept the rest" }).click();
      await page
        .getByText(`${total - 1} accepted, 1 rejected, 0 to decide`)
        .waitFor();
      await page.getByRole("button", { name: "Accept all" }).click();
      await page
        .getByText(`${total} accepted, 0 rejected, 0 to decide`)
        .waitFor();
      await page.getByRole("button", { name: "Reject all" }).click();
      await page
        .getByText(`0 accepted, ${total} rejected, 0 to decide`)
        .waitFor();
    },
  );

  await check(
    "rewrite",
    "the last decision can be taken back, by key and by button",
    async () => {
      const total = await page.locator("[data-decision]").count();
      await page.keyboard.press("u");
      await page
        .getByText(`${total} accepted, 0 rejected, 0 to decide`)
        .waitFor();
      await page.getByRole("button", { name: "Undo last decision" }).click();
      await page
        .getByText(`${total - 1} accepted, 1 rejected, 0 to decide`)
        .waitFor();
    },
  );
}

async function moreChecks(s) {
  const { page, ctx, mock, t, env, user } = s;

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
      await page.getByText("Copied", { exact: true }).waitFor();
      expect(
        (await page.evaluate(() => navigator.clipboard.readText())) ===
          expected,
        "clipboard differs",
      );
    },
  );

  await check(
    "rewrite",
    "the way back to the review keeps the decisions, without the model",
    async () => {
      const calls = mock.received.length;
      const before = await page.getByTestId("result").textContent();
      await s.back();
      await page.getByRole("button", { name: "Back to the review" }).click();
      await s.open();
      expect(
        (await page.getByTestId("result").textContent()) === before,
        "the decisions were lost",
      );
      expect(mock.received.length === calls, "the model was called");
    },
  );

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
    const sent = mock.received.at(-1).content;
    expect(
      passageBodies("fr").some((body) => sent.includes(body)),
      "no French passage reached the model",
    );
    expect(
      !passageBodies("en").some((body) => sent.includes(body)),
      "an English passage was sent for a French text",
    );
    await s.back();
  });

  await check(
    "rewrite",
    "a text the writer chose not to keep leaves no history, and still counts",
    async () => {
      const dontKeep = page.getByLabel("Do not keep this text in my history");
      const rows = (await historyRows(env, user)).length;
      const used = await getUsage(env, user);
      await page.getByText("Options").click();
      await dontKeep.check();
      await page.getByText("is not added to your history").waitFor();
      await s.send(SAMPLE);
      await s.open();
      const counted = await until(
        async () => ((await closedAs(env, user)) ? getUsage(env, user) : null),
        { timeout: 6000 },
      );
      expect(counted === used + 1, `usage ${used} -> ${counted}`);
      const [latest] = await ticketsOf(env, user);
      expect(latest.state === "succeeded", `ticket ${latest.state}`);
      expect(
        (await historyRows(env, user)).length === rows,
        "the text went into the history",
      );
      await s.back();
      // The editor is back with its options folded
      await page.getByText("Options").click();
      await dontKeep.uncheck();
      await page.getByText("Options").click();
    },
  );

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
