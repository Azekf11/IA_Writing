import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
type SetAll = (
  cookies: { name: string; value: string; options: object }[],
  headers: Record<string, string>,
) => void;
let setAll: SetAll = () => {};
vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    { cookies }: { cookies: { setAll: SetAll } },
  ) => {
    setAll = cookies.setAll;
    return { auth: { getClaims } };
  },
}));

const { refreshSession } = await import("@/lib/supabase/proxy");

afterEach(() => vi.unstubAllEnvs());

const refreshed = async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "key");
  const request = new NextRequest("http://localhost/en/privacy");
  const response = NextResponse.next();
  getClaims.mockImplementation(async () =>
    setAll([{ name: "sb-auth-token", value: "new", options: {} }], {
      "Cache-Control": "private, no-cache, no-store",
      Expires: "0",
      Pragma: "no-cache",
    }),
  );
  await refreshSession(request, response);
  return { request, response };
};

describe("refreshSession", () => {
  it("sets the new session cookie for the page and for the browser", async () => {
    const { request, response } = await refreshed();
    expect(request.cookies.get("sb-auth-token")?.value).toBe("new");
    expect(response.cookies.get("sb-auth-token")?.value).toBe("new");
  });

  // Otherwise one reader's session could be served to the next from a shared cache
  it("keeps a response that sets a session cookie out of shared caches", async () => {
    const { response } = await refreshed();
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-store",
    );
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
  });
});
