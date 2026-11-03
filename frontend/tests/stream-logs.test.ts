// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { streamResponse } from "@/lib/rewrite/stream-response";
import { opening } from "./anthropic-sse";

// In a file of its own: the SDK ties its logger to the console once per process, the first time
// it logs, so the console must already be watched by then.
let server: Server;
const printed: string[] = [];

beforeAll(async () => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
  }
  server = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "text/event-stream" });
    // A complete event whose data is not JSON: a proxy's fault, or the service's
    response.end(
      `${opening()}event: content_block_delta\ndata: {"broken CANARYTEXT\n\n`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("the logs, through the real SDK", () => {
  it("print none of the answer when an event is corrupt", async () => {
    const onSettled = vi.fn().mockResolvedValue(undefined);
    const { response, settled } = streamResponse({
      text: "It is crucial to act now.",
      references: [],
      options: {},
      signal: new AbortController().signal,
      prepMs: 1,
      onSettled,
    });
    expect(await response.text()).toContain("upstream_error");
    await settled;
    expect(onSettled).toHaveBeenCalledWith("failed", null);
    // The failure itself is logged, by its kind
    expect(printed.join("\n")).toContain("Unexpected rewrite failure");
    expect(printed.join("\n")).not.toContain("CANARYTEXT");
  });
});
