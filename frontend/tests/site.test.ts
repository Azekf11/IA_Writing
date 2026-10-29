import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { siteUrl } from "@/lib/site";

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl", () => {
  it("prefers the explicit address and drops a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test/");
    expect(siteUrl()).toBe("https://example.test");
  });

  it("uses the production host Vercel provides", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "rewrity.vercel.app");
    expect(siteUrl()).toBe("https://rewrity.vercel.app");
  });

  it("falls back to the dev server", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(siteUrl()).toBe("http://localhost:3000");
  });
});

describe("sitemap", () => {
  it("lists every public page in every language, and nothing private", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      "https://example.test/en",
      "https://example.test/fr",
      "https://example.test/en/privacy",
      "https://example.test/fr/privacy",
    ]);
    expect(urls.some((url) => url.includes("history"))).toBe(false);
  });

  it("links each page to its translations", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    expect(sitemap()[0].alternates?.languages).toEqual({
      en: "https://example.test/en",
      fr: "https://example.test/fr",
    });
  });
});

describe("robots", () => {
  it("keeps crawlers out of the API and points at the sitemap", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
    const result = robots();
    expect(result.sitemap).toBe("https://example.test/sitemap.xml");
    expect(JSON.stringify(result.rules)).toContain("/api/");
  });
});
