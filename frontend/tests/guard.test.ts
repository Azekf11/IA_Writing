import { describe, expect, it } from "vitest";
import { guardEdits, MAX_EDITS, whyDrop } from "@/lib/rewrite/guard";

const edit = (original: string, replacement: string) => ({
  original,
  replacement,
  reason: "r",
});

describe("whyDrop", () => {
  it("keeps an ordinary rewording", () => {
    expect(whyDrop(edit("It is crucial to act", "We must act"))).toBeNull();
  });

  it("drops an edit that changes nothing, even in case or spacing", () => {
    expect(whyDrop(edit("Hello  World", "hello world"))).toBe("unchanged");
  });

  it("drops a replacement far longer than the original", () => {
    const long = "word ".repeat(200);
    expect(whyDrop(edit("short phrase", long))).toBe("too_long");
  });

  it("drops a huge quoted span", () => {
    expect(whyDrop(edit("a".repeat(700), "b"))).toBe("span_too_long");
  });

  it("drops html or markdown that Claude was not asked to write", () => {
    expect(whyDrop(edit("plain", "<b>plain</b>"))).toBe("markup");
    expect(whyDrop(edit("link", "[link](http://x.test)"))).toBe("markup");
    expect(whyDrop(edit("title", "# title"))).toBe("markup");
  });

  it("drops an edit that changes a number", () => {
    expect(
      whyDrop(edit("sales rose 12% in 2019", "sales rose 15% in 2019")),
    ).toBe("numbers_changed");
  });

  it("drops an edit that deletes or adds a number", () => {
    expect(whyDrop(edit("about 40 people", "many people"))).toBe(
      "numbers_changed",
    );
    expect(whyDrop(edit("many people", "about 40 people"))).toBe(
      "numbers_changed",
    );
  });

  it("accepts the same number written with different separators", () => {
    expect(
      whyDrop(edit("cost 1,200 dollars", "cost 1 200 dollars in total")),
    ).toBeNull();
  });

  it("accepts numbers that only move within the sentence", () => {
    expect(
      whyDrop(edit("In 2019 we sold 40 units", "We sold 40 units in 2019")),
    ).toBeNull();
  });
});

describe("guardEdits", () => {
  it("splits kept edits from dropped ones and counts the reasons", () => {
    const { kept, dropped } = guardEdits([
      edit("a b", "c d"),
      edit("same", "same"),
      edit("x 1", "x 2"),
      edit("y 3", "y 4"),
    ]);
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual({ unchanged: 1, numbers_changed: 2 });
  });

  it("caps the number of edits", () => {
    // Letters only, so no edit is dropped for its numbers
    const word = (i: number) =>
      String.fromCharCode(97 + (i % 26)).repeat(3 + Math.floor(i / 26));
    const many = Array.from({ length: MAX_EDITS + 5 }, (_, i) =>
      edit(`old ${word(i)}`, `new ${word(i)}`),
    );
    const { kept, dropped } = guardEdits(many);
    expect(kept).toHaveLength(MAX_EDITS);
    expect(dropped.too_many).toBe(5);
  });
});
