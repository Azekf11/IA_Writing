import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearReopen, readReopen, stashReopen } from "@/lib/rewrite/reopen";
import type { Edit } from "@/lib/rewrite/types";

const TEXT = "It is crucial to act now.";
const EDIT: Edit = {
  id: "edit-0",
  original: "crucial",
  replacement: "important",
  reason: "r",
  start: 6,
  end: 13,
};

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.useRealTimers());

describe("reopen", () => {
  it("hands back what was stashed", () => {
    stashReopen(TEXT, [EDIT]);
    expect(readReopen()).toMatchObject({ text: TEXT, edits: [EDIT] });
  });

  it("gives the same answer until it is cleared: React can render twice", () => {
    stashReopen(TEXT, [EDIT]);
    expect(readReopen()).toMatchObject({ text: TEXT });
    expect(readReopen()).toMatchObject({ text: TEXT });
    clearReopen();
    expect(readReopen()).toBeNull();
  });

  it("ignores a stash abandoned on the way to the editor", () => {
    vi.useFakeTimers();
    stashReopen(TEXT, [EDIT]);
    vi.advanceTimersByTime(60_000);
    expect(readReopen()).toMatchObject({ text: TEXT });
    vi.advanceTimersByTime(1);
    expect(readReopen()).toBeNull();
  });

  it("returns nothing when nothing was stashed", () => {
    expect(readReopen()).toBeNull();
  });

  it("refuses an edit whose offsets no longer fit the text", () => {
    stashReopen(TEXT, [{ ...EDIT, start: 7, end: 14 }]);
    expect(readReopen()).toBeNull();
  });

  // Each of the next ones quotes the text as slice() reads it, so only the check named can refuse it
  it("refuses an edit running past the end of the text", () => {
    stashReopen("short", [{ ...EDIT, original: "ort", start: 2, end: 99 }]);
    expect(readReopen()).toBeNull();
  });

  it("refuses an edit starting before the text", () => {
    stashReopen(TEXT, [{ ...EDIT, start: -19, end: 13 }]);
    expect(readReopen()).toBeNull();
  });

  it("refuses an edit that covers nothing", () => {
    stashReopen(TEXT, [{ ...EDIT, original: "", start: 6, end: 6 }]);
    expect(readReopen()).toBeNull();
  });

  it("refuses malformed data", () => {
    // Fresh, so that their age is not what refuses them
    const stamp = Date.now();
    for (const bad of [
      "not json",
      JSON.stringify({ stamp }),
      JSON.stringify({ text: 5, edits: [], stamp }),
      JSON.stringify({ text: TEXT, edits: [{ id: 1 }], stamp }),
    ]) {
      sessionStorage.setItem("rewrity:reopen", bad);
      expect(readReopen()).toBeNull();
    }
  });

  it("says whether the rewrite could be stashed", () => {
    expect(stashReopen(TEXT, [EDIT])).toBe(true);
    const blocked = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    expect(stashReopen(TEXT, [EDIT])).toBe(false);
    blocked.mockRestore();
  });

  it("accepts a rewrite without edits", () => {
    stashReopen(TEXT, []);
    expect(readReopen()).toMatchObject({ text: TEXT, edits: [] });
  });
});
