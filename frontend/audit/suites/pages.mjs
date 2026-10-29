// Every public page: it loads, it has the right headers, nothing sensitive leaks.
import { openPage } from "../browser.mjs";
import { check, expect } from "../lib.mjs";

const PAGES = [
  "/en",
  "/fr",
  "/en/privacy",
  "/fr/privacy",
  "/en/history",
  "/fr/history",
];

export async function run(t) {
  const context = await t.browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await openPage(context, "pages");

  for (const path of PAGES) {
    await check("pages", `${path} loads`, async () => {
      const response = await page.goto(`${t.base}${path}`, {
        waitUntil: "networkidle",
      });
      expect(response?.status() === 200, `status ${response?.status()}`);
      const lang = await page.locator("html").getAttribute("lang");
      expect(lang === path.slice(1, 3), `html lang is "${lang}"`);
      expect(
        (await page.title()).includes("Rewrity"),
        `title is "${await page.title()}"`,
      );
      expect(
        (await page.locator("h1").count()) === 1,
        "page needs exactly one h1",
      );
    });
  }

  await check("pages", "root redirects by browser language", async () => {
    const fr = await t.browser.newContext({ locale: "fr-FR" });
    const p = await fr.newPage();
    await p.goto(`${t.base}/`);
    const url = p.url();
    await fr.close();
    expect(url.endsWith("/fr"), `went to ${url}`);
  });

  await check("pages", "unknown pages give a translated 404", async () => {
    const cases = [
      ["/en/nope", "Page not found"],
      ["/fr/nope", "Page introuvable"],
    ];
    for (const [path, text] of cases) {
      const response = await page.goto(`${t.base}${path}`);
      expect(
        response?.status() === 404,
        `${path} status ${response?.status()}`,
      );
      expect(
        await page.getByText(text).first().isVisible(),
        `${path} shows no "${text}"`,
      );
    }
  });

  await check("pages", "sitemap, robots and share image", async () => {
    const sitemap = await page.request.get(`${t.base}/sitemap.xml`);
    expect(
      sitemap.ok() && (await sitemap.text()).includes("/fr/privacy"),
      "sitemap is wrong",
    );
    const robots = await (
      await page.request.get(`${t.base}/robots.txt`)
    ).text();
    expect(robots.includes("Disallow: /api/"), "robots does not block the API");
    for (const locale of ["en", "fr"]) {
      const image = await page.request.get(
        `${t.base}/${locale}/opengraph-image`,
      );
      const type = image.headers()["content-type"];
      expect(
        image.ok() && type === "image/png",
        `${locale} share image (${type})`,
      );
    }
  });

  await check(
    "security",
    "security headers on pages and on the API",
    async () => {
      const wanted = [
        "x-content-type-options",
        "x-frame-options",
        "referrer-policy",
        "permissions-policy",
      ];
      for (const url of [`${t.base}/en`, `${t.base}/api/rewrite`]) {
        const method = url.endsWith("rewrite") ? "POST" : "GET";
        const response = await page.request.fetch(url, { method });
        const missing = wanted.filter((name) => !response.headers()[name]);
        expect(missing.length === 0, `${url} lacks ${missing.join(", ")}`);
      }
    },
  );

  await check("security", "no secret reaches the browser", async () => {
    await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
    const html = await page.content();
    const leak = /sb_secret|service_role|ANTHROPIC_API_KEY|sk-ant/.test(html);
    expect(!leak, "a secret-looking string is in the page");
  });

  await context.close();
}
