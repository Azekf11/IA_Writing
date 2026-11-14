import { describe, expect, it } from "vitest";
import { wordDiff, type Run } from "@/lib/rewrite/word-diff";

const side = (runs: Run[], leaveOut: Run["kind"]) =>
  runs
    .filter((run) => run.kind !== leaveOut)
    .map((run) => run.text)
    .join("");

const changed = (runs: Run[] | null, kind: Run["kind"]) =>
  runs?.filter((run) => run.kind === kind).map((run) => run.text);

const PAIRS = [
  ["It is crucial to act now.", "It is important to act now."],
  ["It is crucial to act now.", "It is crucial to act."],
  ["We will act.", "We will act today, and fast."],
  ["In short, the plan works well here.", "Overall, the plan works here."],
  ["a  b\tc\n\nd", "a b c d"],
  [
    "Il est crucial d'agir, et l'homme le sait.",
    "Il faut agir, et l'homme le sait.",
  ],
  ["L’équipe a livré 12,5 % de plus.", "L’équipe a livré 12,5 % en plus."],
  ["Un texte réécrit à l'été.", "Un texte retravaillé à l'été."],
  ["C'est-à-dire qu'il viendra.", "Autrement dit qu'il viendra."],
  ["Le coût : 1 000 €, soit 3,5 %.", "Le coût est de 1 000 €, soit 3,5 %."],
  ["It works — truly, it does.", "It works, truly, it does."],
  ["Emoji 🎉 stay whole 🎉.", "Emoji 🎉 stay whole."],
  ["Keep this word ", "Keep this term "],
  ["Keep this word\n\n", "Keep this term\n\n"],
  ["  Keep this word", "  Keep this term"],
  ["", "Something new"],
  ["Something old", ""],
];

describe("wordDiff", () => {
  it.each(PAIRS)("rebuilds both sides of %j and %j", (before, after) => {
    const runs = wordDiff(before, after);
    if (!runs) return;
    expect(side(runs, "added")).toBe(before);
    expect(side(runs, "removed")).toBe(after);
  });

  it("marks only the word that changed", () => {
    const runs = wordDiff(
      "It is crucial to act now.",
      "It is important to act now.",
    );
    expect(runs).toEqual([
      { kind: "same", text: "It is " },
      { kind: "removed", text: "crucial" },
      { kind: "added", text: "important" },
      { kind: "same", text: " to act now." },
    ]);
  });

  it("works on a French sentence", () => {
    const runs = wordDiff(
      "Nous devons, à l'évidence, agir vite.",
      "Nous devons, sans doute, agir vite.",
    );
    expect(changed(runs, "removed")).toEqual(["à l'évidence"]);
    expect(changed(runs, "added")).toEqual(["sans doute"]);
  });

  // Each pair shares the start of the word or number, which is not to be left out of the mark
  describe("keeps whole", () => {
    it.each([
      ["l'homme", "Voici l'homme du jour.", "Voici l'enfant du jour."],
      ["qu’il", "Je crois qu’il vient ici.", "Je crois qu’elle vient ici."],
      ["d'abord", "Il part d'abord pour Lyon.", "Il part d'emblée pour Lyon."],
      [
        "well-known",
        "A well-known writer of plays.",
        "A well-liked writer of plays.",
      ],
      [
        "12,5 %",
        "La hausse de 12,5 % se confirme.",
        "La hausse de 12,7 % se confirme.",
      ],
      [
        "12,5\u00a0%",
        "La hausse de 12,5\u00a0% se confirme.",
        "La hausse de 12,7\u00a0% se confirme.",
      ],
      [
        "1 000",
        "Environ 1 000 personnes sont venues.",
        "Environ 1 500 personnes sont venues.",
      ],
      [
        "1\u202f000",
        "Environ 1\u202f000 personnes sont venues.",
        "Environ 1\u202f500 personnes sont venues.",
      ],
      [
        "1,000.5",
        "A total of 1,000.5 units was sold.",
        "A total of 1,000.7 units was sold.",
      ],
      [
        "3.14",
        "The value 3.14 is close enough.",
        "The value 3.15 is close enough.",
      ],
      ["12:30", "We meet at 12:30 on Monday.", "We meet at 12:45 on Monday."],
      [
        "2nd",
        "The 2nd edition is better here.",
        "The 3rd edition is better here.",
      ],
    ])("%s", (whole, before, after) => {
      expect(changed(wordDiff(before, after), "removed")).toEqual([whole]);
    });
  });

  it("joins two changed words over the space between them", () => {
    const runs = wordDiff(
      "It is very important to act now.",
      "It is quite vital to act now.",
    );
    expect(changed(runs, "removed")).toEqual(["very important"]);
    expect(changed(runs, "added")).toEqual(["quite vital"]);
  });

  it("keeps a space that does not lie between two changes", () => {
    const runs = wordDiff("Act now today.", "Act now.");
    expect(runs).toEqual([
      { kind: "same", text: "Act now" },
      { kind: "removed", text: " today" },
      { kind: "same", text: "." },
    ]);
  });

  it("reports an insertion with nothing removed, and the other way round", () => {
    const grown = wordDiff("We act.", "We act fast.");
    expect(changed(grown, "removed")).toEqual([]);
    expect(changed(grown, "added")).toEqual([" fast"]);
    const shrunk = wordDiff("We act fast.", "We act.");
    expect(changed(shrunk, "removed")).toEqual([" fast"]);
    expect(changed(shrunk, "added")).toEqual([]);
  });

  it("takes a change of case as a change", () => {
    expect(
      changed(
        wordDiff("We act Fast and well.", "We act fast and well."),
        "added",
      ),
    ).toEqual(["fast"]);
  });

  it("is one plain run when nothing differs", () => {
    expect(wordDiff("Same words here.", "Same words here.")).toEqual([
      { kind: "same", text: "Same words here." },
    ]);
  });

  describe("gives up, so that the lines are shown whole,", () => {
    it.each([
      ["when nothing is shared", "crucial", "important"],
      ["when only spaces are shared", "very good", "quite nice"],
      ["when only punctuation is shared", "Yes, indeed.", "No, never."],
      [
        "when little is shared",
        "In today's fast-paced world, effective communication plays a pivotal role",
        "Good communication helps a lot",
      ],
      ["when one side is empty", "Something", ""],
      ["when both sides are empty", "", ""],
      ["with no word on either side", "—", "–"],
    ])("%s", (_, before, after) => {
      expect(wordDiff(before, after)).toBeNull();
    });

    // Nearly all of it is shared, so that only its size rules it out, and the ends differ, so that
    // no part of it is set aside before the comparison
    it("when a wording is too long to compare", () => {
      const words = Array.from({ length: 800 }, (_, i) => `w${i}`).join(" ");
      expect(wordDiff(`first ${words} last`, `start ${words} end`)).toBeNull();
    });
  });

  describe("with the longest edit the guard lets through", () => {
    // 600 characters against 1,800, every token different or every other one shared
    const shortTokens = (length: number, letter: string) =>
      Array.from({ length }, (_, i) => (i % 2 ? " " : letter)).join("");

    it.each([
      ["sharing every space", shortTokens(600, "a"), shortTokens(1800, "b")],
      ["sharing everything", shortTokens(600, "a"), shortTokens(1800, "a")],
    ])("is quick, %s", (_, before, after) => {
      const started = performance.now();
      wordDiff(before, after);
      expect(performance.now() - started).toBeLessThan(500);
    });

    it("still compares them, with no common start or end to set aside", () => {
      const before = Array.from({ length: 300 }, () => "a").join(" ");
      const after = Array.from({ length: 900 }, (_, i) =>
        i % 3 === 1 ? "a" : "b",
      ).join(" ");
      expect(before.length).toBeLessThanOrEqual(600);
      expect(after.length).toBeLessThanOrEqual(1800);
      const runs = wordDiff(before, after)!;
      expect(side(runs, "added")).toBe(before);
      expect(side(runs, "removed")).toBe(after);
    });
  });

  it("rebuilds both sides whatever the words are", () => {
    const words = [
      "l'homme",
      "12,5 %",
      "1 000",
      "très",
      "bien",
      "well-known",
      "a",
      " ",
      "  ",
      ",",
      ".",
      "—",
      "\n",
      " ",
      "🎉",
      "é",
    ];
    let seed = 12345;
    let compared = 0;
    const random = (limit: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % limit;
    };
    const tokens = () =>
      Array.from({ length: 1 + random(30) }, () => words[random(words.length)]);
    for (let round = 0; round < 1000; round++) {
      const glue = random(2) ? " " : "";
      const first = tokens();
      // One in four words changes, or the two sides would rarely have enough in common
      const second = first.map((word) =>
        random(4) ? word : words[random(words.length)],
      );
      const [before, after] = [first.join(glue), second.join(glue)];
      const runs = wordDiff(before, after);
      compared += runs ? 1 : 0;
      if (!runs) continue;
      expect(side(runs, "added")).toBe(before);
      expect(side(runs, "removed")).toBe(after);
    }
    expect(compared).toBeGreaterThan(300);
  });
});
