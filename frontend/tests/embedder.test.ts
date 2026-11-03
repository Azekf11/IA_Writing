// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedder, getEmbedder } from "@/lib/style/embedder";

// Vectors produced by the Python embedder (corpus-pipeline/src/aiwd/style/embed.py),
// written by corpus-pipeline/scripts/export_parity_fixture.py.
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

  it("loads the model once per instance", () => {
    expect(getEmbedder()).toBe(getEmbedder());
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

describe("a damaged embedding table", () => {
  afterEach(() => {
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  // A wrong table would give plausible but meaningless matches, with nothing to say so
  it.each(["weights.i8", "scales.f32", "tokenizer.json"])(
    "stops the model from loading when %s has changed",
    async (name) => {
      vi.resetModules();
      vi.doMock("node:fs", async (importOriginal) => {
        const fs = await importOriginal<typeof import("node:fs")>();
        return {
          ...fs,
          readFileSync: ((file: string, ...rest: []) => {
            const bytes = fs.readFileSync(file, ...rest);
            if (!String(file).endsWith(name)) return bytes;
            const changed = Buffer.from(bytes);
            changed[0] ^= 1;
            return changed;
          }) as typeof fs.readFileSync,
        };
      });
      const fresh = await import("@/lib/style/embedder");
      expect(() => fresh.createEmbedder()).toThrow(`${name}: bad checksum`);
    },
  );
});
