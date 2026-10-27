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
    await mockRewrite(page, 200, { edits: [EDIT] });
    await page.goto("/en");

    await page.getByLabel("Your text").fill(TEXT);
    await expect(page.getByText("6 words")).toBeVisible();
    await page.getByRole("button", { name: "Rewrite" }).click();

    await expect(page.getByText("Plainer word")).toBeVisible();
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
