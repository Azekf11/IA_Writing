// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../package.json";

const ROOT = path.join(__dirname, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });

const clientEntries = ["app", "components"]
  .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
  .filter((file) => /^\s*"use client"/.test(readFileSync(file, "utf8")));

// A file's imports that are part of its own script: `import type` is erased, and what an
// `import()` brings comes later, when it is asked for
const staticImports = (file: string) =>
  [
    ...readFileSync(file, "utf8").matchAll(
      /^import\s+(?!type\b)[^;]*?from\s+"([^"]+)";/gm,
    ),
  ].map(([, source]) => source);

const resolve = (from: string, source: string) => {
  const base = source.startsWith("@/")
    ? path.join(ROOT, source.slice(2))
    : path.join(path.dirname(from), source);
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
};

// Everything the client components pull in by name: packages, and which file asked for each
function reachedFromTheBrowser() {
  const packages = new Map<string, string>();
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const source of staticImports(file)) {
      if (source.startsWith("@/") || source.startsWith(".")) {
        const next = resolve(file, source);
        if (next) walk(next);
      } else {
        packages.set(source, path.relative(ROOT, file));
      }
    }
  };
  clientEntries.forEach(walk);
  return {
    packages,
    files: [...seen].map((file) => path.relative(ROOT, file)),
  };
}

describe("what the browser downloads up front", () => {
  it("finds the client components at all", () => {
    expect(clientEntries.length).toBeGreaterThan(10);
    expect(reachedFromTheBrowser().packages.has("next-intl")).toBe(true);
  });

  it.each(["zod", "@supabase/ssr", "@supabase/supabase-js"])(
    "leaves out %s, which only the server or a click needs",
    (name) => {
      expect(reachedFromTheBrowser().packages.get(name)).toBeUndefined();
    },
  );

  it("does not reach the request schema or the Supabase client file", () => {
    const { files } = reachedFromTheBrowser();
    expect(files).not.toContain(path.join("lib", "rewrite", "schema.ts"));
    expect(files).not.toContain(path.join("lib", "supabase", "browser.ts"));
  });

  it.each([
    "guard",
    "negation",
    "numbers",
    "units",
    "attribution",
    "word-diff",
  ])("fetches lib/rewrite/%s.ts on first use, not with the page", (name) => {
    expect(reachedFromTheBrowser().files).not.toContain(
      path.join("lib", "rewrite", `${name}.ts`),
    );
  });

  it.each(["scan", "rules-en", "rules-fr"])(
    "fetches lib/check/%s.ts when the free check is asked for, not with the page",
    (name) => {
      expect(reachedFromTheBrowser().files).not.toContain(
        path.join("lib", "check", `${name}.ts`),
      );
    },
  );

  it("does not bring the locating code in for the example", () => {
    expect(reachedFromTheBrowser().files).not.toContain(
      path.join("lib", "rewrite", "locate.ts"),
    );
  });

  it("has no animation library: one fade does not need one", () => {
    expect(Object.keys(manifest.dependencies)).not.toContain("motion");
  });
});
