// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { flipsNegation } from "@/lib/rewrite/negation";
import { figuresIn } from "@/lib/rewrite/numbers";
import { RewriteRequestSchema } from "@/lib/rewrite/schema";

// The set docs/research/style-references-comparison.md runs on. It costs money to run, so it should
// not turn out broken on the day.
const {
  texts,
}: {
  texts: { id: string; locale: string; text: string; facts: string[] }[];
} = JSON.parse(
  readFileSync(
    path.join(__dirname, "../../docs/research/comparison-texts.json"),
    "utf8",
  ),
);

describe("the comparison texts", () => {
  it("holds six texts per language, each under its own id", () => {
    for (const locale of ["en", "fr"]) {
      expect(texts.filter((t) => t.locale === locale)).toHaveLength(6);
    }
    expect(new Set(texts.map((t) => t.id)).size).toBe(texts.length);
  });

  it.each(texts)("$id is a request the route accepts", ({ text, locale }) => {
    const parsed = RewriteRequestSchema.safeParse({ text, locale });
    expect(parsed.success).toBe(true);
    expect(text).not.toContain('"');
  });

  it.each(texts)("$id gives the checks something to hold on to", ({ text }) => {
    expect(figuresIn(text).length).toBeGreaterThanOrEqual(3);
    // An edit quotes a sentence or less, so that is where a denial has to show
    const sentences = text.split(/(?<=[.!?:;])\s+/);
    const denials = sentences.filter((s) => flipsNegation(s, "Plain words."));
    expect(denials.length).toBeGreaterThanOrEqual(1);
  });

  it.each(texts)("$id only lists facts the text states", ({ text, facts }) => {
    const stated = new Set(figuresIn(text).map((figure) => figure.value));
    expect(facts.length).toBeGreaterThanOrEqual(4);
    for (const fact of facts) {
      for (const figure of figuresIn(fact)) {
        expect(stated, `${fact}: ${figure.written}`).toContain(figure.value);
      }
    }
  });
});
