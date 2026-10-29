import { describe, expect, it } from "vitest";
import { EditStreamParser } from "@/lib/rewrite/edit-stream";

const edit = (original: string, replacement = "x", reason = "r") => ({
  original,
  replacement,
  reason,
});

// Feed the parser a text in fixed-size pieces, like a network would
function parse(text: string, size: number) {
  const parser = new EditStreamParser();
  const out = [];
  for (let i = 0; i < text.length; i += size) {
    out.push(...parser.push(text.slice(i, i + size)));
  }
  return { out, skipped: parser.skipped };
}

describe("EditStreamParser", () => {
  const edits = [edit("one"), edit("two", "2", "because")];
  const text = JSON.stringify({ edits });

  it("returns every edit of a whole answer", () => {
    expect(parse(text, text.length).out).toEqual(edits);
  });

  it("gives the same edits however the answer is cut into pieces", () => {
    for (let size = 1; size <= 12; size++) {
      expect(parse(text, size).out).toEqual(edits);
    }
  });

  it("hands an edit over as soon as it is complete, not before", () => {
    const parser = new EditStreamParser();
    const cut = text.indexOf('"two"');
    expect(parser.push(text.slice(0, cut))).toEqual([edits[0]]);
    expect(parser.push(text.slice(cut))).toEqual([edits[1]]);
  });

  it("does not mistake braces and brackets inside strings for structure", () => {
    const tricky = [edit('say "hi" {now} [then]', 'a \\ "quote" }', "why } ]")];
    const json = JSON.stringify({ edits: tricky });
    for (const size of [1, 3, 7]) expect(parse(json, size).out).toEqual(tricky);
  });

  it("handles accents, emoji and escaped newlines", () => {
    const odd = [edit("caf\u00e9 \u2615\nligne", "x", "accentu\u00e9")];
    const json = JSON.stringify({ edits: odd });
    expect(parse(json, 2).out).toEqual(odd);
  });

  it("returns nothing for an empty list", () => {
    expect(parse('{"edits":[]}', 1).out).toEqual([]);
  });

  it("skips a piece that is not a valid edit and keeps going", () => {
    const json =
      '{"edits":[{"original":"a"},{"original":"b","replacement":"c","reason":"d"}]}';
    const { out, skipped } = parse(json, 5);
    expect(out).toEqual([edit("b", "c", "d")]);
    expect(skipped).toBe(1);
  });

  it("keeps the complete edits when the answer is cut off", () => {
    const cut = text.slice(0, text.indexOf('"two"') + 12);
    expect(parse(cut, 4).out).toEqual([edits[0]]);
  });

  it("ignores whitespace and pretty printing", () => {
    const pretty = JSON.stringify({ edits }, null, 2);
    expect(parse(pretty, 3).out).toEqual(edits);
  });
});
