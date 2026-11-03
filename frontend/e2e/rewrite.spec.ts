import { expect, test as base, type Page } from "@playwright/test";

// Every test also fails on an exception, a console error or a broken request. Failed loads show
// up twice (as a console line and as a response), so only the response is judged; the refusals
// mocked on the rewrite route and the deliberately missing page are expected.
const test = base.extend<{ quietBrowser: void }>({
  quietBrowser: [
    async ({ page }, use) => {
      const problems: string[] = [];
      const expected = (url: string) =>
        url.includes("/api/rewrite") || url.includes("/nope");
      page.on("pageerror", (error) =>
        problems.push(`exception: ${error.message}`),
      );
      page.on("console", (message) => {
        if (
          message.type() === "error" &&
          !message.text().includes("Failed to load resource")
        ) {
          problems.push(`console: ${message.text()}`);
        }
      });
      page.on("requestfailed", (request) => {
        if (request.failure()?.errorText !== "net::ERR_ABORTED") {
          problems.push(`request: ${request.url()}`);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 400 && !expected(response.url())) {
          problems.push(`http ${response.status()}: ${response.url()}`);
        }
      });
      await use();
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

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
  test.describe(() => {
    test.use({ locale: "fr-FR" });

    test("follows the browser language on first visit", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveURL(/\/fr$/);
      await expect(page.getByLabel("Votre texte")).toBeVisible();
    });
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

  for (const [code, english, french] of [
    ["quota_exceeded", "today's limit", "limite du jour"],
    ["too_many_requests", "already running", "d\u00e9j\u00e0 en cours"],
    ["global_quota_exceeded", "overall usage limit", "limite d'utilisation"],
  ]) {
    test(`explains a ${code} refusal in both languages`, async ({ page }) => {
      await mockRewrite(page, 429, { error: code });
      for (const [path, label, button, message] of [
        ["/en", "Your text", "Rewrite", english],
        ["/fr", "Votre texte", "R\u00e9\u00e9crire", french],
      ]) {
        await page.goto(path);
        await page.getByLabel(label).fill(TEXT);
        await page.getByRole("button", { name: button, exact: true }).click();
        await expect(
          page.getByRole("alert").filter({ hasText: message }),
        ).toBeVisible();
        // The text stays, so nothing is lost
        await expect(page.getByLabel(label)).toHaveValue(TEXT);
      }
    });
  }

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
  test.describe(() => {
    test.use({ colorScheme: "light" });

    test("follows the system theme, then lets the user pick night mode", async ({
      page,
    }) => {
      await page.goto("/en");
      await expect(page.locator("html")).not.toHaveClass(/dark/);

      await page.getByRole("button", { name: "Appearance" }).click();
      await page.getByRole("radio", { name: "Night" }).click();
      await expect(page.locator("html")).toHaveClass(/dark/);

      // The choice survives a reload, without a flash of the other theme
      await page.reload();
      await expect(page.locator("html")).toHaveClass(/dark/);
    });
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

  test.describe(() => {
    test.use({ viewport: { width: 360, height: 740 } });

    test("does not scroll sideways on a phone", async ({ page }) => {
      await page.goto("/en");
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
});

test.describe("moving around the site", () => {
  test("keeps the text when the language changes", async ({ page }) => {
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("link", { name: "fr", exact: true }).click();
    await expect(page.getByLabel("Votre texte")).toHaveValue(TEXT);
    await page.getByRole("link", { name: "en", exact: true }).click();
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });

  test("keeps the text after a trip to another page and back", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("link", { name: "History" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
    await page.goBack();
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });
});

test.describe("a very narrow screen", () => {
  test.use({ viewport: { width: 280, height: 653 } });

  test("does not scroll sideways, in French either", async ({ page }) => {
    for (const path of ["/en", "/fr", "/fr/privacy", "/fr/history"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("keeps the intensity labels apart and whole, in French too", async ({
    page,
  }) => {
    for (const path of ["/en", "/fr"]) {
      await page.goto(path);
      await page.locator("summary").click();
      const radios = page.getByRole("radio");
      const group = (await page.getByRole("radiogroup").boundingBox())!;
      const boxes = [];
      for (const radio of await radios.all()) {
        // The word fits inside its own button
        expect(
          await radio.evaluate((el) => el.scrollWidth <= el.clientWidth),
          path,
        ).toBe(true);
        const box = (await radio.boundingBox())!;
        expect(box.x + box.width, path).toBeLessThanOrEqual(
          group.x + group.width,
        );
        expect(box.height, path).toBeLessThan(40);
        boxes.push(box);
      }
      for (const [i, a] of boxes.entries()) {
        for (const b of boxes.slice(i + 1)) {
          const apart =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(apart, path).toBe(true);
        }
      }
    }
  });
});

test("keeps what was typed before the scripts arrived", async ({ page }) => {
  const sent: string[] = [];
  await page.route("**/auth/v1/otp**", async (route) => {
    sent.push(route.request().postData() ?? "");
    await route.fulfill({ status: 200, json: {} });
  });
  await page.route("**/_next/static/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Your text").fill("Typed before the scripts");
  await page.getByText("Options").click();
  await page.getByLabel(/Your own writing/).fill("A sample of mine");
  await page.getByLabel("Email").fill("early@example.com");

  await expect(page.getByText("4 words")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("16 / 1500")).toBeVisible();
  await expect(page.getByLabel(/Your own writing/)).toHaveValue(
    "A sample of mine",
  );
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("status")).toBeVisible();
  expect(sent.join()).toContain("early@example.com");
});

for (const width of [320, 360, 412, 600]) {
  test.describe(`a screen ${width} px wide`, () => {
    test.use({ viewport: { width, height: 740 } });

    test("reaches every choice in the Appearance panel", async ({ page }) => {
      await page.goto("/en");
      await page.getByRole("button", { name: "Appearance" }).click();
      const panel = page.getByRole("dialog", { name: "Appearance" });
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await panel.getByRole("radio", { name: "Night" }).click();
      await expect(page.locator("html")).toHaveClass(/dark/);
      await panel.getByRole("radio", { name: "Blue" }).click();
      await expect(panel.getByRole("radio", { name: "Blue" })).toBeChecked();
    });

    test("keeps the intensity labels on one line", async ({ page }) => {
      await page.goto("/en");
      await page.getByText("Options").click();
      for (const name of ["Light", "Standard", "Thorough"]) {
        const box = (await page.getByRole("radio", { name }).boundingBox())!;
        expect(box.height).toBeLessThan(40);
      }
    });

    test("does not scroll sideways with a long link in the text", async ({
      page,
    }) => {
      const link = `https://example.com/${"tracking".repeat(20)}end`;
      const text = `See ${link} for more.`;
      await mockStream(page, [
        {
          id: "edit-0",
          original: link,
          replacement: `${link}/short`,
          reason: "Plainer word",
          start: 4,
          end: 4 + link.length,
        },
      ]);
      await page.goto("/en");
      await page.getByLabel("Your text").fill(text);
      await page.getByRole("button", { name: "Rewrite" }).click();
      await expect(page.getByTestId("result")).toHaveText(text);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}

test.describe("discovery", () => {
  test("gives each page its own canonical address and translations", async ({
    page,
  }) => {
    const links = () =>
      page.evaluate(() => ({
        canonical: document.querySelector<HTMLLinkElement>(
          "link[rel=canonical]",
        )?.href,
        french: document.querySelector<HTMLLinkElement>(
          "link[rel=alternate][hreflang=fr]",
        )?.href,
      }));
    await page.goto("/en/privacy");
    expect((await links()).canonical).toMatch(/\/en\/privacy$/);
    expect((await links()).french).toMatch(/\/fr\/privacy$/);
    await page.goto("/fr/history");
    expect((await links()).canonical).toMatch(/\/fr\/history$/);
    await page.goto("/fr");
    expect((await links()).canonical).toMatch(/\/fr$/);
  });

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
