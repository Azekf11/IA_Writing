import { describe, expect, it } from "vitest";
import { RewriteRequestSchema } from "@/lib/rewrite/schema";

const accepted = (body: object) => RewriteRequestSchema.safeParse(body).success;

describe("RewriteRequestSchema", () => {
  // JSON can carry half of an emoji as an escape, and the API can answer a 400 to it
  describe("half of a character", () => {
    const BROKEN = [
      ["a first half", "before \ud83d after"],
      ["a second half", "before \ude00 after"],
      ["a first half at the very end", "cut off here \ud83d"],
      ["a second half at the very start", "\ude00 and on"],
      ["two halves in the wrong order", "\ude00\ud83d"],
    ];

    it.each(BROKEN)("refuses %s in the text", (_, text) => {
      expect(accepted({ text })).toBe(false);
    });

    it.each(BROKEN)("refuses %s in the writing sample", (_, voice) => {
      expect(accepted({ text: "Fine", voice })).toBe(false);
    });

    it.each([
      ["whole emojis", "Well done 😀 🎉"],
      ["a family emoji, in many parts", "👩‍👩‍👧‍👦"],
      ["French punctuation and accents", "Déjà vu : « très bien »"],
      ["a character outside the common plane", "𝒳 and 𠀋"],
    ])("takes %s", (_, text) => {
      expect(accepted({ text, voice: text })).toBe(true);
    });
  });

  describe("keep", () => {
    const keep = (body: object) => {
      const parsed = RewriteRequestSchema.safeParse({ text: "Fine", ...body });
      return parsed.success ? parsed.data.keep : "refused";
    };

    it("is on when the request does not say", () => {
      expect(keep({})).toBe(true);
    });

    it("takes either value", () => {
      expect(keep({ keep: false })).toBe(false);
      expect(keep({ keep: true })).toBe(true);
    });

    it.each([["false"], [0], [null], [{}]])("refuses %j", (value) => {
      expect(keep({ keep: value })).toBe("refused");
    });
  });
});
