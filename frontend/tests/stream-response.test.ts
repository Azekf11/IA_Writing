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
  const onSuccess = vi.fn().mockResolvedValue(undefined);
  const onFailure = vi.fn().mockResolvedValue(undefined);
  const { response, settled } = streamResponse({
    text: TEXT,
    references: [],
    options: {},
    signal,
    prepMs: 5,
    onSuccess,
    onFailure,
  });
  return { response, settled, onSuccess, onFailure };
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

beforeEach(() => {
  streamEdits.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("streamResponse", () => {
  it("sends start, each located edit, then done, and records the result", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      onEdit(raw("delve into", "look at"));
    });
    const { response, settled, onSuccess, onFailure } = run();
    const sent = await events(response);
    await settled;

    expect(sent.map((e) => e.type)).toEqual(["start", "edit", "edit", "done"]);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onSuccess.mock.calls[0][0]).toHaveLength(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("has the headers a stream needs", () => {
    streamEdits.mockResolvedValue([]);
    const { response } = run();
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(response.headers.get("server-timing")).toBe("prep;dur=5");
  });

  it("never sends an edit the guard rejects, and counts it", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      onEdit(raw("nowhere in the text", "x"));
    });
    const { response, settled } = run();
    const sent = await events(response);
    await settled;
    expect(sent.filter((e) => e.type === "edit")).toHaveLength(1);
    expect(sent.at(-1)).toMatchObject({ type: "done", dropped: 1 });
  });

  it("reports a failure before any edit, and gives the request back", async () => {
    streamEdits.mockRejectedValue(new RewriteError("busy", 503));
    const { response, settled, onSuccess, onFailure } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("hides the details of an unexpected error", async () => {
    streamEdits.mockRejectedValue(new Error("secret database password"));
    const { response, settled } = run();
    const sent = await events(response);
    await settled;
    expect(JSON.stringify(sent)).not.toContain("secret");
    expect(sent.at(-1)).toEqual({ type: "error", error: "server_error" });
  });

  it("keeps what was delivered when the model fails halfway", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      throw new RewriteError("upstream_error", 502);
    });
    const { response, settled, onSuccess, onFailure } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)?.type).toBe("done");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("does not keep a refusal, even after edits", async () => {
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      throw new RewriteError("refused", 422);
    });
    const { response, settled, onFailure } = run();
    const sent = await events(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "refused" });
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("gives the request back when the reader leaves before any edit", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(
      async (_t, _r, _e, _o, _c, signal: AbortSignal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve()),
        );
      },
    );
    const { response, settled, onSuccess, onFailure } = run(controller.signal);
    controller.abort();
    await settled;
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    void response;
  });

  it("counts the request when the reader leaves after receiving edits", async () => {
    const controller = new AbortController();
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(raw("crucial", "important"));
      // The reader leaves, and the model call ends as the signal fires
      controller.abort();
    });
    const { settled, onSuccess, onFailure } = run(controller.signal);
    await settled;
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("settles exactly once, whatever happens", async () => {
    streamEdits.mockRejectedValue(new Error("boom"));
    const { settled } = run();
    await expect(settled).resolves.toBeUndefined();
  });
});
