import { describe, expect, it } from "vitest";
import { locateEdits } from "@/lib/rewrite/locate";

const edit = (original: string, replacement = "X") => ({
  original,
  replacement,
  reason: "r",
});

describe("locateEdits", () => {
  it("computes offsets from the quote", () => {
    const text = "Hello brave new world";
    const [result] = locateEdits(text, [edit("brave new")]);
    expect(result.start).toBe(6);
    expect(result.end).toBe(15);
    expect(text.slice(result.start, result.end)).toBe("brave new");
  });

  it("drops quotes that are not in the text", () => {
    expect(locateEdits("Hello world", [edit("goodbye")])).toEqual([]);
  });

  it("drops no-op and empty edits", () => {
    const result = locateEdits("Hello world", [
      edit("Hello", "Hello"),
      edit("", "x"),
    ]);
    expect(result).toEqual([]);
  });

  it("uses the next free occurrence for repeated quotes", () => {
    const result = locateEdits("go go go", [edit("go"), edit("go")]);
    expect(result.map((e) => e.start)).toEqual([0, 3]);
  });

  it("drops edits that overlap an earlier one", () => {
    const result = locateEdits("one two three", [
      edit("one two"),
      edit("two three"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].original).toBe("one two");
  });

  it("sorts by position and assigns stable ids", () => {
    const result = locateEdits("alpha beta gamma", [
      edit("gamma"),
      edit("alpha"),
    ]);
    expect(result.map((e) => [e.id, e.original])).toEqual([
      ["edit-0", "alpha"],
      ["edit-1", "gamma"],
    ]);
  });

  it("handles accents and multi-byte characters", () => {
    const text = "Café ☕ au lait";
    const [result] = locateEdits(text, [edit("au lait")]);
    expect(text.slice(result.start, result.end)).toBe("au lait");
  });

  it("finds a quote the model retyped with straight quotes", () => {
    const text = "She said “it’s fine” and left.";
    const [result] = locateEdits(text, [edit('said "it\'s fine"')]);
    expect(text.slice(result.start, result.end)).toBe("said “it’s fine”");
    // The edit now carries the exact original text, so the diff lines up
    expect(result.original).toBe("said “it’s fine”");
  });

  it("finds a quote whose line break was replaced by a space", () => {
    const text = "first line\nsecond line continues here";
    const [result] = locateEdits(text, [edit("line second line")]);
    expect(text.slice(result.start, result.end)).toBe("line\nsecond line");
  });

  it("finds a quote the model typed with a plain space", () => {
    const text = "Le prix : 5 euros";
    const [result] = locateEdits(text, [edit("prix : 5 euros")]);
    expect(text.slice(result.start, result.end)).toBe("prix : 5 euros");
  });

  it("still drops a quote that is really absent", () => {
    expect(locateEdits("Hello world", [edit("goodbye moon")])).toEqual([]);
  });
});
