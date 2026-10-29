import { expect, test, type Page } from "@playwright/test";

const TEXT = "It is crucial to act now.";
const EDIT = {
  id: "edit-0",
  original: "crucial",
  replacement: "important",
  reason: "Plainer word",
  start: 6,
  end: 13,
};

// The real route needs Claude and a signed-in user, so the browser gets a canned answer
async function mockRewrite(page: Page, status: number, body: unknown) {
  await page.route("**/api/rewrite", (route) =>
    route.fulfill({ status, json: body }),
  );
}

// The same, as the real route sends it: one JSON event per line
async function mockStream(page: Page, edits: unknown[]) {
  const events = [
    { type: "start", references: [] },
    ...edits.map((edit) => ({ type: "edit", edit })),
    { type: "done", dropped: 0, ms: { prep: 1, model: 1 } },
  ];
  await page.route("**/api/rewrite", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/x-ndjson",
      body: events.map((event) => JSON.stringify(event)).join("\n") + "\n",
    }),
  );
}

test.describe("language", () => {
  test("follows the browser language on first visit", async ({ browser }) => {
    const context = await browser.newContext({ locale: "fr-FR" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByLabel("Votre texte")).toBeVisible();
    await context.close();
  });

  test("switches between English and French", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByLabel("Your text")).toBeVisible();

    await page.getByRole("link", { name: "fr", exact: true }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByLabel("Votre texte")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("shows a localized 404", async ({ page }) => {
    const response = await page.goto("/fr/nope");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page introuvable")).toBeVisible();
  });
});

test.describe("rewrite", () => {
  test("reviews and accepts an edit, then shows the final text", async ({
    page,
  }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");

    await page.getByLabel("Your text").fill(TEXT);
    await expect(page.getByText("6 words")).toBeVisible();
    await page.getByRole("button", { name: "Rewrite" }).click();

    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
    await expect(page.getByTestId("result")).toHaveText(TEXT);

    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByTestId("result")).toHaveText(
      "It is important to act now.",
    );
  });

  test("explains that sign-in is required", async ({ page }) => {
    await mockRewrite(page, 401, { error: "unauthorized" });
    await page.goto("/fr");

    await page.getByLabel("Votre texte").fill(TEXT);
    await page.getByRole("button", { name: "Réécrire" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Connectez-vous" }),
    ).toBeVisible();
    await expect(page.getByLabel("Votre texte")).toHaveValue(TEXT);
  });

  test("blocks texts over the limit", async ({ page }) => {
    await page.goto("/en");
    await page.getByLabel("Your text").fill("a".repeat(5001));
    await expect(
      page.getByRole("alert").filter({ hasText: "too long" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Rewrite" })).toBeDisabled();
  });
});

test.describe("appearance", () => {
  test("follows the system theme, then lets the user pick night mode", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "light" });
    const page = await context.newPage();
    await page.goto("/en");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Night" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // The choice survives a reload, without a flash of the other theme
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await context.close();
  });

  test("remembers the accent colour", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Violet" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-accent", "violet");
  });

  test("theme controls are translated", async ({ page }) => {
    await page.goto("/fr");
    await page.getByRole("button", { name: "Apparence" }).click();
    await expect(page.getByRole("radio", { name: "Nuit" })).toBeVisible();
  });
});

test.describe("home page", () => {
  test("shows the pitch, a before/after example and where references come from", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "second pair of eyes",
    );
    await expect(page).toHaveTitle(/Rewrity/);
    await expect(page.getByText("Before", { exact: true })).toBeVisible();
    await expect(page.getByText("After", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Where the style references come from",
      }),
    ).toBeVisible();
  });

  test("is translated in French", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Un second regard",
    );
    await expect(page.getByText("Avant", { exact: true })).toBeVisible();
  });

  test("does not scroll sideways on a phone", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 740 },
    });
    const page = await context.newPage();
    await page.goto("/en");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

test.describe("discovery", () => {
  test("serves a sitemap and robots file", async ({ request }) => {
    const sitemap = await request.get("/sitemap.xml");
    expect(sitemap.ok()).toBe(true);
    expect(await sitemap.text()).toContain("/fr/privacy");
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /api/");
  });

  test("serves a share image for each language", async ({ request }) => {
    for (const locale of ["en", "fr"]) {
      const response = await request.get(`/${locale}/opengraph-image`);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("image/png");
    }
  });

  test("fills the editor with an example, then rewrites with the keyboard", async ({
    page,
  }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(page.getByLabel("Your text")).not.toBeEmpty();
    await page.getByLabel("Your text").press("Control+Enter");
    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
  });
});
