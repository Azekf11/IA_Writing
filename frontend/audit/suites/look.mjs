// Accessibility (axe, both themes, every accent) and layout on three screen sizes.
import AxeBuilder from "@axe-core/playwright";
import { openPage, overflowX } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  insertRewrites,
  seedHistory,
  sessionCookies,
  warn,
} from "../lib.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function axe(page, configure) {
  const builder = new AxeBuilder({ page });
  return configure(builder).analyze();
}

// Edits on screen, from a canned answer: this suite looks at the page, not at the route. The last
// three share words with what they replace, so the words that change are marked inside them.
async function openReview(page, base) {
  const text =
    "It is crucial to act immediately, to plan ahead and to speak clearly.";
  const edit = (id, original, replacement) => {
    const start = text.indexOf(original);
    return {
      id,
      original,
      replacement,
      reason: "A simpler word",
      start,
      end: start + original.length,
    };
  };
  const events = [
    {
      type: "start",
      references: [{ author: "An author", title: "A title" }],
    },
    { type: "edit", edit: edit("edit-0", "crucial", "plain") },
    { type: "edit", edit: edit("edit-1", "to act immediately", "to act now") },
    { type: "edit", edit: edit("edit-2", "to plan ahead", "to plan early") },
    {
      type: "edit",
      edit: edit("edit-3", "to speak clearly", "to speak plainly"),
    },
    { type: "done", dropped: 0, ms: { prep: 1, model: 1 } },
  ];
  await page.route("**/api/rewrite", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    }),
  );
  await page.goto(`${base}/en`, { waitUntil: "networkidle" });
  await page.getByLabel("Your text").fill(text);
  await page.getByRole("button", { name: "Rewrite" }).click();
  await page
    .getByRole("button", { name: "Accept", exact: true })
    .first()
    .waitFor();
}

// WCAG's contrast ratio between two sRGB colours, as channels from 0 to 255
const contrast = (a, b) => {
  const luminance = (rgb) => {
    const [r, g, bl] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

// A button's fill and label as drawn: a mixed colour is read back from a pixel, whatever its notation
const paint = (button) =>
  button.evaluate((element) => {
    const pixel = (colour) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      context.fillStyle = colour;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const style = getComputedStyle(element);
    return {
      fill: pixel(style.backgroundColor),
      label: pixel(style.color),
      filter: style.filter,
    };
  });

// Controls under the 24 px minimum (WCAG 2.5.8). A link inside a sentence is exempt, and the skip
// link has no size until it gets focus.
const smallTargets = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("button, a[href], input, textarea")]
      .filter((el) => !el.classList.contains("sr-only"))
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && (box.width < 24 || box.height < 24))
      .filter(({ el }) => !(el.tagName === "A" && el.closest("p, li")))
      .map(({ el, box }) => {
        const name =
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 20) ||
          el.tagName;
        return `${name} ${Math.round(box.width)}x${Math.round(box.height)}`;
      }),
  );

export async function run(t) {
  for (const scheme of ["light", "dark"]) {
    for (const path of ["/en", "/fr", "/en/privacy", "/en/history"]) {
      await check("a11y", `${scheme} ${path}`, async () => {
        const ctx = await t.browser.newContext({ colorScheme: scheme });
        const page = await openPage(ctx, "a11y");
        await page.goto(`${t.base}${path}`, { waitUntil: "networkidle" });
        const { violations } = await axe(page, (b) => b.withTags(AXE_TAGS));
        await ctx.close();
        if (violations.length) {
          const lines = violations.map(
            (v) =>
              `${v.id} (${v.impact}, ${v.nodes.length}x): ${v.nodes[0].target.join(" ")}`,
          );
          throw new Error(lines.join("\n"));
        }
      });
    }
  }

  // Accent colours are where contrast usually breaks
  for (const accent of ["blue", "violet", "emerald", "amber", "rose"]) {
    for (const scheme of ["light", "dark"]) {
      await check("a11y", `accent ${accent}, ${scheme}: contrast`, async () => {
        const ctx = await t.browser.newContext({ colorScheme: scheme });
        await ctx.addInitScript(
          (a) => localStorage.setItem("accent", a),
          accent,
        );
        const page = await openPage(ctx, "look");
        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByLabel("Your text").fill("x");
        // The submit button fades in; measure it once it has settled
        await page.waitForTimeout(500);
        const { violations } = await axe(page, (b) =>
          b.withRules(["color-contrast"]),
        );
        await ctx.close();
        if (violations.length) {
          const node = violations[0].nodes[0];
          const why = node.any[0]?.message ?? "";
          throw new Error(
            `${violations[0].nodes.length} element(s), first ${node.target.join(" ")}: ${why}`,
          );
        }
      });
    }
  }

  // axe measures the page at rest: a filled button under the pointer is measured here
  for (const accent of ["blue", "violet", "emerald", "amber", "rose"]) {
    for (const scheme of ["light", "dark"]) {
      await check(
        "a11y",
        `accent ${accent}, ${scheme}: a filled button under the pointer`,
        async () => {
          const ctx = await t.browser.newContext({ colorScheme: scheme });
          await ctx.addInitScript(
            (a) => localStorage.setItem("accent", a),
            accent,
          );
          const page = await openPage(ctx, "look");
          await openReview(page, t.base);
          const accept = page
            .getByRole("button", { name: "Accept", exact: true })
            .first();
          const rest = await paint(accept);
          await accept.hover();
          // Past the button's transition
          await page.waitForTimeout(400);
          const hovered = await paint(accept);
          await ctx.close();
          const ratio = contrast(hovered.label, hovered.fill);
          expect(hovered.filter === "none", `filtered: ${hovered.filter}`);
          expect(
            hovered.fill.join() !== rest.fill.join(),
            "the fill does not change under the pointer",
          );
          expect(ratio >= 4.5, `${ratio.toFixed(2)}:1 under the pointer`);
          return `${ratio.toFixed(2)}:1 under the pointer`;
        },
      );
    }
  }

  // The first states above hold no review: its colours, and a rejected edit's, are checked here
  for (const scheme of ["light", "dark"]) {
    await check("a11y", `${scheme} review, one edit rejected`, async () => {
      const ctx = await t.browser.newContext({ colorScheme: scheme });
      const page = await openPage(ctx, "look");
      await openReview(page, t.base);
      await page
        .getByRole("button", { name: "Reject", exact: true })
        .first()
        .click();
      // Let the colours settle before measuring them
      await page.waitForTimeout(500);
      const { violations } = await axe(page, (b) => b.withTags(AXE_TAGS));
      await ctx.close();
      if (violations.length) {
        const node = violations[0].nodes[0];
        throw new Error(
          `${violations[0].id}: ${node.target.join(" ")}: ${node.any[0]?.message ?? ""}`,
        );
      }
    });
  }

  // The words that change, in each state an edit can be in, and a wording with its warning
  for (const scheme of ["light", "dark"]) {
    await check(
      "a11y",
      `${scheme} review, changed words marked and a wording warned about`,
      async () => {
        const ctx = await t.browser.newContext({ colorScheme: scheme });
        const page = await openPage(ctx, "look");
        await openReview(page, t.base);
        const card = (n) => page.locator(`#review-edit-${n}`);
        const marks = page.locator(".box-decoration-clone");
        await marks.nth(5).waitFor();
        await card(0).getByRole("button", { name: "Reword" }).click();
        await card(0).getByRole("textbox").fill("12 plain");
        await card(0)
          .getByText(/The numbers are not the same/)
          .waitFor();
        await card(1)
          .getByRole("button", { name: "Accept", exact: true })
          .click();
        await card(2)
          .getByRole("button", { name: "Reject", exact: true })
          .click();
        // Let the colours settle before measuring them
        await page.waitForTimeout(500);
        const count = await marks.count();
        const { violations } = await axe(page, (b) => b.withTags(AXE_TAGS));
        await ctx.close();
        expect(count === 6, `${count} words marked`);
        if (violations.length) {
          const node = violations[0].nodes[0];
          throw new Error(
            `${violations[0].id}: ${node.target.join(" ")}: ${node.any[0]?.message ?? ""}`,
          );
        }
        return `${count} words marked`;
      },
    );
  }

  // Forced colours take the fills, the tints and the ring away: what is left must still tell apart
  // a decided edit, a button and the edit the letters act on
  await check(
    "a11y",
    "forced colours: accepted words struck, a filled button edged, the marked edit outlined",
    async () => {
      const ctx = await t.browser.newContext({ forcedColors: "active" });
      const page = await openPage(ctx, "look");
      await openReview(page, t.base);
      await page.getByText(/A accept, R reject/).waitFor();
      const card = (n) => page.locator(`#review-edit-${n}`);
      const style = (locator, property) =>
        locator.evaluate((el, p) => getComputedStyle(el)[p], property);
      const accept = (n) =>
        card(n).getByRole("button", { name: "Accept", exact: true });
      const edge = await style(accept(0), "borderTopWidth");
      const outline = await style(card(0), "outlineStyle");
      await accept(1).click();
      // The words the second edit takes out, which it shares the rest of its line with
      const strike = await style(
        card(1).locator(".box-decoration-clone").first(),
        "textDecorationLine",
      );
      await ctx.close();
      expect(edge === "1px", `a pending Accept's edge: ${edge}`);
      expect(outline === "solid", `the marked edit's outline: ${outline}`);
      expect(strike === "line-through", `accepted words: ${strike}`);
    },
  );

  const screens = [
    ["phone", 360, 740],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
  ];
  for (const [name, width, height] of screens) {
    for (const path of ["/en", "/fr", "/en/history", "/en/privacy"]) {
      await check("layout", `${name} ${path}: no sideways scroll`, async () => {
        const ctx = await t.browser.newContext({ viewport: { width, height } });
        const page = await openPage(ctx, "look");
        await page.goto(`${t.base}${path}`, { waitUntil: "networkidle" });
        const over = await overflowX(page);
        await ctx.close();
        expect(over <= 0, `${over}px too wide`);
      });
    }
  }

  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true };

  await check(
    "layout",
    "touch targets on a phone are at least 24x24 px, on the page and in a review",
    async () => {
      const ctx = await t.browser.newContext(phone);
      const page = await openPage(ctx, "look");
      await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
      const before = await smallTargets(page);
      await openReview(page, t.base);
      const small = [...new Set([...before, ...(await smallTargets(page))])];
      await ctx.close();
      if (small.length)
        warn(`${small.length} small: ${small.slice(0, 4).join("; ")}`);
    },
  );

  const member = await createUser(t.env, "look");
  try {
    await seedHistory(t.env, member, 1);

    // The page a visitor cannot reach, with everything it can open
    const historyOpen = async (page, lang, row, account) => {
      await page.goto(`${t.base}/${lang}/history`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("button", { name: row }).first().click();
      await page.getByRole("button", { name: account }).click();
      // Let the colours settle before measuring them
      await page.waitForTimeout(500);
    };

    for (const scheme of ["light", "dark"]) {
      await check(
        "a11y",
        `${scheme} signed-in history, a row's question and the account's open`,
        async () => {
          const ctx = await t.browser.newContext({ colorScheme: scheme });
          await ctx.addCookies(await sessionCookies(t.env, member));
          const page = await openPage(ctx, "a11y");
          await historyOpen(
            page,
            "en",
            /^Delete the rewrite of/,
            "Delete my account",
          );
          const { violations } = await axe(page, (b) => b.withTags(AXE_TAGS));
          await ctx.close();
          if (violations.length) {
            const node = violations[0].nodes[0];
            throw new Error(
              `${violations[0].id}: ${node.target.join(" ")}: ${node.any[0]?.message ?? ""}`,
            );
          }
        },
      );
    }

    await check(
      "layout",
      "the signed-in history fits a small phone with its questions open, in both languages, with touch targets of 24 px",
      async () => {
        const ctx = await t.browser.newContext({
          viewport: { width: 320, height: 640 },
          hasTouch: true,
        });
        await ctx.addCookies(await sessionCookies(t.env, member));
        const page = await openPage(ctx, "look");
        const small = [];
        for (const [lang, row, account] of [
          ["en", /^Delete the rewrite of/, "Delete my account"],
          ["fr", /^Supprimer la réécriture du/, "Supprimer mon compte"],
        ]) {
          await historyOpen(page, lang, row, account);
          const over = await overflowX(page);
          expect(over <= 0, `${lang}: ${over}px too wide`);
          small.push(...(await smallTargets(page)));
        }
        await ctx.close();
        if (small.length)
          warn(`${small.length} small: ${small.slice(0, 4).join("; ")}`);
      },
    );

    await check(
      "layout",
      "fields on a phone are 16 px at least, so that iOS does not zoom the page",
      async () => {
        const ctx = await t.browser.newContext(phone);
        await ctx.addCookies(await sessionCookies(t.env, member));
        const page = await openPage(ctx, "look");
        const fontSizes = () =>
          page.evaluate(() =>
            [
              ...document.querySelectorAll(
                "input:not([type=checkbox]), textarea",
              ),
            ].map((el) => parseFloat(getComputedStyle(el).fontSize)),
          );

        await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
        await page.getByText("Options").click();
        const editor = await fontSizes();
        await page.goto(`${t.base}/en/history`, { waitUntil: "networkidle" });
        await page.getByRole("searchbox").waitFor();
        const sizes = [...editor, ...(await fontSizes())];
        await ctx.close();
        expect(sizes.length >= 3, `${sizes.length} fields found`);
        expect(Math.min(...sizes) >= 16, `sizes: ${sizes.join(", ")}`);
        return `${sizes.length} fields`;
      },
    );
  } finally {
    await deleteUser(t.env, member);
  }

  // Long texts fill the three lines a row shows, and the French toolbar wraps on a phone
  const writer = await createUser(t.env, "skeleton");
  try {
    const long = (n) =>
      `Texte ${n}. ${"Une phrase assez longue pour remplir plusieurs lignes de la liste. ".repeat(10)}`;
    await insertRewrites(
      t.env,
      [0, 1, 2].map((n) => ({
        user_id: writer.id,
        original: long(n),
        locale: "fr",
      })),
    );
    for (const [lang, link, width, height] of [
      ["fr", "Historique", 390, 844],
      ["en", "History", 1280, 900],
    ]) {
      await check(
        "layout",
        `the history's skeleton holds the place of the list it waits for, in ${lang} at ${width} px`,
        async () => {
          const ctx = await t.browser.newContext({
            viewport: { width, height },
          });
          await ctx.addCookies(await sessionCookies(t.env, writer));
          const page = await openPage(ctx, "look");
          let answer = () => {};
          const held = new Promise((resolve) => (answer = resolve));
          await page.route(`**/${lang}/history?_rsc=*`, async (route) => {
            if (!route.request().headers()["next-router-prefetch"]) await held;
            await route.continue();
          });
          await page.goto(`${t.base}/${lang}`, { waitUntil: "networkidle" });
          await page.getByRole("link", { name: link }).click();
          await page.locator("main [aria-busy]").waitFor({ timeout: 5000 });
          // The toolbar's height, and where the first two rows start
          const waiting = await page.evaluate(() => {
            const [toolbar, list] =
              document.querySelector("main [aria-busy]").children;
            return [
              toolbar.getBoundingClientRect().height,
              ...[...list.children]
                .slice(0, 2)
                .map((row) => row.getBoundingClientRect().top),
            ];
          });
          answer();
          await page.getByRole("searchbox").waitFor({ timeout: 10000 });
          const arrived = await page.evaluate(() => {
            const toolbar = document
              .querySelector("main input[type=search]")
              .closest("label").parentElement;
            return [
              toolbar.getBoundingClientRect().height,
              ...[...document.querySelectorAll("main ul > li")]
                .slice(0, 2)
                .map((row) => row.getBoundingClientRect().top),
            ];
          });
          await ctx.close();
          const round = (values) => values.map(Math.round).join(", ");
          expect(
            arrived.length === 3 &&
              waiting.every((value, i) => Math.abs(value - arrived[i]) <= 1),
            `toolbar and rows ${round(waiting)} before, ${round(arrived)} after`,
          );
          return round(arrived);
        },
      );
    }
  } finally {
    await deleteUser(t.env, writer);
  }
}
