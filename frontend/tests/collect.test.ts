import { describe, expect, it } from "vitest";
import { EditCollector } from "@/lib/rewrite/collect";
import { MAX_EDITS } from "@/lib/rewrite/guard";

const raw = (original: string, replacement: string, reason = "r") => ({
  original,
  replacement,
  reason,
});

const TEXT =
  "It is crucial to act now. We will delve into it. Sales rose 12% last year.";

describe("EditCollector", () => {
  it("locates an edit and gives it an arrival id", () => {
    const collector = new EditCollector(TEXT);
    const edit = collector.add(raw("crucial", "important"));
    expect(edit).toMatchObject({
      id: "edit-0",
      start: 6,
      end: 13,
      original: "crucial",
    });
  });

  it("keeps ids stable, and returns the result in reading order", () => {
    const collector = new EditCollector(TEXT);
    const late = collector.add(raw("delve into", "look at"));
    const early = collector.add(raw("crucial", "important"));
    expect([late?.id, early?.id]).toEqual(["edit-0", "edit-1"]);
    expect(collector.result().map((e) => e.id)).toEqual(["edit-1", "edit-0"]);
  });

  it("drops an edit that changes a number", () => {
    const collector = new EditCollector(TEXT);
    expect(collector.add(raw("rose 12%", "rose 15%"))).toBeNull();
    expect(collector.dropped).toEqual({ numbers_changed: 1 });
  });

  it("drops a quote that is not in the text", () => {
    const collector = new EditCollector(TEXT);
    expect(collector.add(raw("not there", "x"))).toBeNull();
    expect(collector.dropped).toEqual({ not_found: 1 });
  });

  it("drops an edit that overlaps one already kept", () => {
    const collector = new EditCollector(TEXT);
    collector.add(raw("It is crucial", "This matters"));
    expect(collector.add(raw("crucial to act", "urgent"))).toBeNull();
    expect(collector.result()).toHaveLength(1);
  });

  it("does not spend an id on a dropped edit", () => {
    const collector = new EditCollector(TEXT);
    collector.add(raw("nothing here", "x"));
    expect(collector.add(raw("crucial", "important"))?.id).toBe("edit-0");
  });

  it("stops at the maximum number of edits", () => {
    const words = Array.from(
      { length: MAX_EDITS + 3 },
      (_, i) =>
        `w${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}x`,
    );
    const collector = new EditCollector(words.join(" "));
    for (const word of words) collector.add(raw(word, `new ${word}`));
    expect(collector.result()).toHaveLength(MAX_EDITS);
    expect(collector.dropped.too_many).toBe(3);
  });
});
