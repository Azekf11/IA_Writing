import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";

// Same files and same maths as backend/src/aiwd/style/embed.py:
// tokenize, average the int8 rows (times their scale), L2-normalize.
const DIR = path.join(process.cwd(), "data", "embedder");

type Meta = {
  dim: number;
  vocab: number;
  sha256: Record<string, string>;
};

export type Embedder = {
  dim: number;
  embed: (text: string) => number[] | null;
};

function readChecked(name: string, meta: Meta): Buffer {
  const bytes = readFileSync(path.join(DIR, name));
  const digest = createHash("sha256").update(bytes).digest("hex");
  // A silently wrong table would return plausible but meaningless matches
  if (digest !== meta.sha256[name]) throw new Error(`${name}: bad checksum`);
  return bytes;
}

export function createEmbedder(): Embedder {
  const meta: Meta = JSON.parse(
    readFileSync(path.join(DIR, "meta.json"), "utf8"),
  );
  const weights = readChecked("weights.i8", meta);
  const scaleBytes = readChecked("scales.f32", meta);
  const tokenizerJson = JSON.parse(
    readChecked("tokenizer.json", meta).toString("utf8"),
  );

  const quantized = new Int8Array(
    weights.buffer,
    weights.byteOffset,
    weights.length,
  );
  // Copy so the float view starts on a 4-byte boundary
  const scales = new Float32Array(
    scaleBytes.buffer.slice(
      scaleBytes.byteOffset,
      scaleBytes.byteOffset + scaleBytes.length,
    ),
  );
  const tokenizer = new Tokenizer(tokenizerJson, {});
  const { dim } = meta;

  function embed(text: string): number[] | null {
    const { ids } = tokenizer.encode(text, { add_special_tokens: false });
    if (ids.length === 0) return null;

    const sum = new Float64Array(dim);
    for (const id of ids) {
      const scale = scales[id];
      const base = id * dim;
      for (let i = 0; i < dim; i++) sum[i] += quantized[base + i] * scale;
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += sum[i] * sum[i];
    norm = Math.sqrt(norm);
    return norm === 0 ? null : Array.from(sum, (value) => value / norm);
  }

  return { dim, embed };
}

let cached: Embedder | undefined;

// Loaded once per server instance: reading 27 MB on every request would be wasteful
export function getEmbedder(): Embedder {
  cached ??= createEmbedder();
  return cached;
}
