import { describe, expect, it } from "vitest";
import { applyEdits, toSegments } from "@/lib/rewrite/apply";
import { decide, NEW_LOG, reword, undo } from "@/lib/rewrite/decisions";
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

describe("applyEdits with the writer's own wording", () => {
  const wording = { "edit-0": "vital" };
  const accepted = { "edit-0": "accepted" } as const;

  it("puts it in the place of the suggestion", () => {
    expect(applyEdits(text, edits, accepted, wording)).toBe(
      "It is vital to act. We will delve into it.",
    );
  });

  it("applies it only to an accepted edit", () => {
    expect(applyEdits(text, edits, {}, wording)).toBe(text);
    expect(applyEdits(text, edits, { "edit-0": "rejected" }, wording)).toBe(
      text,
    );
  });

  it("leaves the suggestion of every other edit", () => {
    const all = { "edit-0": "accepted", "edit-1": "accepted" } as const;
    expect(applyEdits(text, edits, all, wording)).toBe(
      "It is vital to act. We will look at it.",
    );
  });

  it("takes a wording of another length", () => {
    expect(
      applyEdits(text, edits, accepted, {
        "edit-0": "of the very greatest importance",
      }),
    ).toBe(
      "It is of the very greatest importance to act. We will delve into it.",
    );
  });

  it("leaves the edits as the model wrote them", () => {
    const before = structuredClone(edits);
    applyEdits(text, edits, accepted, wording);
    expect(edits).toEqual(before);
  });

  it("goes back to the suggestion when the wording is undone", () => {
    const first = decide(NEW_LOG, "edit-0", "accepted");
    const written = reword(first, edits[0], "vital");
    const { decisions, overrides } = undo(written).now;
    expect(applyEdits(text, edits, decisions, overrides)).toBe(
      "It is important to act. We will delve into it.",
    );
  });

  // A suggested removal takes a blank on one side with its words, which the card does not show
  describe("in place of a suggested removal", () => {
    const removal = (on: string, original: string): Edit => {
      const start = on.indexOf(original);
      return {
        id: "edit-0",
        original,
        replacement: "",
        reason: "",
        start,
        end: start + original.length,
      };
    };
    const NEWS = "It is very good news.";
    const VERY = removal(NEWS, "very ");

    it("puts back the blank the removal took after its words", () => {
      expect(applyEdits(NEWS, [VERY], accepted, { "edit-0": "quite" })).toBe(
        "It is quite good news.",
      );
    });

    it("puts back the blank the removal took before its words", () => {
      const agreed = "We agreed on that really, indeed.";
      expect(
        applyEdits(agreed, [removal(agreed, " really")], accepted, {
          "edit-0": "fully",
        }),
      ).toBe("We agreed on that fully, indeed.");
    });

    it("puts back a paragraph break taken with a sentence", () => {
      const paragraphs = "One para.\n\nA sentence alone.\n\nAnother para.";
      expect(
        applyEdits(
          paragraphs,
          [removal(paragraphs, "A sentence alone.\n\n")],
          accepted,
          { "edit-0": "My own sentence." },
        ),
      ).toBe("One para.\n\nMy own sentence.\n\nAnother para.");
    });

    it("does not double a blank the wording already has on that side", () => {
      expect(applyEdits(NEWS, [VERY], accepted, { "edit-0": "quite " })).toBe(
        "It is quite good news.",
      );
    });

    it("keeps a blank typed on the side the removal took none from", () => {
      expect(applyEdits(NEWS, [VERY], accepted, { "edit-0": " quite" })).toBe(
        "It is  quite good news.",
      );
    });

    it("still takes the words and the blank out with no wording", () => {
      expect(applyEdits(NEWS, [VERY], accepted)).toBe("It is good news.");
    });
  });
});
