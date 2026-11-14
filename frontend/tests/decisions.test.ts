import { describe, expect, it } from "vitest";
import {
  canUndo,
  decide,
  decideAll,
  firstChanged,
  NEW_LOG,
  pendingEdits,
  reword,
  undo,
  type ReviewState,
} from "@/lib/rewrite/decisions";
import type { Edit } from "@/lib/rewrite/types";

const edit = (n: number): Edit => ({
  id: `edit-${n}`,
  original: "o",
  replacement: "r",
  reason: "",
  start: n * 10,
  end: n * 10 + 1,
});
const edits = [edit(0), edit(1), edit(2)];
const decisions = (log: typeof NEW_LOG) => log.now.decisions;

describe("decide", () => {
  it("records the decision on that edit", () => {
    const log = decide(NEW_LOG, "edit-1", "rejected");
    expect(decisions(log)).toEqual({ "edit-1": "rejected" });
  });

  it("gives a new value and leaves the old one as it was", () => {
    const before = decide(NEW_LOG, "edit-0", "accepted");
    const copy = JSON.parse(JSON.stringify(before));
    const after = decide(before, "edit-1", "rejected");
    expect(after).not.toBe(before);
    expect(before).toEqual(copy);
    expect(NEW_LOG).toEqual({
      now: { decisions: {}, overrides: {} },
      earlier: [],
    });
  });

  it("leaves no step for a decision that changes nothing", () => {
    const log = decide(NEW_LOG, "edit-0", "accepted");
    expect(decide(log, "edit-0", "accepted")).toBe(log);
    expect(decide(NEW_LOG, "edit-0", "pending")).toBe(NEW_LOG);
  });
});

describe("decideAll", () => {
  it("leaves a rejected edit rejected when the rest is accepted", () => {
    const log = decideAll(
      decide(NEW_LOG, "edit-0", "rejected"),
      edits,
      "accepted",
    );
    expect(decisions(log)).toEqual({
      "edit-0": "rejected",
      "edit-1": "accepted",
      "edit-2": "accepted",
    });
  });

  it("leaves an accepted edit accepted when the rest is rejected", () => {
    const log = decideAll(
      decide(NEW_LOG, "edit-2", "accepted"),
      edits,
      "rejected",
    );
    expect(decisions(log)).toEqual({
      "edit-0": "rejected",
      "edit-1": "rejected",
      "edit-2": "accepted",
    });
  });

  it("reaches every edit once none is undecided", () => {
    const decided = decideAll(
      decide(NEW_LOG, "edit-0", "rejected"),
      edits,
      "accepted",
    );
    expect(decisions(decideAll(decided, edits, "accepted"))).toEqual({
      "edit-0": "accepted",
      "edit-1": "accepted",
      "edit-2": "accepted",
    });
  });

  it("counts an edit put back as undecided", () => {
    const log = decide(
      decide(NEW_LOG, "edit-0", "accepted"),
      "edit-0",
      "pending",
    );
    expect(pendingEdits(edits, decisions(log))).toEqual(edits);
    expect(decisions(decideAll(log, edits, "rejected"))["edit-0"]).toBe(
      "rejected",
    );
  });

  it("is one step, however many edits it decides", () => {
    const log = decideAll(NEW_LOG, edits, "accepted");
    expect(log.earlier).toHaveLength(1);
    expect(decisions(undo(log))).toEqual({});
  });

  it("leaves no step when it changes nothing", () => {
    const log = decideAll(NEW_LOG, edits, "accepted");
    expect(decideAll(log, edits, "accepted")).toBe(log);
  });

  it("does nothing without edits", () => {
    expect(decideAll(NEW_LOG, [], "accepted")).toBe(NEW_LOG);
  });
});

describe("reword", () => {
  const overrides = (log: typeof NEW_LOG) => log.now.overrides;

  it("accepts the edit with the writer's own wording, in one step", () => {
    const log = reword(NEW_LOG, edits[1], "mine");
    expect(decisions(log)).toEqual({ "edit-1": "accepted" });
    expect(overrides(log)).toEqual({ "edit-1": "mine" });
    expect(log.earlier).toHaveLength(1);
  });

  it("leaves the edit itself alone", () => {
    const before = { ...edits[0] };
    reword(NEW_LOG, edits[0], "mine");
    expect(edits[0]).toEqual(before);
  });

  it("goes back to the suggestion with a single undo", () => {
    const log = undo(reword(NEW_LOG, edits[0], "mine"));
    expect(decisions(log)).toEqual({});
    expect(overrides(log)).toEqual({});
  });

  it("puts an earlier wording back when a later one is undone", () => {
    const first = reword(NEW_LOG, edits[0], "first");
    expect(overrides(undo(reword(first, edits[0], "second")))).toEqual({
      "edit-0": "first",
    });
  });

  it.each(["", "   ", "\n\t"])("refuses blank wording (%j)", (blank) => {
    expect(reword(NEW_LOG, edits[0], blank)).toBe(NEW_LOG);
    const accepted = reword(NEW_LOG, edits[0], "mine");
    expect(reword(accepted, edits[0], blank)).toBe(accepted);
  });

  it("keeps no entry for the suggestion's own words, and accepts", () => {
    const log = reword(NEW_LOG, edits[0], edits[0].replacement);
    expect(decisions(log)).toEqual({ "edit-0": "accepted" });
    expect(overrides(log)).toEqual({});
  });

  it("drops a wording when the suggestion's own words are saved over it", () => {
    const mine = reword(NEW_LOG, edits[0], "mine");
    expect(overrides(reword(mine, edits[0], edits[0].replacement))).toEqual({});
  });

  it("leaves no step when nothing changes", () => {
    const mine = reword(NEW_LOG, edits[0], "mine");
    expect(reword(mine, edits[0], "mine")).toBe(mine);
    const accepted = decide(NEW_LOG, "edit-0", "accepted");
    expect(reword(accepted, edits[0], edits[0].replacement)).toBe(accepted);
  });

  it("keeps the wording as it was typed, spaces at its ends included", () => {
    const log = reword(NEW_LOG, edits[0], " in the end ");
    expect(overrides(log)["edit-0"]).toBe(" in the end ");
  });

  it("stores accents in one form, like the text it goes into", () => {
    const log = reword(NEW_LOG, edits[0], "re\u0301sume\u0301");
    expect(overrides(log)["edit-0"]).toBe("r\u00e9sum\u00e9");
  });

  it("accepts an edit that was rejected", () => {
    const log = reword(decide(NEW_LOG, "edit-0", "rejected"), edits[0], "mine");
    expect(decisions(log)["edit-0"]).toBe("accepted");
  });

  describe("taking the decision back", () => {
    const mine = reword(NEW_LOG, edits[0], "mine");

    it.each(["pending", "rejected"] as const)(
      "as %s returns to the suggestion",
      (decision) => {
        expect(overrides(decide(mine, "edit-0", decision))).toEqual({});
      },
    );

    it("is a step of its own, which brings the wording back when undone", () => {
      const back = decide(mine, "edit-0", "pending");
      expect(overrides(undo(back))).toEqual({ "edit-0": "mine" });
      expect(decisions(undo(back))).toEqual({ "edit-0": "accepted" });
    });

    it("leaves the other edits' wordings alone", () => {
      const two = reword(mine, edits[1], "also mine");
      expect(overrides(decide(two, "edit-0", "rejected"))).toEqual({
        "edit-1": "also mine",
      });
    });

    it("by the bulk button returns to the suggestions, and is undone in one step", () => {
      const all = decideAll(
        decideAll(mine, edits, "accepted"),
        edits,
        "rejected",
      );
      expect(overrides(all)).toEqual({});
      expect(overrides(undo(all))).toEqual({ "edit-0": "mine" });
    });
  });

  it("is kept by a bulk accept of the rest", () => {
    const mine = reword(NEW_LOG, edits[0], "mine");
    expect(overrides(decideAll(mine, edits, "accepted"))).toEqual({
      "edit-0": "mine",
    });
  });
});

describe("undo", () => {
  it("restores the decisions before a single decision", () => {
    const first = decide(NEW_LOG, "edit-0", "accepted");
    const second = decide(first, "edit-1", "rejected");
    expect(decisions(undo(second))).toEqual(decisions(first));
  });

  it("restores the decisions before a bulk decision, earlier ones included", () => {
    const rejected = decide(NEW_LOG, "edit-0", "rejected");
    const bulk = decideAll(rejected, edits, "accepted");
    expect(decisions(undo(bulk))).toEqual({ "edit-0": "rejected" });
  });

  it("restores what a bulk decision over finished ones replaced", () => {
    const finished = decideAll(
      decide(NEW_LOG, "edit-0", "rejected"),
      edits,
      "accepted",
    );
    const flipped = decideAll(finished, edits, "accepted");
    expect(decisions(undo(flipped))).toEqual(decisions(finished));
  });

  it("goes back one step at a time, down to the start", () => {
    const one = decide(NEW_LOG, "edit-0", "accepted");
    const two = decide(one, "edit-1", "accepted");
    const three = decide(two, "edit-0", "pending");
    expect(decisions(undo(three))).toEqual(decisions(two));
    expect(decisions(undo(undo(three)))).toEqual(decisions(one));
    expect(decisions(undo(undo(undo(three))))).toEqual({});
  });

  it("has nothing to take back at the start", () => {
    expect(canUndo(NEW_LOG)).toBe(false);
    expect(undo(NEW_LOG)).toBe(NEW_LOG);
  });

  it("knows when there is a step to take back", () => {
    const log = decide(NEW_LOG, "edit-0", "accepted");
    expect(canUndo(log)).toBe(true);
    expect(canUndo(undo(log))).toBe(false);
  });

  it("puts back all that a step holds, not only the decisions", () => {
    const extended = {
      now: { decisions: {}, overrides: {}, note: "before" },
      earlier: [],
    };
    const later = decide(extended, "edit-0", "accepted");
    expect(undo(later).now).toEqual({
      decisions: {},
      overrides: {},
      note: "before",
    });
  });
});

describe("firstChanged", () => {
  const state = (changes: Partial<ReviewState>): ReviewState => ({
    decisions: {},
    overrides: {},
    ...changes,
  });

  it("names the first edit in reading order that differs", () => {
    expect(
      firstChanged(
        edits,
        state({ decisions: { "edit-2": "accepted", "edit-1": "rejected" } }),
        state({ decisions: { "edit-2": "accepted" } }),
      ),
    ).toBe("edit-1");
  });

  it("takes an edit put back as the same as an edit never decided", () => {
    expect(
      firstChanged(
        edits,
        state({ decisions: { "edit-0": "pending" } }),
        state({}),
      ),
    ).toBeNull();
  });

  it("sees a wording that changed on an edit that stayed accepted", () => {
    const decisions = { "edit-1": "accepted" } as const;
    expect(
      firstChanged(
        edits,
        state({ decisions, overrides: { "edit-1": "first wording" } }),
        state({ decisions, overrides: { "edit-1": "second wording" } }),
      ),
    ).toBe("edit-1");
  });
});

describe("pendingEdits", () => {
  it("keeps reading order", () => {
    expect(
      pendingEdits(edits, { "edit-1": "accepted" }).map((e) => e.id),
    ).toEqual(["edit-0", "edit-2"]);
  });
});
