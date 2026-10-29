// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createEmbedder } from "@/lib/style/embedder";

// Vectors produced by the Python embedder (backend/src/aiwd/style/embed.py).
// If this fails, the database vectors and the query vectors no longer match.
const fixture: { text: string; vector: number[] }[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/embedder-parity.json"), "utf8"),
);

const embedder = createEmbedder();

describe("embedder", () => {
  it("reproduces the Python vectors", () => {
    for (const { text, vector } of fixture) {
      const got = embedder.embed(text);
      expect(got).not.toBeNull();
      expect(got).toHaveLength(embedder.dim);
      const worst = Math.max(...vector.map((v, i) => Math.abs(v - got![i])));
      expect(worst).toBeLessThan(1e-4);
    }
  });

  it("returns unit vectors", () => {
    const vector = embedder.embed(
      "A short sentence about nothing in particular.",
    )!;
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("returns null when there is nothing to embed", () => {
    expect(embedder.embed("")).toBeNull();
    expect(embedder.embed("   ")).toBeNull();
  });

  it("puts similar texts closer than unrelated ones", () => {
    const dot = (a: number[], b: number[]) =>
      a.reduce((s, v, i) => s + v * b[i], 0);
    const cat = embedder.embed(
      "The cat slept on the warm sofa all afternoon.",
    )!;
    const kitten = embedder.embed(
      "A kitten dozed on the sofa during the afternoon.",
    )!;
    const tax = embedder.embed(
      "Parliament voted to raise the corporate tax rate.",
    )!;
    expect(dot(cat, kitten)).toBeGreaterThan(dot(cat, tax));
  });
});
