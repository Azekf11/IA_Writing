import { beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteError } from "@/lib/rewrite/claude";
import { EventReader, type StreamEvent } from "@/lib/rewrite/protocol";

const streamEdits = vi.fn();
vi.mock("@/lib/rewrite/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rewrite/claude")>()),
  streamEdits: (...args: unknown[]) => streamEdits(...args),
}));

const { streamResponse } = await import("@/lib/rewrite/stream-response");

const TEXT =
  "It is crucial to act now. We will delve into the matter at hand today.";
const raw = (original: string, replacement: string) => ({
  original,
  replacement,
  reason: "r",
});

function run(signal = new AbortController().signal) {
  const onSettled = vi.fn().mockResolvedValue(undefined);
  const { response, settled } = streamResponse({
    text: TEXT,
    references: [],
    options: {},
    signal,
    prepMs: 5,
    onSettled,
  });
  return { response, settled, onSettled };
}

async function events(response: Response): Promise<StreamEvent[]> {
  const reader = new EventReader();
  const out: StreamEvent[] = [];
  const decoder = new TextDecoder();
  const body = response.body!.getReader();
  for (;;) {
    const { done, value } = await body.read();
    if (done) break;
    out.push(...reader.push(decoder.decode(value, { stream: true })));
  }
  return out;
}

// The model call waits for the reader to leave, as a real stream does
const untilAborted = async (
  _t: unknown,
  _r: unknown,
  _e: unknown,
  _o: unknown,
  _c: unknown,
  signal: AbortSignal,
) => {
  await new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve()),
  );
};

beforeEach(() => {
  streamEdits.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("streamResponse", () => {
  it("sends start, each located edit, then done, and closes the attempt as a success", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      onEdit(raw("delve into", "look at"));
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;

    expect(sent.map((e) => e.type)).toEqual(["start", "edit", "edit", "done"]);
    expect(onSettled).toHaveBeenCalledTimes(1);
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("succeeded");
    expect(history).toHaveLength(2);
  });

  it("saves a complete answer with no edit too: the model said nothing needs changing", async () => {
    streamEdits.mockResolvedValue([]);
    const { response, settled, onSettled } = run();
    await events(response);
    await settled;
    expect(onSettled).toHaveBeenCalledWith("succeeded", []);
  });

  it("has the headers a stream needs", () => {
    streamEdits.mockResolvedValue([]);
    const { response } = run();
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(response.headers.get("server-timing")).toBe("prep;dur=5");
  });

  it("never sends an edit the checks reject, and counts it", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      onEdit(raw("delve into", "look at 12 things in"));
      onEdit(raw("nowhere in the text", "x"));
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.filter((e) => e.type === "edit")).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({ type: "done", dropped: 2 });
    expect(sent.at(-1)).not.toHaveProperty("partial");
    expect(onSettled.mock.calls[0][0]).toBe("succeeded");
  });

  it("does not call an answer whose every edit failed a check 'nothing to change'", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("nowhere in the text", "x"));
      onEdit(raw("crucial", "12% crucial"));
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.map((e) => e.type)).toEqual(["start", "error"]);
    expect(sent.at(-1)).toEqual({ type: "error", error: "upstream_error" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  it("does call it 'nothing to change' when every edit changed nothing anyway", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "Crucial"));
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toMatchObject({ type: "done", dropped: 1 });
    expect(onSettled).toHaveBeenCalledWith("succeeded", []);
  });

  it("reports a failure before any edit, and the attempt stays counted", async () => {
    streamEdits.mockRejectedValue(new RewriteError("busy", 503));
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  it("hides the details of an unexpected error, in the answer and in the logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    streamEdits.mockRejectedValue(new Error("secret database password"));
    const { response, settled } = run();
    const sent = await events(response);
    await settled;
    expect(JSON.stringify(sent)).not.toContain("secret");
    expect(sent.at(-1)).toEqual({ type: "error", error: "server_error" });
    expect(logged).toHaveBeenCalledWith("Unhandled rewrite error", "Error");
    expect(logged.mock.calls.flat().map(String).join(" ")).not.toContain(
      "secret",
    );
  });

  it("keeps what was delivered when the model fails halfway, as a failed attempt", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      throw new RewriteError("upstream_error", 502);
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toMatchObject({ type: "done", partial: true });
    expect(onSettled).toHaveBeenCalledTimes(1);
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("failed");
    expect(history).toHaveLength(1);
  });

  it("does not keep a refusal, even after edits", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      throw new RewriteError("refused", 422);
    });
    const { response, settled, onSettled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "refused" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  it("counts the attempt when the reader leaves before any edit, and saves nothing", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(untilAborted);
    const { settled, onSettled } = run(controller.signal);
    controller.abort();
    await settled;
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("cancelled", null);
  });

  it("counts the attempt when the abort makes the model call throw", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(async (...args: unknown[]) => {
      await untilAborted(...(args as Parameters<typeof untilAborted>));
      throw new RewriteError("upstream_error", 502);
    });
    const { settled, onSettled } = run(controller.signal);
    controller.abort();
    await settled;
    expect(onSettled).toHaveBeenCalledWith("cancelled", null);
    // A reader leaving is not an error worth logging
    expect(console.error).not.toHaveBeenCalled();
  });

  it("writes nothing and counts the attempt when the reader left before it began", async () => {
    const controller = new AbortController();
    controller.abort();
    streamEdits.mockRejectedValue(new RewriteError("upstream_error", 502));
    const { response, settled, onSettled } = run(controller.signal);
    const sent = await events(response);
    await settled;
    expect(sent).toEqual([]);
    expect(onSettled).toHaveBeenCalledWith("cancelled", null);
  });

  it("keeps the delivered edits when the reader leaves after receiving some", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      // The reader leaves, and the model call ends as the signal fires
      controller.abort();
    });
    const { settled, onSettled } = run(controller.signal);
    await settled;
    expect(onSettled).toHaveBeenCalledTimes(1);
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(history).toHaveLength(1);
  });

  // How the real SDK ends: the abort makes the call reject, after the edit was delivered
  it("keeps the delivered edits when the reader leaves and the call rejects", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      controller.abort();
      throw new RewriteError("upstream_error", 502);
    });
    const { settled, onSettled } = run(controller.signal);
    await settled;
    expect(onSettled).toHaveBeenCalledTimes(1);
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(history).toHaveLength(1);
  });

  it("does not count an edit that arrives after the reader left as delivered", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      controller.abort();
      onEdit(raw("delve into", "look at"));
    });
    const { settled, onSettled } = run(controller.signal);
    await settled;
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(history.map((e: { original: string }) => e.original)).toEqual([
      "crucial",
    ]);
  });

  // Where the platform only reports a departure by cancelling the stream
  it("ends the model call when the reader drops the stream, with no abort signal", async () => {
    let emit: (edit: ReturnType<typeof raw>) => void = () => {};
    let seen: AbortSignal | undefined;
    streamEdits.mockImplementation(
      (_t, _r, onEdit, _o, _c, signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          emit = onEdit;
          seen = signal;
          signal.addEventListener("abort", () => resolve());
        }),
    );
    const { response, settled, onSettled } = run();
    const reader = response.body!.getReader();
    await reader.read();
    emit(raw("crucial", "important"));
    await reader.cancel();
    expect(seen?.aborted).toBe(true);
    // Writing to the dropped stream must not throw into the model's stream handler
    expect(() => emit(raw("delve into", "look at"))).not.toThrow();
    await settled;
    expect(onSettled).toHaveBeenCalledTimes(1);
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(history.map((e: { original: string }) => e.original)).toEqual([
      "crucial",
    ]);
  });

  it("settles exactly once, whatever happens", async () => {
    streamEdits.mockRejectedValue(new Error("boom"));
    const { settled, onSettled } = run();
    await expect(settled).resolves.toBeUndefined();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("settles even when the bookkeeping itself fails", async () => {
    streamEdits.mockResolvedValue([]);
    const onSettled = vi.fn().mockRejectedValue(new Error("database down"));
    const { response, settled } = streamResponse({
      text: TEXT,
      references: [],
      options: {},
      signal: new AbortController().signal,
      prepMs: 0,
      onSettled,
    });
    await events(response).catch(() => []);
    await expect(settled).resolves.toBeUndefined();
  });
});
