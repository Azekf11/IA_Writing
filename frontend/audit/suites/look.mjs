// Accessibility (axe, both themes, every accent) and layout on three screen sizes.
import AxeBuilder from "@axe-core/playwright";
import { openPage, overflowX } from "../browser.mjs";
import { check, expect, warn } from "../lib.mjs";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag22aa"];

async function axe(page, configure) {
  const builder = new AxeBuilder({ page });
  return configure(builder).analyze();
}

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
        const page = await ctx.newPage();
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

  const screens = [
    ["phone", 360, 740],
    ["tablet", 768, 1024],
    ["desktop", 1440, 900],
  ];
  for (const [name, width, height] of screens) {
    for (const path of ["/en", "/fr", "/en/history", "/en/privacy"]) {
      await check("layout", `${name} ${path}: no sideways scroll`, async () => {
        const ctx = await t.browser.newContext({ viewport: { width, height } });
        const page = await ctx.newPage();
        await page.goto(`${t.base}${path}`, { waitUntil: "networkidle" });
        const over = await overflowX(page);
        await ctx.close();
        expect(over <= 0, `${over}px too wide`);
      });
    }
  }

  await check(
    "layout",
    "touch targets on a phone are at least 24x24 px",
    async () => {
      const ctx = await t.browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const page = await ctx.newPage();
      await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("button, a[href], input, textarea")]
          .map((el) => ({ el, box: el.getBoundingClientRect() }))
          .filter(
            ({ box }) => box.width > 0 && (box.width < 24 || box.height < 24),
          )
          // A link inside a sentence is exempt (WCAG 2.5.8)
          .filter(({ el }) => !(el.tagName === "A" && el.closest("p, li")))
          .map(({ el, box }) => {
            const name =
              el.getAttribute("aria-label") ||
              el.textContent?.trim().slice(0, 20) ||
              el.tagName;
            return `${name} ${Math.round(box.width)}x${Math.round(box.height)}`;
          }),
      );
      await ctx.close();
      if (small.length)
        warn(`${small.length} small: ${small.slice(0, 4).join("; ")}`);
    },
  );
}
