import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { requestEdits, RewriteError, streamEdits } from "@/lib/rewrite/claude";

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
    await expect(requestEdits("a", [], fakeClient(parse))).resolves.toEqual(
      edits,
    );
  });

  it("wraps the text in tags and asks for structured output", async () => {
    const parse = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("hello", [], fakeClient(parse));
    const params = parse.mock.calls[0][0];
    expect(params.messages[0].content).toBe("<text>\nhello\n</text>");
    expect(params.output_config.format).toBeDefined();
  });

  it("maps a refusal to the refused code", async () => {
    const parse = vi.fn().mockResolvedValue({ stop_reason: "refusal" });
    expect(await codeOf(requestEdits("a", [], fakeClient(parse)))).toBe(
      "refused",
    );
  });

  it("treats unparsable output as an upstream error", async () => {
    const parse = vi
      .fn()
      .mockResolvedValue({ stop_reason: "max_tokens", parsed_output: null });
    const code = await codeOf(requestEdits("a", [], fakeClient(parse)));
    expect(code).toBe("upstream_error");
  });

  it("maps rate limits and overload to busy", async () => {
    for (const status of [429, 529]) {
      const error = apiError(status);
      const parse = vi.fn().mockRejectedValue(error);
      expect(await codeOf(requestEdits("a", [], fakeClient(parse)))).toBe(
        "busy",
      );
    }
  });

  it("maps a rejected key to a server error, not a user error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = apiError(401);
    const parse = vi.fn().mockRejectedValue(error);
    const code = await codeOf(requestEdits("a", [], fakeClient(parse)));
    expect(code).toBe("server_error");
  });

  it("maps other API failures to upstream_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = apiError(400);
    const parse = vi.fn().mockRejectedValue(error);
    const code = await codeOf(requestEdits("a", [], fakeClient(parse)));
    expect(code).toBe("upstream_error");
  });
});

// A stand-in for client.messages.stream: emits the answer in pieces, then resolves the final message
function fakeStream(
  pieces: string[],
  final: Record<string, unknown> = { stop_reason: "end_turn" },
) {
  const handlers: Record<string, (value: string) => void> = {};
  const stream = {
    on: (event: string, handler: (value: string) => void) => {
      handlers[event] = handler;
      return stream;
    },
    finalMessage: async () => {
      for (const piece of pieces) handlers.text?.(piece);
      return final;
    },
  };
  const options: unknown[] = [];
  const client = {
    messages: {
      stream: (_params: unknown, opts: unknown) => {
        options.push(opts);
        return stream;
      },
    },
  } as unknown as Pick<Anthropic, "messages">;
  return { client, options };
}

const answer = JSON.stringify({
  edits: [
    { original: "a", replacement: "b", reason: "c" },
    { original: "d", replacement: "e", reason: "f" },
  ],
});

describe("streamEdits", () => {
  it("hands each edit over as the pieces arrive, and returns them all", async () => {
    const { client } = fakeStream(answer.match(/[\s\S]{1,9}/g) ?? []);
    const seen: string[] = [];
    const all = await streamEdits(
      "a d",
      [],
      (e) => seen.push(e.original),
      {},
      client,
    );
    expect(seen).toEqual(["a", "d"]);
    expect(all).toHaveLength(2);
  });

  it("passes the abort signal on to the request", async () => {
    const { client, options } = fakeStream([answer]);
    const controller = new AbortController();
    await streamEdits("a d", [], () => {}, {}, client, controller.signal);
    expect(options[0]).toMatchObject({ signal: controller.signal });
  });

  it("keeps the edits that arrived before the answer was cut off", async () => {
    const cut = answer.slice(0, answer.indexOf('"d"') - 2);
    const { client } = fakeStream([cut], { stop_reason: "max_tokens" });
    const all = await streamEdits("a d", [], () => {}, {}, client);
    expect(all).toHaveLength(1);
  });

  it("fails when the answer was cut off before any edit", async () => {
    const { client } = fakeStream(['{"edits":[{"orig'], {
      stop_reason: "max_tokens",
    });
    expect(await codeOf(streamEdits("a", [], () => {}, {}, client))).toBe(
      "upstream_error",
    );
  });

  it("maps a refusal to the refused code", async () => {
    const { client } = fakeStream([], { stop_reason: "refusal" });
    expect(await codeOf(streamEdits("a", [], () => {}, {}, client))).toBe(
      "refused",
    );
  });

  it("maps an overloaded service to busy", async () => {
    const client = {
      messages: {
        stream: () => ({
          on: () => {},
          finalMessage: async () => {
            throw apiError(529);
          },
        }),
      },
    } as unknown as Pick<Anthropic, "messages">;
    expect(await codeOf(streamEdits("a", [], () => {}, {}, client))).toBe(
      "busy",
    );
  });
});
