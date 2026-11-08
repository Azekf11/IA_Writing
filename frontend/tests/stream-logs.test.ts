// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { format } from "node:util";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { logAttempt, type AttemptReport } from "@/lib/rewrite/diagnostics";
import { streamResponse } from "@/lib/rewrite/stream-response";
import { opening, piece } from "./anthropic-sse";

// In a file of its own: the SDK ties its logger to the console once per process, the first time
// it logs, so the console must already be watched by then.
let server: Server;
let answer = "";
const printed: string[] = [];

// A complete event whose data is not JSON: a proxy's fault, or the service's
const CORRUPT = `event: content_block_delta\ndata: {"broken CANARYTEXT\n\n`;

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      printed.push(format(...args));
    });
  }
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(answer);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});

beforeEach(() => {
  printed.length = 0;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("the logs, through the real SDK", () => {
  it("print none of the answer when an event is corrupt", async () => {
    answer = `${opening()}${CORRUPT}`;
    const report: AttemptReport = {};
    const onSettled = vi.fn().mockImplementation(async (outcome) => {
      logAttempt(outcome, report);
    });
    const { response, settled } = streamResponse({
      text: "It is crucial to act now.",
      references: [],
      options: {},
      signal: new AbortController().signal,
      prepMs: 1,
      report,
      onSettled,
    });
    expect(await response.text()).toContain("upstream_error");
    await settled;
    expect(onSettled).toHaveBeenCalledWith("failed", null);
    // The failure itself is logged, by its kind
    expect(printed.join("\n")).toContain("Unexpected rewrite failure");
    expect(printed.join("\n")).not.toContain("CANARYTEXT");
    // The attempt's own line holds what the service reported before the corrupt event
    const line = printed.find((entry) => entry.startsWith("Rewrite attempt"));
    const logged = JSON.parse((line as string).replace("Rewrite attempt ", ""));
    expect(logged).toMatchObject({
      state: "failed",
      input_tokens: 1,
      dropped: 0,
    });
    expect(logged).not.toHaveProperty("output_tokens");
  });

  it("print neither the text nor an edit delivered before the corrupt event", async () => {
    const edit = {
      original: "crucial",
      replacement: "CANARY important",
      reason: "CANARY reason",
    };
    answer = `${opening()}${piece(`{"edits":[${JSON.stringify(edit)},`)}${CORRUPT}`;
    const { response, settled } = streamResponse({
      text: "It is crucial to act now.",
      references: [],
      options: {},
      signal: new AbortController().signal,
      prepMs: 1,
      onSettled: vi.fn().mockResolvedValue(undefined),
    });
    // The reader has the edit: the code that handles it has seen it by now
    expect(await response.text()).toContain("CANARY important");
    await settled;
    expect(printed.join("\n")).toContain("Answer cut short");
    expect(printed.join("\n")).not.toContain("CANARY");
    expect(printed.join("\n")).not.toContain("crucial");
  });
});
