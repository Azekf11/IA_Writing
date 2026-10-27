import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { requestEdits, RewriteError } from "@/lib/rewrite/claude";

// Minimal stand-in for the SDK client
function fakeClient(parse: ReturnType<typeof vi.fn>) {
  return { messages: { parse } } as unknown as Pick<Anthropic, "messages">;
}

// Headers are required, otherwise the SDK builds a connection error
const apiError = (status: number) =>
  Anthropic.APIError.generate(status, {}, "x", new Headers());

const ok = (edits: unknown[]) => ({
  stop_reason: "end_turn",
  parsed_output: { edits },
});

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RewriteError);
  return (error as RewriteError).code;
}

describe("requestEdits", () => {
  it("returns the parsed edits", async () => {
    const edits = [{ original: "a", replacement: "b", reason: "c" }];
    const parse = vi.fn().mockResolvedValue(ok(edits));
    await expect(requestEdits("a", fakeClient(parse))).resolves.toEqual(edits);
  });

  it("wraps the text in tags and asks for structured output", async () => {
    const parse = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("hello", fakeClient(parse));
    const params = parse.mock.calls[0][0];
    expect(params.messages[0].content).toBe("<text>\nhello\n</text>");
    expect(params.output_config.format).toBeDefined();
  });

  it("maps a refusal to the refused code", async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: "refusal" });
    expect(await codeOf(requestEdits("a", fakeClient(parse)))).toBe("refused");
  });

  it("treats unparsable output as an upstream error", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    const code = await codeOf(requestEdits("a", fakeClient(parse)));
    expect(code).toBe("upstream_error");
  });

  it("maps rate limits and overload to busy", async () => {
    for (const status of [429, 529]) {
      const error = apiError(status);
      const parse = vi.fn().mockRejectedValue(error);
      expect(await codeOf(requestEdits("a", fakeClient(parse)))).toBe("busy");
    }
  });

  it("maps a rejected key to a server error, not a user error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = apiError(401);
    const parse = vi.fn().mockRejectedValue(error);
    const code = await codeOf(requestEdits("a", fakeClient(parse)));
    expect(code).toBe("server_error");
  });

  it("maps other API failures to upstream_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = apiError(400);
    const parse = vi.fn().mockRejectedValue(error);
    const code = await codeOf(requestEdits("a", fakeClient(parse)));
    expect(code).toBe("upstream_error");
  });
});
