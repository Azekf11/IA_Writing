import { readFile } from "node:fs/promises";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import {
  encodeEvent,
  STREAM_TYPE,
  type StreamEvent,
} from "@/lib/rewrite/protocol";
import type { Edit } from "@/lib/rewrite/types";

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

const SECOND = {
  ...EDIT,
  id: "edit-1",
  original: "act",
  replacement: "move",
  reason: "Shorter",
  start: 17,
  end: 20,
};

// The real route needs Claude and a signed-in user, so the browser gets a canned answer
async function mockRewrite(page: Page, status: number, body: unknown) {
  await page.route("**/api/rewrite", (route) =>
    route.fulfill({ status, json: body }),
  );
}

// The same, as the real route sends it: one JSON event per line
function streamed(edits: Edit[]) {
  const events: StreamEvent[] = [
    { type: "start", references: [] },
    ...edits.map((edit): StreamEvent => ({ type: "edit", edit })),
    { type: "done", dropped: 0, ms: { prep: 1, model: 1 } },
  ];
  return {
    status: 200,
    contentType: STREAM_TYPE,
    body: events.map(encodeEvent).join(""),
  };
}

async function mockStream(page: Page, edits: Edit[]) {
  await page.route("**/api/rewrite", (route) => route.fulfill(streamed(edits)));
}

// A review longer than the screen, one edit per paragraph
const LONG_TEXT = Array.from(
  { length: 14 },
  (_, n) => `Point ${n}: it is crucial to plan well ahead.`,
).join("\n\n");
const LONG_EDITS = [...LONG_TEXT.matchAll(/crucial/g)].map(
  (match, n): Edit => ({
    ...EDIT,
    id: `edit-${n}`,
    start: match.index,
    end: match.index + EDIT.original.length,
  }),
);

// Shown once the answer is complete, when the review's shortcuts start to work
const KEYS_LEGEND = { en: /A accept, R reject/, fr: /A accepter, R refuser/ };

const openLongReview = async (page: Page, locale: "en" | "fr" = "en") => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockStream(page, LONG_EDITS);
  await page.goto(`/${locale}`);
  const box = page.locator("textarea").first();
  await box.fill(LONG_TEXT);
  await box.press("Control+Enter");
  await expect(page.locator("#review-edit-13")).toBeVisible();
  // The cards arrive while the answer is still being written, when the shortcuts do nothing yet
  await expect(page.getByText(KEYS_LEGEND[locale])).toBeVisible();
};

const stickyRow = (page: Page) =>
  page.locator(".sticky").filter({ has: page.locator("button") });

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

  for (const [locale, title] of [
    ["en", "Page not found · Rewrity"],
    ["fr", "Page introuvable · Rewrity"],
  ]) {
    test(`names a missing page in the tab, in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/nope`, { waitUntil: "networkidle" });
      // Once React has taken the page over, the title is the one it keeps
      await expect
        .poll(() =>
          page
            .getByRole("main")
            .evaluate((main) =>
              Object.keys(main).some((key) => key.startsWith("__reactFiber")),
            ),
        )
        .toBe(true);
      await expect(page).toHaveTitle(title);
    });

    // Next serves this page as an empty shell that the scripts draw: its title is what a screen
    // reader can say at load, and all that a browser without scripts shows
    test(`names a missing page before the scripts run, in ${locale}`, async ({
      request,
    }) => {
      const response = await request.get(`/${locale}/nope`);
      expect(response.status()).toBe(404);
      const html = await response.text();
      expect(html.match(/<title>([^<]*)<\/title>/)?.[1]).toBe(title);
    });
  }
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

  // Rewrite is disabled while the request runs, and the browser drops its focus to the page
  test("gives the focus back to Rewrite when the request is refused", async ({
    page,
  }) => {
    await page.route("**/api/rewrite", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({ status: 401, json: { error: "unauthorized" } });
    });
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    const rewrite = page.getByRole("button", { name: "Rewrite", exact: true });
    await rewrite.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Sign in to rewrite" }),
    ).toBeVisible();
    await expect(rewrite).toBeFocused();
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

test.describe("in the middle of a review", () => {
  const ACCEPTED = "It is important to act now.";
  const openReview = async (page: Page) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    await page.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(page.getByTestId("result")).toHaveText(ACCEPTED);
  };
  const countRewrites = (page: Page) => {
    const sent = { count: 0 };
    page.on("request", (request) => {
      // The line about the limits asks too, each time the page opens: with no text
      if (request.url().includes("/api/rewrite") && request.method() === "POST")
        sent.count++;
    });
    return sent;
  };

  test("keeps the decisions when the language changes", async ({ page }) => {
    const sent = countRewrites(page);
    await openReview(page);
    await page.getByRole("link", { name: "fr", exact: true }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByTestId("result")).toHaveText(ACCEPTED);
    await expect(
      page.getByText("1 acceptée, 0 refusée, 0 à décider"),
    ).toBeVisible();
    expect(sent.count).toBe(1);
  });

  test("keeps the decisions after a trip to the history and back", async ({
    page,
  }) => {
    const sent = countRewrites(page);
    await openReview(page);
    await page.getByRole("link", { name: "History" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
    await page.goBack();
    await expect(page.getByTestId("result")).toHaveText(ACCEPTED);
    await expect(
      page.getByText("1 accepted, 0 rejected, 0 to decide"),
    ).toBeVisible();
    expect(sent.count).toBe(1);
  });

  // Back puts the page where the reader left it, once the review has come back: the top for a link
  // in the header, the foot for one in the footer. The heading holds the focus, and the letters
  // with it, so it must not stay out of sight.
  for (const [where, viewport, link, title] of [
    [
      "the history",
      { width: 360, height: 740 },
      (page: Page) => page.getByRole("link", { name: "History" }),
      "History",
    ],
    [
      "the privacy page",
      { width: 1280, height: 900 },
      (page: Page) =>
        page.locator("footer").getByRole("link", { name: "Privacy" }),
      "Privacy",
    ],
  ] as const) {
    test.describe(() => {
      test.use({ viewport });

      test(`brings the review into view after a trip to ${where} and back`, async ({
        page,
      }) => {
        await openReview(page);
        await link(page).click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
        await page.goBack();
        await expect(page).toHaveURL(/\/en$/);
        const heading = page.getByRole("heading", { name: "Suggested edits" });
        await expect(heading).toBeFocused();
        await expect(heading).toBeInViewport({ ratio: 1 });
        // In the upper half, not merely inside the screen: a page left a little below the top
        // comes back with the heading already inside the foot of the screen, the review below it
        await expect
          .poll(async () => (await heading.boundingBox())?.y)
          .toBeLessThan(viewport.height / 2);
      });
    });
  }

  test("gives back the editor and its way back, if that is where the reader was", async ({
    page,
  }) => {
    await openReview(page);
    await page
      .getByRole("button", { name: "Back to the original text" })
      .click();
    await expect(page.getByLabel("Your text")).toBeFocused();
    await page.getByRole("link", { name: "fr", exact: true }).click();
    await expect(page.getByLabel("Votre texte")).toHaveValue(TEXT);
    await page.getByRole("button", { name: "Revenir à la relecture" }).click();
    await expect(page.getByTestId("result")).toHaveText(ACCEPTED);
  });

  test("keeps it out of the browser's storage, so a reload ends it", async ({
    page,
  }) => {
    await openReview(page);
    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored).not.toContain("crucial");
    await page.reload();
    await expect(page.getByTestId("result")).toHaveCount(0);
    await expect(page.getByLabel("Your text")).toBeVisible();
  });
});

// Reopen navigates without a full load, unless the browser falls back to one or the reader reloads
test("opens a rewrite reopened on a full load without a hydration error", async ({
  page,
}) => {
  await page.addInitScript(
    ({ text, edits }) =>
      sessionStorage.setItem(
        "rewrity:reopen",
        JSON.stringify({ text, edits, stamp: Date.now() }),
      ),
    { text: TEXT, edits: [EDIT] },
  );
  await page.goto("/en");
  await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
  await expect(page.getByTestId("result")).toHaveText(TEXT);
  expect(
    await page.evaluate(() => sessionStorage.getItem("rewrity:reopen")),
  ).toBeNull();
});

test.describe("the review from the keyboard", () => {
  const openReview = async (page: Page) => {
    await mockStream(page, [EDIT, SECOND]);
    await page.goto("/en");
    const box = page.getByLabel("Your text");
    await box.fill(TEXT);
    await box.press("Control+Enter");
    await expect(page.getByText(/A accept, R reject/)).toBeVisible();
  };

  test("starts on the heading, which draws no outline", async ({ page }) => {
    await openReview(page);
    const heading = page.getByRole("heading", { name: "Suggested edits" });
    await expect(heading).toBeFocused();
    // Reached from the keyboard, so the page's own focus outline would apply
    expect(
      await heading.evaluate((h) => [
        h.matches(":focus-visible"),
        getComputedStyle(h).outlineStyle,
      ]),
    ).toEqual([true, "none"]);
  });

  test("marks the edit it moves to with a ring and no outline over it", async ({
    page,
  }) => {
    await openReview(page);
    await page.keyboard.press("j");
    const card = page.locator("#review-edit-1");
    await expect(card).toBeFocused();
    const look = await card.evaluate((c) => {
      const style = getComputedStyle(c);
      return {
        focused: c.matches(":focus-visible"),
        outline: style.outlineStyle,
        ring: style.boxShadow,
      };
    });
    expect(look.focused).toBe(true);
    expect(look.outline).toBe("none");
    expect(look.ring).not.toBe("none");
  });

  test("decides, takes back and goes on with the letters alone", async ({
    page,
  }) => {
    await openReview(page);
    await page.keyboard.press("a");
    await expect(
      page.getByText("1 accepted, 0 rejected, 1 to decide"),
    ).toBeVisible();
    await page.keyboard.press("u");
    await expect(
      page.getByText("0 accepted, 0 rejected, 2 to decide"),
    ).toBeVisible();
    await page.keyboard.press("r");
    await page.keyboard.press("a");
    await expect(page.getByTestId("result")).toHaveText(
      "It is crucial to move now.",
    );
  });

  test("does nothing once the focus has left the review for another control", async ({
    page,
  }) => {
    await openReview(page);
    await page.locator("footer").getByRole("link").focus();
    await page.keyboard.press("a");
    await page.keyboard.press("r");
    await expect(
      page.getByText("0 accepted, 0 rejected, 2 to decide"),
    ).toBeVisible();
  });

  // The focus would fall to the page, and the letters with it, while their legend stays
  test("goes on after a click on nothing outside the review", async ({
    page,
  }) => {
    await openReview(page);
    await page.locator("footer").click({ position: { x: 1, y: 1 } });
    await page.keyboard.press("a");
    await expect(
      page.getByText("1 accepted, 0 rejected, 1 to decide"),
    ).toBeVisible();
  });

  test("lists its keys on a device with a mouse", async ({ page }) => {
    await openReview(page);
    await expect(page.getByText(/A accept, R reject/)).toBeVisible();
  });

  // Each repeat of a held Enter is a click, and the label turns from "the rest" to "all"
  test("takes one bulk decision for a held Enter", async ({ page }) => {
    await openReview(page);
    await page
      .locator("#review-edit-0")
      .getByRole("button", { name: "Reject", exact: true })
      .click();
    await page.getByRole("button", { name: "Accept the rest" }).focus();
    await page.keyboard.down("Enter");
    await page.keyboard.down("Enter");
    await page.keyboard.up("Enter");
    await expect(
      page.getByText("1 accepted, 1 rejected, 0 to decide"),
    ).toBeVisible();
    await expect(page.getByTestId("result")).toHaveText(
      "It is crucial to move now.",
    );
  });

  test.describe("the writer's own wording", () => {
    const field = (page: Page) =>
      page.getByRole("textbox", { name: "Your wording" });

    test("opens with E without typing the letter, and closes with Escape", async ({
      page,
    }) => {
      await openReview(page);
      await page.keyboard.press("e");
      await expect(field(page)).toBeFocused();
      await expect(field(page)).toHaveValue("important");
      await page.keyboard.press("Escape");
      await expect(field(page)).toBeHidden();
      await expect(page.locator("#review-edit-0")).toBeFocused();
      await expect(page.getByTestId("result")).toHaveText(TEXT);
    });

    test("keeps the letters for itself, and goes on with Ctrl+Enter", async ({
      page,
    }) => {
      await openReview(page);
      await page.keyboard.press("e");
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("key");
      await expect(field(page)).toHaveValue("key");
      await expect(
        page.getByText("0 accepted, 0 rejected, 2 to decide"),
      ).toBeVisible();
      await page.keyboard.press("Control+Enter");
      await expect(page.getByTestId("result")).toHaveText(
        "It is key to act now.",
      );
      await expect(page.locator("#review-edit-1")).toBeFocused();
      await expect(page.getByTestId("result-length")).toHaveText(
        "6 words · 21 characters (-4)",
      );
    });
  });
});

test.describe("on a device that cannot hover", () => {
  test.use({ hasTouch: true, isMobile: true });

  test("the review leaves out the list of keys", async ({ page }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
    await expect(page.getByText(/A accept, R reject/)).toBeHidden();
  });
});

test.describe("a very narrow screen", () => {
  test.use({ viewport: { width: 280, height: 653 } });

  for (const locale of ["en", "fr"] as const) {
    test(`keeps a review on the screen in ${locale}`, async ({ page }) => {
      await openLongReview(page, locale);
      const row = (await stickyRow(page).boundingBox())!;
      expect(row.height).toBeLessThan(96);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

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

test.describe("the page shell", () => {
  for (const path of ["/en", "/en/history", "/en/privacy", "/en/nope"]) {
    test(`has one header, one main and one footer on ${path}`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(
        page.getByRole("navigation", { name: "Main menu" }),
      ).toBeVisible();
    });
  }

  test("offers the first Tab a way past the header", async ({ page }) => {
    await page.goto("/en");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    expect((await skip.boundingBox())!.width).toBeGreaterThan(24);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#content$/);
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("main")),
    ).toBe(true);
  });

  for (const [locale, title, signIn] of [
    ["en", "History", "Sign in to see your history."],
    ["fr", "Historique", "Connectez-vous pour voir votre historique."],
  ]) {
    test(`keeps the header and the footer on the way to the history, in ${locale}`, async ({
      page,
    }) => {
      let answer = () => {};
      const held = new Promise<void>((resolve) => (answer = resolve));
      await page.route(`**/${locale}/history?_rsc=*`, async (route) => {
        if (!route.request().headers()["next-router-prefetch"]) await held;
        await route.continue();
      });
      await page.goto(`/${locale}`, { waitUntil: "networkidle" });
      await page.getByRole("banner").evaluate((header) => {
        header.dataset.same = "yes";
      });

      await page.getByRole("link", { name: title }).click();
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(main.locator("[aria-busy]")).toBeVisible();
      await expect(page.getByRole("banner")).toHaveAttribute(
        "data-same",
        "yes",
      );
      await expect(page.getByRole("contentinfo")).toBeVisible();

      answer();
      await expect(page.getByText(signIn)).toBeVisible();
      await expect(main.locator("[aria-busy]")).toHaveCount(0);
      await expect(page.getByRole("banner")).toHaveAttribute(
        "data-same",
        "yes",
      );
    });
  }

  test("gives a missing page the site's own navigation", async ({ page }) => {
    await page.goto("/en/nope");
    await page
      .getByRole("banner")
      .getByRole("link", { name: "History" })
      .click();
    await expect(page).toHaveURL(/\/en\/history$/);
  });
});

test("fetches the sign-in client only when it is needed", async ({ page }) => {
  const scripts: Promise<string>[] = [];
  page.on("response", (response) => {
    if (/\/_next\/static\/.+\.js$/.test(response.url()))
      scripts.push(response.text());
  });
  const served = async (code: string) =>
    (await Promise.all(scripts)).some((body) => body.includes(code));

  await page.goto("/en", { waitUntil: "networkidle" });
  expect(scripts.length).toBeGreaterThan(0);
  expect(await served("GoTrueClient")).toBe(false);
  expect(await served("ZodError")).toBe(false);

  await page.getByLabel("Email").focus();
  await expect.poll(() => served("GoTrueClient")).toBe(true);
});

test.describe("what a review fetches on the way", () => {
  const CHECKS = "numbers_changed";
  const COMPARISON = String.raw`\p{N}{1,3}(?:\p{Zs}\p{N}{3})+(?!\p{N})`;
  const PHRASE = {
    ...EDIT,
    original: "crucial to act",
    replacement: "vital to act",
    start: 6,
    end: 20,
  };
  const marks = (page: Page) =>
    page.locator("#review-edit-0 .box-decoration-clone");

  const start = async (page: Page) => {
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
  };

  test("is not in what the page downloads up front", async ({ page }) => {
    const scripts: Promise<string>[] = [];
    page.on("response", (response) => {
      if (/\/_next\/static\/.+\.js$/.test(response.url()))
        scripts.push(response.text());
    });
    const served = async (code: string) =>
      (await Promise.all(scripts)).some((body) => body.includes(code));

    await mockStream(page, [PHRASE]);
    await page.goto("/en", { waitUntil: "networkidle" });
    expect(scripts.length).toBeGreaterThan(0);
    expect(await served(CHECKS)).toBe(false);
    expect(await served(COMPARISON)).toBe(false);

    await start(page);
    await expect.poll(() => served(COMPARISON)).toBe(true);
    expect(await served(CHECKS)).toBe(false);

    await page.getByRole("button", { name: "Reword" }).click();
    await expect.poll(() => served(CHECKS)).toBe(true);
  });

  test("marks only the word that changes", async ({ page }) => {
    await mockStream(page, [PHRASE]);
    await page.goto("/en");
    await start(page);
    await expect(marks(page)).toHaveText(["crucial", "vital"]);
    await expect(page.locator("#quote-edit-0")).toHaveText("crucial to act");
  });

  test("warns about a changed number, and leaves the choice", async ({
    page,
  }) => {
    await mockStream(page, [PHRASE]);
    await page.goto("/en");
    await start(page);
    await page.getByRole("button", { name: "Reword" }).click();
    await page
      .getByRole("textbox", { name: "Your wording" })
      .fill("12 times vital");
    await expect(page.getByText(/The numbers are not the same/)).toBeVisible();
    await page.getByRole("button", { name: "Accept this wording" }).click();
    await expect(page.getByTestId("result")).toHaveText(
      "It is 12 times vital now.",
    );
  });

  test("goes without them when they cannot be fetched", async ({ page }) => {
    await page.route("**/_next/static/**/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes(CHECKS) || body.includes(COMPARISON))
        return route.abort("aborted");
      return route.fulfill({ response });
    });
    await mockStream(page, [PHRASE]);
    await page.goto("/en");
    await start(page);
    await expect(page.locator("#quote-edit-0")).toHaveClass(/bg-remove-soft/);
    await expect(marks(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Reword" }).click();
    await page
      .getByRole("textbox", { name: "Your wording" })
      .fill("12 times vital");
    await page.getByRole("button", { name: "Accept this wording" }).click();
    await expect(page.getByTestId("result")).toHaveText(
      "It is 12 times vital now.",
    );
  });
});

test.describe("the list of edits", () => {
  const open = async (page: Page) => {
    await mockStream(page, [EDIT, SECOND]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    await page
      .getByRole("button", { name: "Accept", exact: true })
      .first()
      .click();
  };

  test("downloads under its own name, with the accepted edits", async ({
    page,
  }) => {
    await open(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download the list" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("rewrite-edits.txt");
    expect(await readFile(await download.path(), "utf8")).toBe(
      "List of accepted edits: 1\n\n1. Before: crucial\nAfter: important\nWhy: Plainer word\n",
    );
  });

  test("leaves the result's own download as it was", async ({ page }) => {
    await open(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download .txt" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("rewrite.txt");
    expect(await readFile(await download.path(), "utf8")).toBe(
      "It is important to act now.",
    );
  });
});

test.describe("the review's fade", () => {
  for (const [reducedMotion, expected] of [
    ["no-preference", "review-in"],
    ["reduce", "none"],
  ] as const) {
    test(`with ${reducedMotion}: ${expected}`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      await mockStream(page, [EDIT]);
      await page.goto("/en");
      await page.getByLabel("Your text").fill(TEXT);
      await page.getByRole("button", { name: "Rewrite" }).click();
      await expect(
        page.locator("section", {
          has: page.getByRole("heading", { name: "Suggested edits" }),
        }),
      ).toHaveCSS("animation-name", expected);
    });
  }
});

// The review is much taller than the editor whose place it takes. With the top of the editor out
// of sight, the browser would hold still what follows it on the screen: the review would open at
// its end, then scroll back up through every card to its heading.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test.describe(`a review opened ${viewport.width} px wide`, () => {
    test.use({ viewport });
    const STOCK =
      "Moreover, we met in order to talk about the budget. Furthermore, the plan plays a crucial role in the year ahead. In conclusion, we act now.";

    for (const name of ["Rewrite", "Try an example", "Free check"]) {
      test(`goes no further down than its heading, from ${name}`, async ({
        page,
      }) => {
        // Reduced, the scroll is instant and the reader never sees where the page was in between
        await page.emulateMedia({ reducedMotion: "no-preference" });
        await mockStream(page, [EDIT, SECOND]);
        await page.goto("/en");
        // The account's panel takes the place of its placeholder, and the fonts come in
        await expect(page.locator(".skeleton")).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        const box = page.getByLabel("Your text");
        if (name === "Rewrite") await box.fill(TEXT);
        if (name === "Free check") await box.fill(STOCK);
        // The top of the editor out of sight, its buttons and the example below it on the screen
        await box.evaluate((field) =>
          window.scrollBy({
            top: field.closest("form")!.getBoundingClientRect().top + 40,
            behavior: "instant",
          }),
        );
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeInViewport();
        await expect(
          page.getByRole("region", { name: "An example" }),
        ).toBeInViewport();
        // Where the page is at every frame from the click on, and at every scroll in between
        const start = await page.evaluate(() => {
          const seen: number[] = [];
          (window as unknown as { seen: number[] }).seen = seen;
          const sample = () => {
            seen.push(window.scrollY);
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
          addEventListener("scroll", () => seen.push(window.scrollY));
          return window.scrollY;
        });
        await button.click();
        const heading = page.getByRole("heading", { name: "Suggested edits" });
        await expect(heading).toBeFocused();
        // At rest, with the heading at the top of the screen: after a jump, it first sits above it
        await expect
          .poll(async () => {
            const still = await page.evaluate(
              () =>
                new Promise<boolean>((resolve) => {
                  const y = window.scrollY;
                  setTimeout(() => resolve(window.scrollY === y), 200);
                }),
            );
            const top = (await heading.boundingBox())?.y ?? -1;
            return still && top >= 0 && top < 40;
          })
          .toBe(true);
        const { seen, end } = await page.evaluate(() => ({
          seen: (window as unknown as { seen: number[] }).seen,
          end: window.scrollY,
        }));
        expect(Math.max(...seen)).toBeLessThanOrEqual(Math.max(start, end) + 1);
      });
    }
  });
}

test.describe("the appearance choices", () => {
  test("change with the arrow keys, from one stop for Tab", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Day" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Night" })).toBeFocused();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("radio", { name: "Day" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  test("still show which one is chosen in forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto("/en");
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Night" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Read after the switch: the system's colour depends on the page's colour scheme
    const highlight = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.forcedColorAdjust = "none";
      probe.style.backgroundColor = "Highlight";
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });
    await expect(page.getByRole("radio", { name: "Night" })).toHaveCSS(
      "background-color",
      highlight,
    );
    await expect(page.getByRole("radio", { name: "Day" })).not.toHaveCSS(
      "background-color",
      highlight,
    );
  });
});

test.describe("in forced colours", () => {
  test.use({ forcedColors: "active" });

  const highlightOf = (page: Page) =>
    page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.forcedColorAdjust = "none";
      probe.style.backgroundColor = "Highlight";
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    });

  test("the current language and page can still be told apart", async ({
    page,
  }) => {
    await page.goto("/en");
    const highlight = await highlightOf(page);
    const languages = page.getByRole("navigation", { name: "Language" });
    await expect(languages.getByRole("link", { name: "en" })).toHaveCSS(
      "background-color",
      highlight,
    );
    await expect(languages.getByRole("link", { name: "fr" })).not.toHaveCSS(
      "background-color",
      highlight,
    );
    await expect(page.locator("[aria-current=page]")).toHaveCSS(
      "background-color",
      highlight,
    );
    await expect(
      page
        .getByRole("navigation", { name: "Main menu" })
        .getByRole("link", { name: "History" }),
    ).not.toHaveCSS("background-color", highlight);
  });

  const reviewPhrase = async (page: Page) => {
    await mockStream(page, [
      {
        ...EDIT,
        original: "crucial to act",
        replacement: "vital to act",
        start: 6,
        end: 20,
      },
    ]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
  };

  test("the words that change are underlined", async ({ page }) => {
    await reviewPhrase(page);
    const mark = page.locator("#review-edit-0 .box-decoration-clone").first();
    await expect(mark).toHaveCSS("text-decoration-line", "underline");
  });

  test("the words an accepted edit takes out are struck through", async ({
    page,
  }) => {
    await reviewPhrase(page);
    const card = page.locator("#review-edit-0");
    await card.getByRole("button", { name: "Accept", exact: true }).click();
    const marks = card.locator(".box-decoration-clone");
    await expect(marks.filter({ hasText: "crucial" })).toHaveCSS(
      "text-decoration-line",
      "line-through",
    );
    await expect(marks.filter({ hasText: "vital" })).toHaveCSS(
      "text-decoration-line",
      "underline",
    );
  });

  // The fill is taken away, and a filled button would be a word with no edge
  test("a filled button keeps an edge", async ({ page }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    const rewrite = page.getByRole("button", { name: "Rewrite" });
    await expect(rewrite).toHaveCSS("border-top-style", "solid");
    await expect(rewrite).toHaveCSS("border-top-width", "1px");
    await rewrite.click();
    const accept = page
      .locator("#review-edit-0")
      .getByRole("button", { name: "Accept", exact: true });
    await expect(accept).toHaveCSS("border-top-style", "solid");
    await expect(accept).toHaveCSS("border-top-width", "1px");
    // The current language has its own system colours
    await expect(
      page
        .getByRole("navigation", { name: "Language" })
        .getByRole("link", { name: "en" }),
    ).toHaveCSS("border-top-width", "0px");
  });

  // The ring is a shadow, and forced colours draw none
  test("the edit the letters act on is outlined", async ({ page }) => {
    await mockStream(page, [EDIT, SECOND]);
    await page.goto("/en");
    const box = page.getByLabel("Your text");
    await box.fill(TEXT);
    await box.press("Control+Enter");
    await expect(page.getByText(/A accept, R reject/)).toBeVisible();
    const highlight = await highlightOf(page);
    const outline = (id: string) =>
      page.locator(`#review-${id}`).evaluate((card) => {
        const style = getComputedStyle(card);
        return [style.outlineStyle, style.outlineWidth, style.outlineColor];
      });

    expect(await outline("edit-0")).toEqual(["solid", "2px", highlight]);
    expect((await outline("edit-1"))[0]).toBe("none");
    await page.keyboard.press("j");
    await expect(page.locator("#review-edit-1")).toBeFocused();
    expect(await outline("edit-1")).toEqual(["solid", "2px", highlight]);
    expect((await outline("edit-0"))[0]).toBe("none");
  });
});

test.describe("a long review", () => {
  const rowBottom = async (page: Page) => {
    const row = (await stickyRow(page).boundingBox())!;
    return row.y + row.height;
  };

  test("starts below the page header, and stays at the top of the screen", async ({
    page,
  }) => {
    await openLongReview(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const header = (await page.locator("header").boundingBox())!;
    const row = (await stickyRow(page).boundingBox())!;
    expect(row.y).toBeGreaterThanOrEqual(header.y + header.height);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect
      .poll(async () => (await stickyRow(page).boundingBox())!.y)
      .toBe(0);
  });

  test("leaves the bulk buttons in the flow of the page", async ({ page }) => {
    await openLongReview(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(
      stickyRow(page).getByRole("button", { name: "Accept all" }),
    ).toHaveCount(0);
    const bulk = (await page
      .getByRole("button", { name: "Accept all" })
      .boundingBox())!;
    expect(bulk.y).toBeLessThan(0);
  });

  test("has an opaque background, so that the cards do not show through it", async ({
    page,
  }) => {
    await openLongReview(page);
    const background = await stickyRow(page).evaluate(
      (row) => getComputedStyle(row).backgroundColor,
    );
    // Any alpha shows in the computed value: rgba(…, 0.5) or oklab(… / 0.5)
    expect(background).not.toMatch(/rgba|\/|transparent/);
  });

  test("does not hide a card under the row when moving back up", async ({
    page,
  }) => {
    await openLongReview(page);
    for (let moves = 0; moves < 13; moves++) await page.keyboard.press("j");
    await expect(page.locator("#review-edit-13")).toBeFocused();
    for (let moves = 12; moves >= 4; moves--) {
      await page.keyboard.press("k");
      const card = page.locator(`#review-edit-${moves}`);
      await expect(card).toBeFocused();
      const { y } = (await card.boundingBox())!;
      expect(y).toBeGreaterThanOrEqual(await rowBottom(page));
    }
  });

  // The browser sees a control under the row as on the screen, and would not scroll on its own
  test("does not hide a control reached with Shift+Tab", async ({ page }) => {
    await openLongReview(page);
    const target = page
      .locator("#review-edit-5")
      .getByRole("button", { name: "Reword" });
    await page
      .locator("#review-edit-6")
      .getByRole("button", { name: "Accept", exact: true })
      .focus();
    await target.evaluate((button) =>
      window.scrollBy(0, button.getBoundingClientRect().top - 10),
    );
    expect((await target.boundingBox())!.y).toBeLessThan(await rowBottom(page));
    await page.keyboard.press("Shift+Tab");
    await expect(target).toBeFocused();
    expect((await target.boundingBox())!.y).toBeGreaterThanOrEqual(
      await rowBottom(page),
    );
  });

  test("brings the marked card back with Next to decide", async ({ page }) => {
    await openLongReview(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    const next = page.getByRole("button", { name: "Next to decide" });
    const first = page.locator("#review-edit-0");
    await expect(first).not.toBeInViewport();
    await next.click();
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
    expect((await first.boundingBox())!.y).toBeGreaterThanOrEqual(
      await rowBottom(page),
    );
    await next.click();
    await expect(page.locator("#review-edit-1")).toBeFocused();
  });

  test("copies from the row", async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await openLongReview(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await stickyRow(page).getByRole("button", { name: "Copy" }).click();
    await expect(
      stickyRow(page).getByRole("button", { name: "Copied" }),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      LONG_TEXT,
    );
    await context.close();
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const locale of ["en", "fr"] as const) {
    test(`keeps the review's top row to one short row, in ${locale}`, async ({
      page,
    }) => {
      await openLongReview(page, locale);
      const row = stickyRow(page);
      const box = (await row.boundingBox())!;
      expect(box.height).toBeLessThan(96);
      const buttons = await row.getByRole("button").all();
      expect(buttons).toHaveLength(2);
      const summary = (await row.locator("p").boundingBox())!;
      for (const button of buttons) {
        const { x, y, width, height } = (await button.boundingBox())!;
        expect(width).toBeLessThan(48);
        expect(x).toBeGreaterThanOrEqual(summary.x + summary.width);
        expect(y + height).toBeLessThanOrEqual(box.y + box.height);
      }
    });
  }

  test("does not make the browser zoom on the field for a wording", async ({
    page,
  }) => {
    await openLongReview(page);
    await page.getByRole("button", { name: "Reword" }).first().click();
    await expect(page.getByRole("textbox", { name: "Your wording" })).toHaveCSS(
      "font-size",
      "16px",
    );
  });

  test("comes to the editor before the example", async ({ page }) => {
    await page.goto("/en");
    const editor = (await page.getByLabel("Your text").boundingBox())!;
    const example = (await page
      .getByRole("region", { name: "An example" })
      .boundingBox())!;
    expect(editor.y).toBeLessThan(example.y);
  });

  test("does not make the browser zoom on a field", async ({ page }) => {
    await page.goto("/en");
    await page.getByText("Options").click();
    // The fields that take typing: iOS does not zoom on a checkbox
    const fields = await page
      .locator("input:not([type=checkbox]), textarea")
      .all();
    expect(fields.length).toBeGreaterThanOrEqual(3);
    for (const field of fields) {
      await expect(field).toHaveCSS("font-size", "16px");
    }
  });

  test("gives the review's buttons room for a thumb", async ({ page }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    const accept = page.getByRole("button", { name: "Accept", exact: true });
    expect((await accept.boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await accept.click();
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    expect((await undo.boundingBox())!.height).toBeGreaterThanOrEqual(36);
  });
});

test("writes placeholders in the muted colour, not paler", async ({ page }) => {
  await page.goto("/en");
  const muted = await page
    .getByRole("heading", { level: 1 })
    .locator("+ p")
    .evaluate((tagline) => getComputedStyle(tagline).color);
  for (const label of ["Your text", "Email"]) {
    const placeholder = await page
      .getByLabel(label)
      .evaluate((box) => getComputedStyle(box, "::placeholder").color);
    expect(placeholder, label).toBe(muted);
  }
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
  await expect(page.getByText("16 / 1,500")).toBeVisible();
  await expect(page.getByLabel(/Your own writing/)).toHaveValue(
    "A sample of mine",
  );
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  // The client's script is fetched now, at the pace set above
  await expect(
    page.getByRole("status").filter({ hasText: "early@example.com" }),
  ).toBeVisible({ timeout: 15_000 });
  expect(sent.join()).toContain("early@example.com");
});

test("sends the choice not to keep a text, ticked before the scripts arrived", async ({
  page,
}) => {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/rewrite"))
      sent.push(request.postData() ?? "");
  });
  await mockStream(page, [EDIT]);
  await page.route("**/_next/static/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto("/en", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Your text").fill(TEXT);
  await page.getByText("Options").click();
  await page.getByLabel("Do not keep this text in my history").check();

  await expect(page.getByText("· Not kept")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("is not added to your history")).toBeVisible();
  await page.getByRole("button", { name: "Rewrite" }).click();
  await expect(page.getByText("Plainer word", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0]).keep).toBe(false);
});

test.describe("the line about the limits", () => {
  const MEMBER = { limit: 5, used: 2, open: true };
  const VISITOR = { limit: 5, used: null, open: true };
  const WORDS = {
    en: "You have up to 3 of 5 attempts left today.",
    fr: "Il vous reste au plus 3 tentatives sur 5 aujourd'hui.",
  };
  const answerLine = (page: Page, allowance: object | null) =>
    page.route("**/api/rewrite", (route) =>
      route.fulfill({ json: { allowance } }),
    );
  // 336 is the narrowest screen that keeps two lines for the words, not three
  const WIDTHS = [280, 320, 336, 375, 640, 768, 1280];

  for (const width of WIDTHS) {
    for (const locale of ["en", "fr"] as const) {
      test.describe(`${width} px wide, in ${locale}`, () => {
        test.use({ viewport: { width, height: 800 } });

        test("the editor stays where it is when the words arrive", async ({
          page,
        }) => {
          const answer = Promise.withResolvers<void>();
          await page.route("**/api/rewrite", async (route) => {
            await answer.promise;
            await route.fulfill({ json: { allowance: MEMBER } });
          });
          const asked = page.waitForRequest("**/api/rewrite");
          await page.goto(`/${locale}`);
          await asked;
          // The account's panel takes the place of its placeholder, and the fonts come in
          await expect(page.locator(".skeleton")).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          const editor = page.locator("textarea").first();
          const before = (await editor.boundingBox())!.y;
          answer.resolve();
          await expect(page.getByText(WORDS[locale])).toBeVisible();
          expect((await editor.boundingBox())!.y).toBe(before);
        });
      });
    }
  }

  // Chromium on Linux, where CI runs, rounds each glyph's advance: a line 268 px long on macOS
  // came out at 273 there. So the room kept must not depend on the last few pixels.
  for (const locale of ["en", "fr"] as const) {
    test(`keeps room for its words drawn a little wider, in ${locale}`, async ({
      page,
    }) => {
      await answerLine(page, MEMBER);
      await page.goto(`/${locale}`);
      const line = page.getByText(WORDS[locale]);
      await expect(line).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const fits = await line.evaluate((words) => {
          // The same as words 2.5% wider
          words.style.paddingRight = `${words.clientWidth * 0.025}px`;
          const { height } = words.getBoundingClientRect();
          words.style.paddingRight = "";
          return height <= parseFloat(getComputedStyle(words).minHeight);
        });
        expect(fits, `${width} px wide`).toBe(true);
      }
    });
  }

  test.describe("on a wide screen", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("holds no more than the one line it takes", async ({ page }) => {
      await answerLine(page, MEMBER);
      await page.goto("/fr");
      const box = await page.getByText(WORDS.fr).boundingBox();
      expect(box!.height).toBe(20);
    });
  });

  test("tells a visitor what an email address gives, in both languages", async ({
    page,
  }) => {
    await answerLine(page, VISITOR);
    await page.goto("/en");
    await expect(
      page.getByText("Up to 5 free rewrites a day with an email address."),
    ).toBeVisible();
    await page.goto("/fr");
    await expect(
      page.getByText(
        "Jusqu'\u00e0 5 r\u00e9\u00e9critures gratuites par jour avec une adresse e-mail.",
      ),
    ).toBeVisible();
  });

  test("tells an account what is left and when it comes back", async ({
    page,
  }) => {
    await answerLine(page, MEMBER);
    await page.goto("/en");
    await expect(page.getByText(WORDS.en)).toContainText(
      /Resets at \d{1,2}:00\s[AP]M/,
    );
  });

  test("says rewriting is paused before anything is pasted, and stops no one", async ({
    page,
  }) => {
    await answerLine(page, { ...VISITOR, open: false });
    await page.goto("/en");
    await expect(page.getByText("Rewriting is paused for now.")).toBeVisible();
    await page.getByLabel("Your text").fill(TEXT);
    await expect(page.getByRole("button", { name: "Rewrite" })).toBeEnabled();
  });

  test("moves when an attempt ends", async ({ page }) => {
    let used = 0;
    await page.route("**/api/rewrite", (route) => {
      if (route.request().method() !== "POST")
        return route.fulfill({
          json: { allowance: { ...MEMBER, used } },
        });
      used += 1;
      return route.fulfill(streamed([EDIT]));
    });
    await page.goto("/en");
    await expect(page.getByText("up to 5 of 5")).toBeVisible();
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
    await expect(page.getByText("up to 4 of 5")).toBeVisible();
  });

  test("goes away when the site cannot say", async ({ page }) => {
    await answerLine(page, null);
    await page.goto("/en", { waitUntil: "networkidle" });
    await expect(
      page.getByText(/free rewrite|attempts left|paused/),
    ).toHaveCount(0);
  });

  // What the page gets from the real route here: this site has no secret key and no database
  test("is answered by the route, without a cache, and says it cannot say", async ({
    request,
  }) => {
    const response = await request.get("/api/rewrite");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(await response.json()).toEqual({ allowance: null });
  });
});

test.describe("asking for a sign-in link", () => {
  const answerRequests = (page: Page) =>
    page.route("**/auth/v1/otp**", (route) =>
      route.fulfill({ status: 200, json: {} }),
    );
  const askForLink = async (page: Page, email = "reader@example.com") => {
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: email }),
    ).toBeVisible();
  };

  // The link is a new document in this browser. A first render that read the copy would be a
  // hydration error, which fails the test.
  test("finds the text again on the page the link opens, once", async ({
    page,
  }) => {
    await answerRequests(page);
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByText("Options").click();
    await page.getByRole("radio", { name: "Thorough" }).click();
    await page.getByLabel(/Your own writing/).fill("A sample of mine");
    await askForLink(page);
    expect(
      await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
    ).not.toContain("A sample of mine");

    await page.goto("/en", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
    await page.getByText("Options").click();
    await expect(page.getByRole("radio", { name: "Thorough" })).toBeChecked();
    await expect(page.getByLabel(/Your own writing/)).toHaveValue("");

    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel("Your text")).toHaveValue("");
  });

  test("keeps it for the other tab when this one moves around", async ({
    page,
  }) => {
    await answerRequests(page);
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Your text").fill(TEXT);
    await askForLink(page);
    await page.getByRole("link", { name: "History" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("History");
    await page.goBack();
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);

    await page.goto("/en", { waitUntil: "networkidle" });
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });

  // A new version went out since the page loaded, and the script the form needs is gone. The reload
  // it asks for brings an empty editor, which takes the text back.
  test("keeps the text for the reload it asks for when its script cannot be fetched", async ({
    page,
  }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Your text").fill(TEXT);
    const gone = (route: Route) => route.abort("aborted");
    await page.route("**/_next/static/**", gone);
    await page.getByLabel("Email").fill("reader@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Reload the page" }),
    ).toBeVisible();

    await page.unroute("**/_next/static/**", gone);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });

  test("keeps nothing of a text only typed", async ({ page }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Your text").fill(TEXT);
    expect(
      await page.evaluate(() => JSON.stringify(Object.values(localStorage))),
    ).not.toContain(TEXT);
  });

  test("comes back to the page it was asked from", async ({ page }) => {
    const asked: string[] = [];
    await page.route("**/auth/v1/otp**", async (route) => {
      asked.push(route.request().url());
      await route.fulfill({ status: 200, json: {} });
    });
    await page.goto("/fr/history", { waitUntil: "networkidle" });
    await page.getByLabel("E-mail").fill("reader@example.com");
    await page
      .getByRole("button", { name: "Recevoir un lien de connexion" })
      .click();
    await expect(page.getByRole("status")).toContainText("reader@example.com");
    const back = new URL(new URL(asked[0]).searchParams.get("redirect_to")!);
    expect(back.pathname).toBe("/auth/callback");
    expect(back.searchParams.get("next")).toBe("/fr/history");
  });

  // The button is disabled while it sends, and the browser drops its focus to the page
  test("gives the focus back to the address when the link cannot be sent", async ({
    page,
  }) => {
    await page.route("**/auth/v1/otp**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.abort("aborted");
    });
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill("reader@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("alert").filter({ hasText: "Could not send the link" }),
    ).toBeVisible();
    await expect(page.getByLabel("Email")).toBeFocused();
  });

  test("lets the reader correct the address", async ({ page }) => {
    await answerRequests(page);
    await page.goto("/en", { waitUntil: "networkidle" });
    await askForLink(page, "reader@exmaple.com");
    await page.getByRole("button", { name: "Use another address" }).click();
    await expect(page.getByLabel("Email")).toHaveValue("reader@exmaple.com");
    await expect(page.getByLabel("Email")).toBeFocused();
    await askForLink(page, "reader@example.com");
  });

  test("reaches the privacy page from the form, and the text is still there after", async ({
    page,
  }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Your text").fill(TEXT);
    await page
      .locator("form", { hasText: "You need an account" })
      .getByRole("link", { name: "Privacy" })
      .click();
    await expect(page).toHaveURL(/\/en\/privacy$/);
    await page.goBack();
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });

  test("says where the text goes under the editor, and links to the privacy page", async ({
    page,
  }) => {
    await page.goto("/fr", { waitUntil: "networkidle" });
    const editor = page.locator("form", {
      has: page.getByLabel("Votre texte"),
    });
    await expect(editor).toContainText("envoyé à Anthropic");
    await editor.getByRole("link", { name: "Confidentialité" }).click();
    await expect(page).toHaveURL(/\/fr\/privacy$/);
    await expect(page.getByRole("main")).toContainText("une copie du texte");
  });

  test.describe(() => {
    test.use({ viewport: { width: 280, height: 653 } });

    test("keeps a very long address inside the page", async ({ page }) => {
      await answerRequests(page);
      await page.goto("/en", { waitUntil: "networkidle" });
      await askForLink(page, `${"x".repeat(60)}@example.com`);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
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

test("sends the security headers on pages and on the API", async ({
  request,
}) => {
  const page = await request.get("/en");
  expect(page.status()).toBe(200);
  // No body: the route refuses it before anything else happens
  const api = await request.post("/api/rewrite");
  expect(api.status()).toBe(400);
  for (const response of [page, api]) {
    expect(response.headers()).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
    });
  }
});

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

  test("opens the example as a review, then rewrites a text of one's own with the keyboard", async ({
    page,
  }) => {
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(
      page.getByRole("heading", { name: "Suggested edits" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Use your own text" }).click();
    await expect(page.getByLabel("Your text")).toHaveValue("");
    await expect(page.getByLabel("Your text")).toBeFocused();
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByLabel("Your text").press("Control+Enter");
    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
  });
});

test.describe("a review that asks nothing of the server", () => {
  const SUPABASE = "http://localhost:54321";
  // In the French rules, and nowhere the page needs up front
  const RULE = "force est de constater";
  const LONG = "We met in order to talk. ".repeat(300).trim();

  // Listening starts before the page loads, and covers all it does afterwards
  const watchRequests = (page: Page) => {
    const sent: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      // The line about the limits asks as the page opens, with no text: that one is not the review
      const rewrite =
        url.includes("/api/rewrite") && request.method() === "POST";
      if (rewrite || url.startsWith(SUPABASE)) sent.push(url);
    });
    return sent;
  };
  const expectSignedOut = async (page: Page) => {
    const cookies = await page.context().cookies();
    expect(cookies.filter(({ name }) => name.startsWith("sb-"))).toEqual([]);
  };
  const firstCard = (page: Page) => page.locator("[data-decision]").first();

  for (const words of [
    {
      locale: "en",
      box: "Your text",
      tryIt: "Try an example",
      check: "Free check",
      heading: "Suggested edits",
      accept: "Accept",
      leave: "Use your own text",
      sample: /A sample, with edits prepared in advance/,
      sampleResult: /^Effective communication plays a pivotal/,
      list: /a short list of stock phrases/,
      text: "We met in order to talk about the budget and the schedule for this year.",
      reason: "Filler. Fewer words say the same thing.",
      result: "We met to talk about the budget and the schedule for this year.",
    },
    {
      locale: "fr",
      box: "Votre texte",
      tryIt: "Essayer un exemple",
      check: "Vérification gratuite",
      heading: "Modifications suggérées",
      accept: "Accepter",
      leave: "Utiliser votre propre texte",
      sample: /Un exemple, avec des modifications préparées/,
      sampleResult: /^La communication efficace joue un rôle/,
      list: /une courte liste de formules/,
      text: "Nous avons agi dans le but de réduire les coûts de la commune cette année.",
      reason: "Du remplissage. Moins de mots disent la même chose.",
      result:
        "Nous avons agi pour réduire les coûts de la commune cette année.",
    },
  ]) {
    test.describe(`signed out, in ${words.locale}`, () => {
      test("the example opens, answers the decisions and sends nothing", async ({
        page,
      }) => {
        const sent = watchRequests(page);
        await page.goto(`/${words.locale}`);
        await expectSignedOut(page);
        await page.getByRole("button", { name: words.tryIt }).click();
        await expect(
          page.getByRole("heading", { name: words.heading }),
        ).toBeFocused();
        await expect(page.getByText(words.sample)).toBeVisible();
        await firstCard(page)
          .getByRole("button", { name: words.accept, exact: true })
          .click();
        await expect(page.getByTestId("result")).toHaveText(words.sampleResult);
        await page.getByRole("button", { name: words.leave }).click();
        await expect(page.getByLabel(words.box)).toHaveValue("");
        expect(sent).toEqual([]);
      });

      test("the free check opens, answers the decisions and sends nothing", async ({
        page,
      }) => {
        const sent = watchRequests(page);
        await page.goto(`/${words.locale}`);
        await expectSignedOut(page);
        await page.getByLabel(words.box).fill(words.text);
        await page.getByRole("button", { name: words.check }).click();
        await expect(
          page.getByRole("heading", { name: words.heading }),
        ).toBeFocused();
        await expect(page.getByText(words.list)).toBeVisible();
        await expect(page.getByText(words.reason)).toBeVisible();
        await firstCard(page)
          .getByRole("button", { name: words.accept, exact: true })
          .click();
        await expect(page.getByTestId("result")).toHaveText(words.result);
        expect(sent).toEqual([]);
      });
    });
  }

  test("the same watch sees a real rewrite, so the ones above mean something", async ({
    page,
  }) => {
    const sent = watchRequests(page);
    await mockStream(page, [EDIT]);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Rewrite" }).click();
    await expect(page.getByText("Plainer word", { exact: true })).toBeVisible();
    expect(sent).toHaveLength(1);
  });

  test("a double click opens the example and does nothing more", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Try an example" }).dblclick();
    await expect(page.locator('[data-decision="pending"]')).toHaveCount(5);
    await expect(page.getByTestId("result")).toHaveText(/^In today's/);
  });

  test("the example follows the language, decisions and all", async ({
    page,
  }) => {
    const sent = watchRequests(page);
    await page.goto("/en");
    await page.getByRole("button", { name: "Try an example" }).click();
    await firstCard(page)
      .getByRole("button", { name: "Accept", exact: true })
      .click();
    await page.getByRole("link", { name: "fr", exact: true }).click();
    await expect(page).toHaveURL(/\/fr$/);
    await expect(page.getByTestId("result")).toHaveText(
      /^La communication efficace joue un rôle/,
    );
    await expect(
      page.getByText("1 acceptée, 0 refusée, 4 à décider"),
    ).toBeVisible();
    expect(sent).toEqual([]);
  });

  test("a reload ends the example and leaves the box empty", async ({
    page,
  }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Try an example" }).click();
    await expect(page.getByTestId("result")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("result")).toHaveCount(0);
    await expect(page.getByLabel("Your text")).toHaveValue("");
  });

  test("the free check goes on where a rewrite stops", async ({ page }) => {
    const sent = watchRequests(page);
    await page.goto("/en");
    await page.getByLabel("Your text").fill(LONG);
    await expect(page.getByRole("button", { name: "Rewrite" })).toBeDisabled();
    await page.getByRole("button", { name: "Free check" }).click();
    await expect(page.getByText(/more edits are not shown/)).toBeVisible();
    expect(sent).toEqual([]);
  });

  test("the free check fetches its list only when asked", async ({ page }) => {
    const scripts: Promise<string>[] = [];
    page.on("response", (response) => {
      if (/\/_next\/static\/.+\.js$/.test(response.url()))
        scripts.push(response.text());
    });
    const served = async () =>
      (await Promise.all(scripts)).some((body) => body.includes(RULE));

    await page.goto("/en", { waitUntil: "networkidle" });
    expect(scripts.length).toBeGreaterThan(0);
    expect(await served()).toBe(false);

    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Free check" }).click();
    await expect.poll(served).toBe(true);
  });

  test("says so when the list cannot be fetched, and keeps the text", async ({
    page,
  }) => {
    await page.route("**/_next/static/**/*.js", async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      if (body.includes(RULE)) return route.abort("aborted");
      return route.fulfill({ response });
    });
    await page.goto("/en");
    await page.getByLabel("Your text").fill(TEXT);
    await page.getByRole("button", { name: "Free check" }).click();
    await expect(page.getByText(/^Network error/)).toBeVisible();
    await expect(page.getByLabel("Your text")).toHaveValue(TEXT);
  });
});
