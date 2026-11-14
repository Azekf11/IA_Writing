// @vitest-environment node
import { describe, expect, it } from "vitest";
import { applyEdits, type Decision } from "@/lib/rewrite/apply";
import { whyDrop } from "@/lib/rewrite/guard";
import { locateEdits } from "@/lib/rewrite/locate";
import { sampleEdits } from "@/lib/rewrite/sample";
import type { Edit } from "@/lib/rewrite/types";
import en from "../messages/en.json";
import fr from "../messages/fr.json";

const LOCALES = [
  {
    locale: "en",
    messages: en,
    accepted:
      "Effective communication helps people connect. Listening is a skill you keep working on. These principles help us do our best work.",
    onlyFirst:
      "Effective communication plays a pivotal role in fostering meaningful connections. Moreover, it is important to note that listening is not just a skill, but a journey. In conclusion, by embracing these principles, we can unlock our full potential.",
  },
  {
    locale: "fr",
    messages: fr,
    accepted:
      "La communication efficace aide les gens à se rapprocher. L'écoute est une compétence qui se travaille. Ces principes nous aident à donner le meilleur de nous-mêmes.",
    onlyFirst:
      "La communication efficace joue un rôle essentiel dans la création de liens significatifs. De plus, il est important de noter que l'écoute n'est pas seulement une compétence, mais un voyage. En conclusion, en adoptant ces principes, nous pouvons libérer tout notre potentiel.",
  },
];

const decided = (edits: Edit[], ids: string[]) =>
  Object.fromEntries(
    edits.map((edit): [string, Decision] => [
      edit.id,
      ids.includes(edit.id) ? "accepted" : "pending",
    ]),
  );

describe("the example", () => {
  describe.each(LOCALES)("in $locale", ({ messages, accepted, onlyFirst }) => {
    const text = messages.Editor.exampleText;
    const written = messages.Editor.exampleEdits;
    const edits = sampleEdits(text, written);

    it("places every edit that was written", () => {
      expect(edits).toHaveLength(written.length);
      expect(written.length).toBeGreaterThanOrEqual(5);
      for (const edit of edits) {
        expect(text.slice(edit.start, edit.end)).toBe(edit.original);
      }
    });

    it("finds each quote where the real locate code finds it", () => {
      const located = locateEdits(text, written);
      expect(located).toHaveLength(written.length);
      expect(located.map(({ start, end }) => [start, end])).toEqual(
        edits.map(({ start, end }) => [start, end]),
      );
      expect(located.map((edit) => edit.replacement)).toEqual(
        edits.map((edit) => edit.replacement),
      );
    });

    it("passes the real guard, edit by edit", () => {
      expect(written.map(whyDrop)).toEqual(written.map(() => null));
    });

    it("is in reading order, without an overlap", () => {
      edits.forEach((edit, index) => {
        expect(edit.id).toBe(`edit-${index}`);
        if (index)
          expect(edit.start).toBeGreaterThanOrEqual(edits[index - 1].end);
      });
    });

    it("reads right with every edit accepted", () => {
      expect(
        applyEdits(
          text,
          edits,
          decided(
            edits,
            edits.map((edit) => edit.id),
          ),
        ),
      ).toBe(accepted);
    });

    it("reads right with only the first accepted", () => {
      expect(applyEdits(text, edits, decided(edits, ["edit-0"]))).toBe(
        onlyFirst,
      );
    });

    it("gives a reason for each edit", () => {
      for (const edit of written) expect(edit.reason.trim()).not.toBe("");
    });
  });

  it("leaves out a quote the text does not hold, instead of trusting it", () => {
    const text = "It is crucial to act now.";
    const edits = sampleEdits(text, [
      { original: "not there", replacement: "x", reason: "r" },
      { original: "crucial", replacement: "important", reason: "r" },
    ]);
    expect(edits).toEqual([
      {
        id: "edit-0",
        original: "crucial",
        replacement: "important",
        reason: "r",
        start: 6,
        end: 13,
      },
    ]);
  });

  it("orders edits by where they are, whatever the order they were written in", () => {
    const text = "One two three";
    const edits = sampleEdits(text, [
      { original: "three", replacement: "3", reason: "r" },
      { original: "One", replacement: "1", reason: "r" },
    ]);
    expect(edits.map((edit) => edit.original)).toEqual(["One", "three"]);
    expect(edits.map((edit) => edit.id)).toEqual(["edit-0", "edit-1"]);
  });
});
