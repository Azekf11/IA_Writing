import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import LocaleLayout from "@/app/[locale]/layout";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font" });
  return { Geist: font, Geist_Mono: font, Newsreader: font };
});
const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next-intl", async (original) => ({
  ...(await original<typeof import("next-intl")>()),
  NextIntlClientProvider: passThrough,
}));
vi.mock("@/components/theme-provider", () => ({ ThemeProvider: passThrough }));
// A translation is its own key, so the test sees which text the page asked for
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => {},
}));
vi.mock("@/components/site-header", () => ({
  SiteHeader: () => <header>top</header>,
}));
vi.mock("@/components/site-footer", () => ({
  SiteFooter: () => <footer>bottom</footer>,
}));
vi.mock("@/components/leave-on-sign-out", () => ({
  LeaveOnSignOut: ({ locale }: { locale: string }) => (
    <i id="leave-on-sign-out" lang={locale} />
  ),
}));

async function page() {
  const markup = renderToStaticMarkup(
    await LocaleLayout({
      children: <p id="page">A page</p>,
      params: Promise.resolve({ locale: "en" }),
    }),
  );
  return new DOMParser().parseFromString(markup, "text/html");
}

describe("the page shell", () => {
  it("wraps every page in one main, between the header and the footer", async () => {
    const doc = await page();
    const main = doc.querySelector("main#content")!;
    expect(main.querySelector("#page")).not.toBeNull();
    expect(doc.querySelectorAll("main")).toHaveLength(1);
    expect(doc.querySelectorAll("header, footer")).toHaveLength(2);
    expect(doc.querySelector("main header, main footer")).toBeNull();
    expect(
      doc.querySelector("header")!.compareDocumentPosition(main) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  // Pages that show nothing of the account hear it too: the privacy page, a missing page, the error
  // page, a history that could not be read
  it("hears of a sign-out in another tab, on every page", async () => {
    const doc = await page();
    const listener = doc.querySelector("#leave-on-sign-out");
    expect(listener?.getAttribute("lang")).toBe("en");
    expect(listener?.closest("main")).toBeNull();
  });

  it("starts with a link that skips to the content", async () => {
    const doc = await page();
    const first = doc.querySelector("a, button, input, textarea, select")!;
    expect(first.getAttribute("href")).toBe("#content");
    expect(first.textContent).toBe("skip");
    expect(first.className).toContain("sr-only");
    expect(first.className).toContain("focus:not-sr-only");
    expect(first.closest("main")).toBeNull();
  });
});
