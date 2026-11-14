import { describe, expect, it } from "vitest";
import { countWords, foldForSearch, plainTypography } from "@/lib/text";

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

describe("plainTypography", () => {
  it("turns typography into plain characters, one for one", () => {
    expect(
      plainTypography("l\u2019\u00e9t\u00e9\u00a0: \u201cx\u201d\u2011y"),
    ).toBe('l\'\u00e9t\u00e9 : "x"-y');
  });
});

describe("foldForSearch", () => {
  it.each([
    ["\u00c0 propos", "a propos"],
    ["r\u00e9\u00e9criture", "reecriture"],
    ["Cr\u00e8me br\u00fbl\u00e9e", "creme brulee"],
    ["l\u2019\u00e9t\u00e9", "l'ete"],
    ["c\u0153ur", "coeur"],
    ["C\u0152UR", "coeur"],
    ["\u00e6ternam", "aeternam"],
    ["\u00c6TERNAM", "aeternam"],
    ["\u00e7a", "ca"],
    ["a\u00a0b\u202fc", "a b c"],
    ["e\u0301", "e"],
    // Text pasted from a PDF, and the spacing a phrase typed in the search box does not have
    ["\ufb01nal", "final"],
    ["e\ufb03cace", "efficace"],
    ["wait\u2026", "wait..."],
    ["hello\nworld", "hello world"],
    ["a  b\r\n\tc", "a b c"],
    ["soft\u00adhyphen\u200b", "softhyphen"],
    // The dashes and apostrophes a word processor puts in, and the German sharp s
    ["e\u2010mail", "e-mail"],
    ["e\u2011mail", "e-mail"],
    ["1\u20122", "1-2"],
    ["2020\u20132021", "2020-2021"],
    ["so\u2014then", "so-then"],
    ["\u2015 quote", "- quote"],
    ["Stra\u00dfe", "strasse"],
    ["STRA\u1e9eE", "strasse"],
    ["aujourd\u2019hui", "aujourd'hui"],
    ["aujourd\u02bchui", "aujourd'hui"],
  ])("folds %j to %j", (text, folded) => {
    expect(foldForSearch(text)).toBe(folded);
  });

  it("leaves plain lower-case text as it is", () => {
    expect(foldForSearch("plain words 12")).toBe("plain words 12");
  });
});
