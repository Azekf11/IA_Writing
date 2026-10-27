import { describe, expect, it } from "vitest";
import { countWords } from "@/lib/text";

describe("countWords", () => {
  it("returns 0 for empty or blank text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n\t ")).toBe(0);
  });

  it("counts words split by any whitespace", () => {
    expect(countWords("hello world")).toBe(2);
    expect(countWords("  one\ntwo\t three  ")).toBe(3);
  });
});
