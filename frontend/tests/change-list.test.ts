import { describe, expect, it } from "vitest";
import { changeList, type ChangeListWords } from "@/lib/rewrite/change-list";
import type { Edit } from "@/lib/rewrite/types";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

const edit = (n: number, original: string, replacement: string): Edit => ({
  id: `edit-${n}`,
  original,
  replacement,
  reason: `reason ${n}`,
  start: n * 10,
  end: n * 10 + original.length,
});

const FIRST = edit(0, "crucial", "important");
const SECOND = edit(1, "act", "move");
const THIRD = edit(2, "now", "today");
const ALL = [FIRST, SECOND, THIRD];

const wordsOf = (messages: typeof en, title: string): ChangeListWords => ({
  title,
  before: messages.Review.list.before,
  after: messages.Review.list.after,
  why: messages.Review.list.why,
  removed: messages.Review.emptyReplacement,
});
const WORDS = wordsOf(en, "The list");

describe("changeList", () => {
  it("lists an accepted edit as before, after and why", () => {
    expect(changeList([FIRST], { "edit-0": "accepted" }, {}, WORDS)).toBe(
      "The list\n\n1. Before: crucial\nAfter: important\nWhy: reason 0\n",
    );
  });

  it("leaves out what is undecided or rejected", () => {
    const list = changeList(
      ALL,
      { "edit-1": "accepted", "edit-2": "rejected" },
      {},
      WORDS,
    );
    expect(list).toContain("1. Before: act");
    expect(list).not.toContain("crucial");
    expect(list).not.toContain("now");
  });

  it("goes in reading order, whatever order the edits come in", () => {
    const all = {
      "edit-0": "accepted",
      "edit-1": "accepted",
      "edit-2": "accepted",
    } as const;
    const originals = [
      ...changeList([THIRD, FIRST, SECOND], all, {}, WORDS).matchAll(
        /\d\. Before: (\w+)/g,
      ),
    ].map((match) => match[1]);
    expect(originals).toEqual(["crucial", "act", "now"]);
  });

  it("does not reorder the edits it is given", () => {
    const given = [THIRD, FIRST];
    changeList(given, { "edit-0": "accepted" }, {}, WORDS);
    expect(given).toEqual([THIRD, FIRST]);
  });

  it("uses the writer's own wording where there is one", () => {
    const list = changeList(
      [FIRST, SECOND],
      { "edit-0": "accepted", "edit-1": "accepted" },
      { "edit-0": "vital" },
      WORDS,
    );
    expect(list).toContain("After: vital");
    expect(list).not.toContain("After: important");
    expect(list).toContain("After: move");
  });

  it("ignores a wording on an edit that is not accepted", () => {
    expect(changeList([FIRST], {}, { "edit-0": "vital" }, WORDS)).not.toContain(
      "vital",
    );
  });

  it("says when an edit takes the words out", () => {
    const blank = { ...FIRST, replacement: " " };
    expect(changeList([blank], { "edit-0": "accepted" }, {}, WORDS)).toContain(
      "After: (removed)",
    );
  });

  it("is only its title when nothing is accepted", () => {
    expect(changeList(ALL, {}, {}, WORDS)).toBe("The list\n");
  });

  it("writes in the page's language", () => {
    const list = changeList(
      [FIRST],
      { "edit-0": "accepted" },
      {},
      wordsOf(fr as typeof en, "La liste"),
    );
    expect(list).toBe(
      "La liste\n\n1. Avant\u00a0: crucial\nAprès\u00a0: important\nPourquoi\u00a0: reason 0\n",
    );
  });

  // It may end up beside a statement about how a text was written, and it must not read as one
  it.each([
    ["en", en],
    ["fr", fr],
  ])(
    "calls itself a list of edits, and vouches for nothing, in %s",
    (_, messages) => {
      const { list } = messages.Review;
      expect(list.title).toMatch(
        /^(List of accepted edits|Liste des modifications acceptées)/,
      );
      const words = Object.values(list).join(" ");
      expect(words).not.toMatch(
        /proof|prove|preuve|prouve|author|auteur|certif|attest|human|humain|\bAI\b|\bIA\b/i,
      );
    },
  );
});
