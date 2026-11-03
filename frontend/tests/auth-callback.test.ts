import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const exchange = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: (code: string) => exchange(code) },
  }),
}));

const { GET } = await import("@/app/auth/callback/route");

const ORIGIN = "http://localhost:3000";

const redirectFor = async (search: string) => {
  const response = await GET(
    new NextRequest(`${ORIGIN}/auth/callback${search}`),
  );
  return new URL(response.headers.get("location")!);
};

beforeEach(() => {
  exchange.mockReset().mockResolvedValue({ error: null });
});

describe("GET /auth/callback", () => {
  it("signs in and goes to the path it was given", async () => {
    const target = await redirectFor("?code=abc&next=/fr/history");
    expect(exchange).toHaveBeenCalledWith("abc");
    expect(target.href).toBe(`${ORIGIN}/fr/history`);
  });

  it("says so when the link is bad, without leaving the site", async () => {
    exchange.mockResolvedValue({ error: { code: "otp_expired" } });
    const target = await redirectFor("?code=abc");
    expect(target.origin).toBe(ORIGIN);
    expect(target.searchParams.get("auth_error")).toBe("1");
  });

  // "@evil.example" is the one that would really leave: pasted after the origin, it makes
  // localhost:3000 the user name of a URL on evil.example
  it.each([
    "@evil.example",
    ".evil.example",
    "//evil.example",
    "https://evil.example",
    "evil.example",
    String.raw`\evil.example`,
    "",
  ])("never leaves the site for next=%s", async (next) => {
    for (const code of ["?code=abc&", "?"]) {
      const target = await redirectFor(
        `${code}next=${encodeURIComponent(next)}`,
      );
      expect(target.origin).toBe(ORIGIN);
      expect(target.pathname).toBe("/");
    }
  });
});
