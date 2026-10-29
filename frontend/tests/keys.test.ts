import { describe, expect, it } from "vitest";
import {
  isTyping,
  moveFocus,
  nextPending,
  reviewKey,
} from "@/lib/rewrite/keys";
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
const plain = { ctrlKey: false, metaKey: false, altKey: false };

describe("reviewKey", () => {
  it("maps the four letters, in either case", () => {
    expect(reviewKey({ key: "a", ...plain })).toBe("accept");
    expect(reviewKey({ key: "R", ...plain })).toBe("reject");
    expect(reviewKey({ key: "j", ...plain })).toBe("next");
    expect(reviewKey({ key: "K", ...plain })).toBe("previous");
  });

  it("ignores other keys", () => {
    expect(reviewKey({ key: "x", ...plain })).toBeNull();
    expect(reviewKey({ key: "Enter", ...plain })).toBeNull();
  });

  it("never takes a browser shortcut", () => {
    expect(reviewKey({ key: "r", ...plain, metaKey: true })).toBeNull();
    expect(reviewKey({ key: "a", ...plain, ctrlKey: true })).toBeNull();
    expect(reviewKey({ key: "j", ...plain, altKey: true })).toBeNull();
  });
});

describe("isTyping", () => {
  it("is true in fields, false elsewhere", () => {
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("button"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});

describe("moveFocus", () => {
  it("starts at the first edit going forward and the last going back", () => {
    expect(moveFocus(edits, null, "next")).toBe("edit-0");
    expect(moveFocus(edits, null, "previous")).toBe("edit-2");
  });

  it("moves one step and stops at both ends", () => {
    expect(moveFocus(edits, "edit-0", "next")).toBe("edit-1");
    expect(moveFocus(edits, "edit-2", "next")).toBe("edit-2");
    expect(moveFocus(edits, "edit-0", "previous")).toBe("edit-0");
  });

  it("does nothing without edits", () => {
    expect(moveFocus([], null, "next")).toBeNull();
  });
});

describe("nextPending", () => {
  it("jumps to the next edit with no decision yet", () => {
    expect(nextPending(edits, { "edit-0": "accepted" }, "edit-0")).toBe(
      "edit-1",
    );
  });

  it("skips edits already decided and wraps around", () => {
    const decided = { "edit-1": "rejected", "edit-2": "accepted" } as const;
    expect(
      nextPending(edits, { ...decided, "edit-0": "accepted" }, "edit-2"),
    ).toBe("edit-2");
    expect(nextPending(edits, decided, "edit-2")).toBe("edit-0");
  });

  it("stays where it is when everything is decided", () => {
    const all = {
      "edit-0": "accepted",
      "edit-1": "accepted",
      "edit-2": "rejected",
    } as const;
    expect(nextPending(edits, all, "edit-1")).toBe("edit-1");
  });
});
