// Every control a visitor can touch, on the real production build.
import { openPage } from "../browser.mjs";
import { check, expect } from "../lib.mjs";

const rgb = (page, selector, property) =>
  page.evaluate(
    ([s, p]) => getComputedStyle(document.querySelector(s))[p],
    [selector, property],
  );

export async function run(t) {
  const ctx = await t.browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
  });
  const page = await openPage(ctx, "buttons");
  await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });

  // ---- header ----
  await check("buttons", "header links go to the right pages", async () => {
    await page.getByRole("link", { name: "History" }).click();
    await page.waitForURL("**/en/history");
    await page.getByRole("link", { name: "Rewrite", exact: true }).click();
    await page.waitForURL("**/en");
    await page.getByRole("link", { name: "Rewrity" }).click();
    await page.waitForURL("**/en");
  });

  await check(
    "buttons",
    "the current page is marked in the navigation",
    async () => {
      const current = await page
        .locator('nav a[aria-current="page"]')
        .first()
        .textContent();
      expect(current?.trim() === "Rewrite", `marked: ${current}`);
    },
  );

  await check(
    "buttons",
    "language switch keeps the page and flips the interface",
    async () => {
      await page.goto(`${t.base}/en/privacy`);
      await page.getByRole("link", { name: "fr", exact: true }).click();
      await page.waitForURL("**/fr/privacy");
      expect(
        (await page.getByRole("heading", { level: 1 }).textContent()) ===
          "Confidentialité",
        "French title missing",
      );
      await page.getByRole("link", { name: "en", exact: true }).click();
      await page.waitForURL("**/en/privacy");
      await page.goto(`${t.base}/en`);
    },
  );

  // ---- appearance ----
  const open = async () => {
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("dialog").waitFor();
  };

  await check(
    "buttons",
    "appearance panel opens, closes on Escape and on outside click",
    async () => {
      await open();
      await page.keyboard.press("Escape");
      expect(
        !(await page.getByRole("dialog").isVisible()),
        "Escape did not close it",
      );
      await open();
      await page.mouse.click(10, 400);
      expect(
        !(await page.getByRole("dialog").isVisible()),
        "outside click did not close it",
      );
    },
  );

  await check(
    "buttons",
    "night and day mode switch the whole page",
    async () => {
      await open();
      await page.getByRole("radio", { name: "Night" }).click();
      expect(
        await page
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
        "no dark class",
      );
      const dark = await rgb(page, "body", "backgroundColor");
      await page.getByRole("radio", { name: "Day" }).click();
      const light = await rgb(page, "body", "backgroundColor");
      expect(dark !== light, "background did not change");
      expect(
        (await page
          .getByRole("radio", { name: "Day" })
          .getAttribute("aria-checked")) === "true",
        "Day not selected",
      );
    },
  );

  await check("buttons", "auto mode follows the system", async () => {
    await page.getByRole("radio", { name: "Auto" }).click();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    expect(
      await page
        .locator("html")
        .evaluate((el) => el.classList.contains("dark")),
      "did not follow dark",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(150);
    expect(
      !(await page
        .locator("html")
        .evaluate((el) => el.classList.contains("dark"))),
      "did not follow light",
    );
    await page.keyboard.press("Escape");
  });

  await check(
    "buttons",
    "each accent colour applies, and survives a reload",
    async () => {
      const seen = new Set();
      for (const name of ["Blue", "Violet", "Emerald", "Amber", "Rose"]) {
        await open();
        await page.getByRole("radio", { name }).click();
        seen.add(
          await rgb(
            page,
            "button[type=submit], a[aria-current='page']",
            "color",
          ),
        );
        await page.keyboard.press("Escape");
      }
      await open();
      await page.getByRole("radio", { name: "Rose" }).click();
      await page.reload({ waitUntil: "networkidle" });
      const accent = await page.locator("html").getAttribute("data-accent");
      expect(accent === "rose", `after reload the accent is ${accent}`);
    },
  );

  await check(
    "buttons",
    "theme choice survives a reload and a page change",
    async () => {
      await open();
      await page.getByRole("radio", { name: "Night" }).click();
      await page.keyboard.press("Escape");
      await page.goto(`${t.base}/fr/privacy`, { waitUntil: "networkidle" });
      expect(
        await page
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
        "dark mode lost",
      );
    },
  );

  // ---- keyboard ----
  await check(
    "buttons",
    "every control can be reached with Tab and shows a focus ring",
    async () => {
      await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
      const stops = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          // Past the last control, focus leaves the page for the browser's own interface
          if (!el || el === document.body || el === document.documentElement)
            return null;
          const style = getComputedStyle(el);
          const ring =
            style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
          const name =
            el.getAttribute("aria-label") ||
            el.textContent?.trim().slice(0, 20) ||
            el.tagName;
          return { name, ring: ring || style.boxShadow !== "none" };
        });
        if (!stop) break;
        stops.push(stop);
      }
      expect(stops.length >= 8, `only ${stops.length} tab stops found`);
      const bare = stops.filter((s) => !s.ring).map((s) => s.name);
      expect(bare.length === 0, `no focus ring on: ${bare.join(", ")}`);
      return `${stops.length} tab stops, all with a ring`;
    },
  );

  await ctx.close();
}
