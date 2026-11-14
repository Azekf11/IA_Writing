// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { scanText } from "@/lib/check/scan";

// The real lists happen to have no phrase that starts another, and one could be added at any time
vi.mock("@/lib/check/rules-en", () => ({
  RULES_EN: {
    openers: [],
    closers: [],
    wrappers: [],
    greetings: [],
    filler: [
      ["in order", "tidily"],
      ["in order to", "to"],
    ],
    inflated: [],
  },
}));

describe("a phrase that starts another", () => {
  it("gives way to the longer one", () => {
    const { edits } = scanText("We met in order to talk.", "en");
    expect(edits.map((edit) => edit.original)).toEqual(["in order to"]);
    expect(edits[0].replacement).toBe("to");
  });

  it("still counts where the longer one cannot be", () => {
    const { edits } = scanText("We sat in order, then left.", "en");
    expect(edits.map((edit) => edit.original)).toEqual(["in order"]);
  });
});
