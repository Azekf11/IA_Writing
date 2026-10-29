import { beforeEach, describe, expect, it } from "vitest";
import { stashReopen, takeReopen } from "@/lib/rewrite/reopen";
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

describe("reopen", () => {
  it("hands back what was stashed", () => {
    stashReopen(TEXT, [EDIT]);
    expect(takeReopen()).toMatchObject({ text: TEXT, edits: [EDIT] });
  });

  it("gives it out once", () => {
    stashReopen(TEXT, [EDIT]);
    takeReopen();
    expect(takeReopen()).toBeNull();
  });

  it("returns nothing when nothing was stashed", () => {
    expect(takeReopen()).toBeNull();
  });

  it("refuses an edit whose offsets no longer fit the text", () => {
    stashReopen(TEXT, [{ ...EDIT, start: 7, end: 14 }]);
    expect(takeReopen()).toBeNull();
  });

  it("refuses an edit running past the end of the text", () => {
    stashReopen("short", [{ ...EDIT, start: 2, end: 99 }]);
    expect(takeReopen()).toBeNull();
  });

  it("refuses malformed data", () => {
    for (const bad of [
      "not json",
      "{}",
      JSON.stringify({ text: 5, edits: [] }),
      JSON.stringify({ text: TEXT, edits: [{ id: 1 }] }),
    ]) {
      sessionStorage.setItem("rewrity:reopen", bad);
      expect(takeReopen()).toBeNull();
    }
  });

  it("accepts a rewrite without edits", () => {
    stashReopen(TEXT, []);
    expect(takeReopen()).toMatchObject({ text: TEXT, edits: [] });
  });
});
