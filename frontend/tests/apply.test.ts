import { describe, expect, it } from "vitest";
import { applyEdits, toSegments } from "@/lib/rewrite/apply";
import type { Edit } from "@/lib/rewrite/types";

const text = "It is crucial to act. We will delve into it.";

// Offsets come from indexOf so the fixture can't drift from the text
function makeEdit(id: string, original: string, replacement: string): Edit {
  const start = text.indexOf(original);
  return {
    id,
    original,
    replacement,
    reason: "",
    start,
    end: start + original.length,
  };
}

const edits: Edit[] = [
  makeEdit("edit-0", "crucial", "important"),
  makeEdit("edit-1", "delve into", "look at"),
];

describe("toSegments", () => {
  it("splits the text around edits and loses nothing", () => {
    const segments = toSegments(text, edits);
    expect(segments.map((s) => s.kind)).toEqual([
      "text",
      "edit",
      "text",
      "edit",
      "text",
    ]);
  });

  it("returns one text segment when there are no edits", () => {
    expect(toSegments(text, [])).toEqual([{ kind: "text", text }]);
  });

  it("handles an edit at the very start and end", () => {
    const whole: Edit = { ...edits[0], start: 0, end: text.length };
    const segments = toSegments(text, [whole]);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("edit");
  });
});

describe("applyEdits", () => {
  it("keeps the original when nothing is accepted", () => {
    expect(applyEdits(text, edits, {})).toBe(text);
    expect(applyEdits(text, edits, { "edit-0": "rejected" })).toBe(text);
  });

  it("applies only accepted edits", () => {
    const result = applyEdits(text, edits, { "edit-1": "accepted" });
    expect(result).toBe("It is crucial to act. We will look at it.");
  });

  it("applies every edit when all are accepted", () => {
    const all = { "edit-0": "accepted", "edit-1": "accepted" } as const;
    expect(applyEdits(text, edits, all)).toBe(
      "It is important to act. We will look at it.",
    );
  });

  it("supports replacements of a different length", () => {
    const short: Edit = { ...edits[0], replacement: "" };
    const result = applyEdits(text, [short], { "edit-0": "accepted" });
    expect(result).toBe("It is  to act. We will delve into it.");
  });
});
