import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchEdits, RewriteRequestError } from "@/lib/rewrite/client";
import {
  encodeEvent,
  STREAM_TYPE,
  type StreamEvent,
} from "@/lib/rewrite/protocol";

const edit = (n: number) => ({
  id: `edit-${n}`,
  original: `o${n}`,
  replacement: `r${n}`,
  reason: "r",
  start: n * 10,
  end: n * 10 + 2,
});

// A network answer that arrives in the given pieces
function streamOf(pieces: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "Content-Type": STREAM_TYPE },
  });
}

const wire = (events: StreamEvent[]) => events.map(encodeEvent);
const done: StreamEvent = {
  type: "done",
  dropped: 0,
  ms: { prep: 1, model: 2 },
};
const input = { text: "hello", locale: "en" };

const stub = (response: Response) =>
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

afterEach(() => vi.unstubAllGlobals());

describe("fetchEdits", () => {
  it("asks for a streamed answer and sends the settings", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        streamOf(wire([{ type: "start", references: [] }, done])),
      );
    vi.stubGlobal("fetch", fetchMock);
    await fetchEdits({ ...input, strength: "light", voice: "my voice" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      text: "hello",
      locale: "en",
      strength: "light",
      voice: "my voice",
      stream: true,
    });
  });

  it("reports each edit as it arrives, then returns them all", async () => {
    const events: StreamEvent[] = [
      { type: "start", references: [{ author: "A", title: "T" }] },
      { type: "edit", edit: edit(0) },
      { type: "edit", edit: edit(1) },
      done,
    ];
    stub(streamOf(wire(events)));
    const seen: string[] = [];
    const result = await fetchEdits(input, {
      onStart: (refs) => seen.push(`start:${refs.length}`),
      onEdit: (e) => seen.push(e.id),
    });
    expect(seen).toEqual(["start:1", "edit-0", "edit-1"]);
    expect(result.edits.map((e) => e.id)).toEqual(["edit-0", "edit-1"]);
    expect(result.references).toEqual([{ author: "A", title: "T" }]);
  });

  it("copes with an event split across network pieces", async () => {
    const text = wire([
      { type: "start", references: [] },
      { type: "edit", edit: edit(0) },
      done,
    ]).join("");
    const pieces = text.match(/[\s\S]{1,7}/g) ?? [];
    stub(streamOf(pieces));
    expect((await fetchEdits(input)).edits).toHaveLength(1);
  });

  it("returns edits in reading order even if they arrived out of order", async () => {
    stub(
      streamOf(
        wire([
          { type: "start", references: [] },
          { type: "edit", edit: edit(5) },
          { type: "edit", edit: edit(1) },
          done,
        ]),
      ),
    );
    expect((await fetchEdits(input)).edits.map((e) => e.id)).toEqual([
      "edit-1",
      "edit-5",
    ]);
  });

  it("turns an error event in the middle of the answer into an error code", async () => {
    stub(
      streamOf(
        wire([
          { type: "start", references: [] },
          { type: "edit", edit: edit(0) },
          { type: "error", error: "busy" },
        ]),
      ),
    );
    await expect(fetchEdits(input)).rejects.toMatchObject({ code: "busy" });
  });

  it("reports a network error when the stream ends without a done event", async () => {
    stub(
      streamOf(
        wire([
          { type: "start", references: [] },
          { type: "edit", edit: edit(0) },
        ]),
      ),
    );
    await expect(fetchEdits(input)).rejects.toMatchObject({ code: "network" });
  });

  it("reads a refusal that comes back as plain JSON", async () => {
    stub(
      new Response(JSON.stringify({ error: "quota_exceeded" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(fetchEdits(input)).rejects.toMatchObject({
      code: "quota_exceeded",
    });
  });

  it("still reads a classic JSON answer", async () => {
    stub(
      new Response(JSON.stringify({ edits: [edit(0)], references: [] }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect((await fetchEdits(input)).edits).toHaveLength(1);
  });

  it("falls back to a generic code for an unreadable error", async () => {
    stub(new Response("<html>", { status: 502 }));
    await expect(fetchEdits(input)).rejects.toMatchObject({
      code: "upstream_error",
    });
  });

  it("reports a network error when the request cannot be made", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(fetchEdits(input)).rejects.toBeInstanceOf(RewriteRequestError);
  });

  it("lets a cancellation through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("stop", "AbortError")),
    );
    await expect(fetchEdits(input)).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});
