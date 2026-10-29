import { describe, expect, it } from "vitest";
import {
  encodeEvent,
  EventReader,
  type StreamEvent,
} from "@/lib/rewrite/protocol";

const edit = {
  id: "edit-0",
  original: "a",
  replacement: "b",
  reason: "r",
  start: 0,
  end: 1,
};
const events: StreamEvent[] = [
  { type: "start", references: [{ author: "A", title: "T" }] },
  { type: "edit", edit },
  { type: "done", dropped: 2, ms: { prep: 10, model: 900 } },
];
const wire = events.map(encodeEvent).join("");

describe("EventReader", () => {
  it("decodes what encodeEvent wrote", () => {
    expect(new EventReader().push(wire)).toEqual(events);
  });

  it("gives the same events however the text is cut", () => {
    for (let size = 1; size <= 9; size++) {
      const reader = new EventReader();
      const out: StreamEvent[] = [];
      for (let i = 0; i < wire.length; i += size)
        out.push(...reader.push(wire.slice(i, i + size)));
      expect(out).toEqual(events);
    }
  });

  it("holds back a line that is not finished", () => {
    const reader = new EventReader();
    const line = encodeEvent(events[1]);
    expect(reader.push(line.slice(0, 20))).toEqual([]);
    expect(reader.push(line.slice(20))).toEqual([events[1]]);
  });

  it("ignores blank lines, noise and unknown event types", () => {
    const noise = `\n  \nnot json\n{"type":"surprise"}\n${encodeEvent(events[0])}`;
    expect(new EventReader().push(noise)).toEqual([events[0]]);
  });

  it("carries accents and line breaks inside strings", () => {
    const odd: StreamEvent = {
      type: "edit",
      edit: { ...edit, original: "caf\u00e9\nnoir" },
    };
    expect(new EventReader().push(encodeEvent(odd))).toEqual([odd]);
  });
});
