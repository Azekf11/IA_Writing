// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn(() => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { createServiceClient } = await import("@/lib/supabase/service");

const ROOT = join(import.meta.dirname, "..");

beforeEach(() => {
  createClient.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("the server's client", () => {
  it("uses the secret key, with no browser session of any kind", () => {
    expect(createServiceClient()).not.toBeNull();
    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      "http://localhost:54321",
      "test-secret",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        db: { timeout: 8_000 },
      },
    );
  });

  it("is null without the key, so the route refuses to run", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(createServiceClient()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("is null without the project's address", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(createServiceClient()).toBeNull();
  });

  it("cannot be imported from client code: the build refuses the module", () => {
    const source = readFileSync(join(ROOT, "lib/supabase/service.ts"), "utf8");
    expect(source.split("\n")[0]).toBe('import "server-only";');
  });

  it("is the only place in the app that reads the key, and only the two routes use it", () => {
    const files = [
      ...["app", "components", "lib", "i18n", "messages"].flatMap((dir) =>
        readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => join(entry.parentPath, entry.name)),
      ),
      join(ROOT, "proxy.ts"),
      join(ROOT, "next.config.ts"),
    ];
    const mentions = (needle: string) =>
      files
        .filter((file) => readFileSync(file, "latin1").includes(needle))
        .map((file) => relative(ROOT, file));
    expect(mentions("SUPABASE_SECRET_KEY")).toEqual([
      "lib/supabase/service.ts",
    ]);
    // The account route is the one other user, for deleting the signed-in account
    expect(mentions("supabase/service").sort()).toEqual([
      "app/api/account/route.ts",
      "app/api/rewrite/route.ts",
    ]);
    // A relative import does not name the module that way, but the file that re-exports the
    // client, or calls it, names the function
    expect(mentions("createServiceClient").sort()).toEqual([
      "app/api/account/route.ts",
      "app/api/rewrite/route.ts",
      "lib/supabase/service.ts",
    ]);
  });

  // Where a developer reads what the key is for, before setting it
  it("is described in .env.example by every route that uses it", () => {
    const template = readFileSync(join(ROOT, ".env.example"), "utf8");
    const about = template
      .slice(0, template.indexOf("\nSUPABASE_SECRET_KEY="))
      .split("\n\n")
      .at(-1);
    const routes = readdirSync(join(ROOT, "app/api"), { recursive: true })
      .map(String)
      .filter((file) => file.endsWith("route.ts"))
      .filter((file) =>
        readFileSync(join(ROOT, "app/api", file), "utf8").includes(
          "createServiceClient",
        ),
      )
      .map((file) => `/api/${file.replace(/\/route\.ts$/, "")}`);
    expect(routes.sort()).toEqual(["/api/account", "/api/rewrite"]);
    for (const route of routes) expect(about).toContain(route);
  });
});
