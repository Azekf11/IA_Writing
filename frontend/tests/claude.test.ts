// @vitest-environment node
import { format } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestEdits, RewriteError, streamEdits } from "@/lib/rewrite/claude";
import type { AttemptReport } from "@/lib/rewrite/diagnostics";
import { sse } from "./anthropic-sse";

// Minimal stand-in for the SDK client
function fakeClient(create: ReturnType<typeof vi.fn>) {
  return { messages: { create } } as unknown as Pick<Anthropic, "messages">;
}

// Headers are required, otherwise the SDK builds a connection error
const apiError = (status: number) =>
  Anthropic.APIError.generate(status, {}, "x", new Headers());

const ok = (edits: unknown[]) => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ edits }) }],
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
    const create = vi.fn().mockResolvedValue(ok(edits));
    await expect(requestEdits("a", [], fakeClient(create))).resolves.toEqual(
      edits,
    );
  });

  it("wraps the text in tags and asks for structured output", async () => {
    const create = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("hello", [], fakeClient(create));
    const params = create.mock.calls[0][0];
    expect(params.messages[0].content).toBe("<text>\nhello\n</text>");
    expect(params.output_config.format).toBeDefined();
  });

  // The README's bound on what one attempt can cost
  it("caps the length of an answer", async () => {
    const create = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("hello", [], fakeClient(create));
    expect(create.mock.calls[0][0].max_tokens).toBe(8_000);
  });

  it("maps a refusal to the refused code", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ stop_reason: "refusal", content: [] });
    expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
      "refused",
    );
  });

  it("treats cut-off or malformed output as an upstream error", async () => {
    for (const text of ['{"edits":[{"orig', '{"edits":[{"original":"a"}]}']) {
      const create = vi.fn().mockResolvedValue({
        stop_reason: "max_tokens",
        content: [{ type: "text", text }],
      });
      expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
        "upstream_error",
      );
    }
  });

  it("maps rate limits and overload to busy", async () => {
    for (const status of [429, 529]) {
      const error = apiError(status);
      const create = vi.fn().mockRejectedValue(error);
      expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
        "busy",
      );
    }
  });

  // The model was called, so the message must be the one that says the attempt counted
  it("maps a rejected key to upstream_error, and says why in the logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const status of [401, 403]) {
      const create = vi.fn().mockRejectedValue(apiError(status));
      expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
        "upstream_error",
      );
    }
    expect(logged).toHaveBeenCalledWith("Anthropic credentials rejected");
  });

  it("maps other API failures to upstream_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = apiError(400);
    const create = vi.fn().mockRejectedValue(error);
    const code = await codeOf(requestEdits("a", [], fakeClient(create)));
    expect(code).toBe("upstream_error");
  });

  // An API error's message can quote the request, and so the text
  it("logs the status of an API failure, never its message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(apiError(400));
    await codeOf(requestEdits("a", [], fakeClient(create)));
    expect(logged.mock.calls).toEqual([["Anthropic API error", 400]]);
  });

  it("maps a lost connection and a timeout to upstream_error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const error of [
      new Anthropic.APIConnectionError({ message: "socket hang up" }),
      new Anthropic.APIConnectionTimeoutError(),
    ]) {
      const create = vi.fn().mockRejectedValue(error);
      expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
        "upstream_error",
      );
    }
    // The class is logged, not the message
    expect(format(...logged.mock.calls.flat())).not.toContain("socket hang up");
  });

  it("stays quiet when the reader cancelled the call", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Anthropic.APIUserAbortError());
    expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
      "upstream_error",
    );
    expect(logged).not.toHaveBeenCalled();
  });

  it("maps anything else to upstream_error, and logs its kind only", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi
      .fn()
      .mockRejectedValue(
        new SyntaxError('Unexpected token in "my secret text"'),
      );
    expect(await codeOf(requestEdits("a", [], fakeClient(create)))).toBe(
      "upstream_error",
    );
    expect(logged).toHaveBeenCalledWith(
      "Unexpected rewrite failure",
      "SyntaxError",
    );
    expect(format(...logged.mock.calls.flat())).not.toContain("secret");
  });

  it("gives the call a deadline and no retries", async () => {
    const create = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("a", [], fakeClient(create));
    expect(create.mock.calls[0][1]).toMatchObject({
      timeout: 50_000,
      maxRetries: 0,
      signal: expect.any(AbortSignal),
    });
  });

  it("counts what the request already used against the deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const create = vi.fn().mockResolvedValue(ok([]));
    await requestEdits("a", [], fakeClient(create), {}, 20_000);
    expect(timeout).toHaveBeenLastCalledWith(30_000);
    await requestEdits("a", [], fakeClient(create), {}, 70_000);
    expect(timeout).toHaveBeenLastCalledWith(0);
    timeout.mockRestore();
  });
});

// A stand-in for client.messages.stream: emits the answer in pieces, then resolves the final message
function fakeStream(pieces: string[], stopReason = "end_turn") {
  const final = {
    stop_reason: stopReason,
    content: [{ type: "text", text: pieces.join("") }],
  };
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

  it("passes the abort signal on to the request, with a deadline and no retries", async () => {
    const { client, options } = fakeStream([answer]);
    const controller = new AbortController();
    await streamEdits("a d", [], () => {}, {}, client, controller.signal);
    const sent = options[0] as { signal: AbortSignal };
    expect(sent).toMatchObject({ timeout: 50_000, maxRetries: 0 });
    expect(sent.signal.aborted).toBe(false);
    controller.abort();
    expect(sent.signal.aborted).toBe(true);
  });

  it("works without a signal from the caller", async () => {
    const { client, options } = fakeStream([answer]);
    await streamEdits("a d", [], () => {}, {}, client);
    expect((options[0] as { signal: AbortSignal }).signal.aborted).toBe(false);
  });

  it("hands over the edits written before a cut, and says the answer is not complete", async () => {
    const cut = answer.slice(0, answer.indexOf('"d"') - 2);
    const { client } = fakeStream([cut], "max_tokens");
    const seen: string[] = [];
    expect(
      await codeOf(
        streamEdits("a d", [], (e) => seen.push(e.original), {}, client),
      ),
    ).toBe("upstream_error");
    expect(seen).toEqual(["a"]);
  });

  it("says so even when the cut-off answer happens to read as a whole", async () => {
    const { client } = fakeStream([answer], "max_tokens");
    expect(await codeOf(streamEdits("a d", [], () => {}, {}, client))).toBe(
      "upstream_error",
    );
  });

  it("fails when the answer was cut off before any edit", async () => {
    const { client } = fakeStream(['{"edits":[{"orig'], "max_tokens");
    expect(await codeOf(streamEdits("a", [], () => {}, {}, client))).toBe(
      "upstream_error",
    );
  });

  it("treats a complete, empty list as nothing to change", async () => {
    const { client } = fakeStream(['{"edits":[]}']);
    await expect(streamEdits("a", [], () => {}, {}, client)).resolves.toEqual(
      [],
    );
  });

  it("fails when the answer holds no usable edit, instead of saying nothing needs changing", async () => {
    for (const pieces of [
      [],
      ["I cannot answer in JSON."],
      ['{"edits":[{"original":"a"}]}'],
      // These close every brace they open, and still are not the answer that was asked for
      ["{}"],
      ["[]"],
      ['{"edits":null}'],
      ['{"edits":"none"}'],
      ['{"error":"nope"}'],
      ["Sorry {see below}"],
    ]) {
      const { client } = fakeStream(pieces);
      expect(await codeOf(streamEdits("a", [], () => {}, {}, client))).toBe(
        "upstream_error",
      );
    }
  });

  it("maps a refusal to the refused code", async () => {
    const { client } = fakeStream([], "refusal");
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

// The real SDK over a canned HTTP answer, with no network: how it parses a stream and which
// errors it raises are part of what these tests check. Stand-in clients cannot show that.
function realClient(body: BodyInit, contentType = "text/event-stream") {
  const requests: Record<string, unknown>[] = [];
  const client = new Anthropic({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(body, {
        status: 200,
        headers: { "content-type": contentType },
      });
    },
  });
  return { client, requests };
}

const firstEdit = answer.slice(0, answer.indexOf('"d"') - 2);

describe("streamEdits, through the real SDK", () => {
  const run = (body: BodyInit) =>
    streamEdits("a d", [], () => {}, {}, realClient(body).client);

  it("still asks for structured output", async () => {
    const { client, requests } = realClient(sse([answer], "end_turn"));
    await streamEdits("a d", [], () => {}, {}, client);
    expect(requests[0]).toMatchObject({
      stream: true,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: { type: "object" } },
      },
    });
  });

  it("returns the edits of a complete answer", async () => {
    expect(await run(sse([answer], "end_turn"))).toHaveLength(2);
  });

  it("hands over the edit that was complete when the tokens ran out, then fails", async () => {
    const seen: string[] = [];
    const { client } = realClient(sse([firstEdit], "max_tokens"));
    expect(
      await codeOf(
        streamEdits("a d", [], (e) => seen.push(e.original), {}, client),
      ),
    ).toBe("upstream_error");
    expect(seen).toEqual(["a"]);
  });

  it("fails when the tokens ran out before any edit", async () => {
    expect(await codeOf(run(sse(['{"edits":[{"orig'], "max_tokens")))).toBe(
      "upstream_error",
    );
  });

  it("reports a refusal, with or without text before it", async () => {
    expect(await codeOf(run(sse([], "refusal")))).toBe("refused");
    expect(await codeOf(run(sse([firstEdit], "refusal")))).toBe("refused");
  });

  it("fails on an answer that is not the expected JSON", async () => {
    expect(await codeOf(run(sse(["Sorry, no."], "end_turn")))).toBe(
      "upstream_error",
    );
  });

  // Delivers `before`, then fails on the next read, as a connection that dies does
  const dyingAfter = (before: string) => {
    const encoder = new TextEncoder();
    let sent = false;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          return controller.error(new Error("hang up in my secret text"));
        }
        sent = true;
        controller.enqueue(encoder.encode(before));
      },
    });
  };

  it("maps a connection that dies to upstream_error, and logs no text from the answer", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const whole = sse([firstEdit], "end_turn");
    for (const [before, edits] of [
      // Before the first edit, then after it
      [whole.slice(0, whole.indexOf("content_block_delta")), 0],
      [whole.slice(0, whole.indexOf("content_block_stop")), 1],
    ] as const) {
      const seen: string[] = [];
      const { client } = realClient(dyingAfter(before));
      expect(
        await codeOf(
          streamEdits("a d", [], (e) => seen.push(e.original), {}, client),
        ),
      ).toBe("upstream_error");
      expect(seen).toHaveLength(edits);
    }
    expect(format(...logged.mock.calls.flat())).not.toContain("secret");
  });

  it.each(["overloaded_error", "rate_limit_error"])(
    "maps a %s event inside the stream to busy",
    async (type) => {
      const body = `event: error\ndata: ${JSON.stringify({
        type: "error",
        error: { type, message: "x" },
      })}\n\n`;
      expect(await codeOf(run(body))).toBe("busy");
    },
  );

  it("maps another error event inside the stream to upstream_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = `event: error\ndata: ${JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "x" },
    })}\n\n`;
    expect(await codeOf(run(body))).toBe("upstream_error");
  });

  it("recognises a cancelled call without logging it", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    logged.mockClear();
    const controller = new AbortController();
    controller.abort();
    const { client, requests } = realClient(sse([answer], "end_turn"));
    await expect(
      streamEdits("a d", [], () => {}, {}, client, controller.signal),
    ).rejects.toBeInstanceOf(RewriteError);
    expect(logged).not.toHaveBeenCalled();
    // The service is never reached, so nothing is paid for
    expect(requests).toHaveLength(0);
  });
});

describe("requestEdits, through the real SDK", () => {
  const message = (
    text: string | null,
    stopReason: string,
    usage = { input_tokens: 1, output_tokens: 1 },
  ) =>
    JSON.stringify({
      id: "m",
      type: "message",
      role: "assistant",
      model: "x",
      content: text === null ? [] : [{ type: "text", text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage,
    });
  const run = (body: string) =>
    requestEdits("a d", [], realClient(body, "application/json").client);

  // The tests that read the model's name stub ANTHROPIC_MODEL, so the shell cannot change it
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the edits of a complete answer", async () => {
    expect(await run(message(answer, "end_turn"))).toHaveLength(2);
  });

  it("reports a refusal, with or without text", async () => {
    expect(await codeOf(run(message(null, "refusal")))).toBe("refused");
    expect(await codeOf(run(message(firstEdit, "refusal")))).toBe("refused");
  });

  it("fails on a cut-off answer instead of crashing", async () => {
    expect(await codeOf(run(message(firstEdit, "max_tokens")))).toBe(
      "upstream_error",
    );
  });

  it("fills in the model, the tokens, the ending and the time of a whole answer", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "");
    const report: AttemptReport = {};
    const body = message(answer, "end_turn", {
      input_tokens: 1_200,
      output_tokens: 340,
    });
    await requestEdits(
      "a d",
      [],
      realClient(body, "application/json").client,
      {},
      0,
      report,
    );
    expect(report).toMatchObject({
      model: "claude-sonnet-5-5",
      stopReason: "end_turn",
      inputTokens: 1_200,
      outputTokens: 340,
    });
    expect(report.modelMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps what an answer it refuses said about itself", async () => {
    vi.stubEnv("ANTHROPIC_MODEL", "");
    const report: AttemptReport = {};
    const client = realClient(
      message(null, "refusal"),
      "application/json",
    ).client;
    expect(await codeOf(requestEdits("a d", [], client, {}, 0, report))).toBe(
      "refused",
    );
    expect(report).toMatchObject({
      model: "claude-sonnet-5-5",
      stopReason: "refusal",
      inputTokens: 1,
      outputTokens: 1,
    });
    expect(report.modelMs).toBeGreaterThanOrEqual(0);
  });
});
