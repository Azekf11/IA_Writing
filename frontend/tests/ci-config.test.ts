// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../package.json";
import playwright from "../playwright.config";

// What the workflows and the tools around them promise. A trigger that misses a path fails
// silently: no run starts, so nothing else would say so.
const ROOT = path.join(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const workflow = (name: string) => read(`.github/workflows/${name}.yml`);

// The push list and the pull request list of a workflow
const triggers = (name: string) =>
  [...workflow(name).matchAll(/\bpaths:\n((?: +(?:#.*|- .+)\n)+)/g)].map(
    ([, list]) => [...list.matchAll(/- "(.+)"/g)].map(([, entry]) => entry),
  );

describe("what starts each workflow", () => {
  it.each([
    // Read or imported by the unit tests
    ["frontend", ".github/**"],
    ["frontend", "docs/research/comparison-texts.json"],
    ["frontend", "supabase/tests/local-stack.mjs"],
    ["frontend", "supabase/tests/utc-day.mjs"],
    ["frontend", "supabase/migrations/**"],
    // The dependency updates below look for it
    ["frontend", "corpus-pipeline/uv.lock"],
    // The embedder and its fixture are checked against the pipeline's code
    ["corpus-pipeline", "frontend/data/embedder/**"],
    ["corpus-pipeline", "frontend/tests/fixtures/embedder-parity.json"],
    // Imported by the database tests
    ["database", "frontend/lib/rewrite/quota.ts"],
    // Everything between the route and the database
    ["integration", "supabase/**"],
    ["integration", "frontend/lib/**"],
    ["integration", "frontend/proxy.ts"],
    ["integration", "frontend/audit/**"],
    ["integration", "frontend/package-lock.json"],
    // Where the workflow reads the audit's script and the Node version it sets up
    ["integration", "frontend/package.json"],
    // And the site those suites drive: its pages and its routing, the buttons they click, the words
    // they wait for
    ["integration", "frontend/app/**"],
    ["integration", "frontend/components/**"],
    ["integration", "frontend/i18n/**"],
    ["integration", "frontend/messages/**"],
    ["integration", "frontend/next.config.ts"],
  ])(
    "%s runs on a change to %s, on push and on a pull request",
    (name, file) => {
      const lists = triggers(name);
      expect(lists).toHaveLength(2);
      for (const list of lists) expect(list).toContain(file);
    },
  );

  it.each(["database", "integration", "corpus-pipeline"])(
    "%s also runs on a change to its own file",
    (name) => {
      for (const list of triggers(name)) {
        expect(list).toContain(`.github/workflows/${name}.yml`);
      }
    },
  );
});

describe("what a workflow's token can do", () => {
  const files = readdirSync(path.join(ROOT, ".github/workflows"));

  it("looks at every workflow", () => {
    expect(files).toEqual(
      expect.arrayContaining(
        ["frontend", "database", "integration", "corpus-pipeline"].map(
          (name) => `${name}.yml`,
        ),
      ),
    );
  });

  // At the workflow's own level, so that a job added later starts from it too
  it.each(files)("%s reads the repository and does nothing else", (file) => {
    expect(read(`.github/workflows/${file}`)).toMatch(
      /^permissions:\n  contents: read\n(?! )/m,
    );
  });
});

describe("the route and database job", () => {
  it("runs the suites that drive the real route, and only those", () => {
    expect(workflow("integration")).toContain(
      "run: npm run audit -- limits concurrency\n",
    );
  });

  it("keeps the mailbox the audit asks for, and uses no secret", () => {
    const start = /run: supabase start -x (\S+)/.exec(workflow("integration"));
    expect(start?.[1].split(",")).not.toContain("mailpit");
    expect(workflow("integration")).not.toContain("secrets.");
  });

  it("leaves the report and the server's log when it fails", () => {
    const upload = /if: failure\(\)[\s\S]*/.exec(workflow("integration"))?.[0];
    expect(upload).toContain("frontend/audit/report.md");
    expect(upload).toContain("frontend/audit/server.log");
  });
});

describe("the unit tests on CI", () => {
  // The runner's own zone is UTC, where a local day or a local midnight taken for the UTC one
  // passes unseen
  it("run in a zone far from UTC", () => {
    expect(workflow("frontend")).toContain(
      "- run: npm test\n        env:\n          TZ: Asia/Tokyo\n",
    );
  });
});

describe("a failed browser run", () => {
  it("records a trace on its retry and a screenshot of what failed", () => {
    expect(playwright.use).toMatchObject({
      trace: "on-first-retry",
      screenshot: "only-on-failure",
    });
  });

  it("uploads them from CI", () => {
    const upload = /if: failure\(\)[\s\S]*/.exec(workflow("frontend"))?.[0];
    expect(upload).toContain("path: frontend/test-results/");
  });
});

describe("the browser tests", () => {
  it("do not depend on what .env.local says about the excerpts", () => {
    const server = playwright.webServer;
    expect(Array.isArray(server) ? undefined : server?.env).toMatchObject({
      STYLE_REFERENCES: "on",
    });
  });
});

describe("the Node version", () => {
  it("is set once, in package.json, which Vercel and the workflows read", () => {
    expect(manifest.engines.node).toBe("24.x");
    for (const name of ["frontend", "database", "integration"]) {
      expect(workflow(name)).toContain(
        "node-version-file: frontend/package.json",
      );
      expect(workflow(name)).not.toMatch(/node-version: /);
    }
  });
});

describe("the dependency updates", () => {
  const entries = read(".github/dependabot.yml")
    .split("- package-ecosystem: ")
    .slice(1);

  it("cover three ecosystems", () => {
    expect(entries).toHaveLength(3);
  });

  it.each([
    ["npm", "/frontend", "package-lock.json"],
    ["uv", "/corpus-pipeline", "uv.lock"],
    ["github-actions", "/", ".github/workflows"],
  ])("watch %s in %s, monthly and grouped", (ecosystem, folder, marker) => {
    const entry = entries.find((text) => text.startsWith(`${ecosystem}\n`));
    expect(entry).toContain(`directory: ${folder}\n`);
    expect(entry).toContain("interval: monthly\n");
    expect(entry).toContain("open-pull-requests-limit: 3\n");
    expect(entry).toContain("update-types: [minor, patch]\n");
    expect(existsSync(path.join(ROOT, folder, marker))).toBe(true);
  });
});
