// @vitest-environment node
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestEdits } from "@/lib/rewrite/claude";
import type { AttemptReport } from "@/lib/rewrite/diagnostics";
import { localEnv, siteCommands, siteEnv } from "../audit/lib.mjs";
import { startMockAnthropic } from "../audit/mock-anthropic.mjs";

const execFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  execFileSync.mockReset();
});

const WITHOUT_MAILBOX = {
  API_URL: "http://127.0.0.1:54321",
  PUBLISHABLE_KEY: "publishable",
  SECRET_KEY: "secret",
};
const STACK = {
  ...WITHOUT_MAILBOX,
  MAILPIT_URL: "http://127.0.0.1:54324",
};
const status = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([key, value]) => `${key}="${value}"`)
    .join("\n");

describe("the stack the audit runs on", () => {
  it("is the local one, read from the CLI", () => {
    vi.stubEnv("SUPABASE_WORKDIR", "");
    execFileSync.mockReturnValue(status(STACK));
    expect(localEnv()).toEqual(STACK);
    expect(execFileSync.mock.calls[0].slice(0, 2)).toEqual([
      "supabase",
      ["status", "-o", "env"],
    ]);
  });

  it("is the one SUPABASE_WORKDIR names", () => {
    vi.stubEnv("SUPABASE_WORKDIR", "/some/folder");
    execFileSync.mockReturnValue(status(STACK));
    localEnv();
    expect(execFileSync.mock.calls[0][1]).toEqual([
      "status",
      "-o",
      "env",
      "--workdir",
      "/some/folder",
    ]);
  });

  it("is never a hosted project", () => {
    execFileSync.mockReturnValue(
      status({ ...STACK, API_URL: "https://abcdefgh.supabase.co" }),
    );
    expect(() => localEnv()).toThrow(/local stacks only/);
  });

  it("has a mailbox, which the sign-in checks read", () => {
    execFileSync.mockReturnValue(status(WITHOUT_MAILBOX));
    expect(() => localEnv()).toThrow(/has no MAILPIT_URL/);
  });
});

describe("the site the audit builds", () => {
  it("has the excerpts on, whatever the environment says", () => {
    vi.stubEnv("STYLE_REFERENCES", "off");
    expect(siteEnv(STACK, 4999).STYLE_REFERENCES).toBe("on");
  });

  it("talks to the stand-in on the port it was given, not to the model", () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://model.example");
    vi.stubEnv("ANTHROPIC_API_KEY", "a-real-key");
    expect(siteEnv(STACK, 4999)).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:4999",
      ANTHROPIC_API_KEY: "audit-key-not-real",
    });
  });

  it("is built and served with that environment, and the server's output goes to the log", () => {
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://model.example");
    vi.stubEnv("ANTHROPIC_API_KEY", "a-real-key");
    const env = siteEnv(STACK, 4999);
    expect(siteCommands(STACK, 4999, 3300, 7)).toEqual({
      build: ["npm", ["run", "build"], { env, encoding: "utf8" }],
      serve: [
        "npx",
        ["next", "start", "-p", "3300"],
        { env, stdio: ["ignore", 7, 7] },
      ],
    });
  });
});

describe("the audit's run", () => {
  // The script starts everything on import, so it can only be read
  const script = readFileSync(path.join(__dirname, "../audit/run.mjs"), "utf8");

  it("builds and serves the site with those commands, as they are", () => {
    expect(script).toContain("siteCommands(env, mock.port, PORT, log)");
    expect(script).toContain("spawnSync(...site.build)");
    expect(script).toContain("spawn(...site.serve)");
  });

  it("leaves the stand-in's usual port to `npm run stand-in`", () => {
    expect(script).toContain("startMockAnthropic(0)");
  });
});

describe("the stand-in for the model", () => {
  it("reports a port already taken, so that the audit can clean up", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as AddressInfo;
    try {
      await expect(startMockAnthropic(port)).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
    } finally {
      await new Promise((resolve) => taken.close(resolve));
    }
  });

  // Through the real SDK, so a run by hand shows what the site does without credit
  it.each([
    ["FAILAPI", 529, "overloaded_error", "busy", "other"],
    [
      "FAILCREDIT",
      400,
      "invalid_request_error",
      "provider_unavailable",
      "credit",
    ],
    ["FAILBILLING", 402, "billing_error", "provider_unavailable", "other"],
    ["FAILAUTH", 401, "authentication_error", "provider_unavailable", "other"],
    ["FAILRATE", 429, "rate_limit_error", "busy", "other"],
  ])(
    "fails as the service would for %s",
    async (word, status, type, code, cause) => {
      const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
      const mock = await startMockAnthropic(0);
      mock.state.delayMs = 0;
      try {
        const client = new Anthropic({
          apiKey: "test",
          baseURL: `http://127.0.0.1:${mock.port}`,
        });
        const report: AttemptReport = {};
        await expect(
          requestEdits(`${word} some text.`, [], client, {}, 0, report),
        ).rejects.toMatchObject({ code });
        expect(report).toMatchObject({
          providerStatus: status,
          providerError: type,
          providerCause: cause,
        });
        expect(mock.received).toHaveLength(1);
      } finally {
        quiet.mockRestore();
        await mock.close();
      }
    },
  );

  it("takes a free port when asked for port 0, and says which", async () => {
    const mock = await startMockAnthropic(0);
    try {
      expect(mock.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${mock.port}/nothing`);
      expect(response.status).toBe(404);
    } finally {
      await mock.close();
    }
  });
});
