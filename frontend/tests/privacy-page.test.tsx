import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrivacyPage from "@/app/[locale]/privacy/page";

// A translation is its own key, so the test sees which text the page asked for
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => {},
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

async function aiSection() {
  render(
    await PrivacyPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    }),
  );
  return screen.getByRole("heading", { name: "aiTitle" }).nextElementSibling;
}

describe("the privacy page", () => {
  it("has no main, header or footer of its own: the layout holds them", async () => {
    await aiSection();
    expect(document.querySelector("main, header, footer")).toBeNull();
  });

  it("mentions the excerpts when they are on", async () => {
    vi.stubEnv("STYLE_REFERENCES", "on");
    expect(await aiSection()).toHaveTextContent(/^ai$/);
  });

  it("says nothing of them when they are off, as in production", async () => {
    vi.stubEnv("STYLE_REFERENCES", "off");
    expect(await aiSection()).toHaveTextContent(/^aiWithoutExcerpts$/);
  });
});
