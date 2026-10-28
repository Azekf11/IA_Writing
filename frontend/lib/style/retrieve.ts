import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedder, type Embedder } from "./embedder";
import { guessLanguage, type Lang } from "./language";

export type Reference = {
  id: string;
  author: string;
  title: string;
  kind: "fiction" | "essay";
  body: string;
  similarity: number;
};

// How many excerpts reach the prompt, and how many candidates we fetch to pick them from
const KEEP = 3;
const CANDIDATES = 10;

const asVector = (values: number[]) =>
  `[${values.map((v) => v.toFixed(6)).join(",")}]`;

// At most one excerpt per author, so the references are varied rather than one voice
function onePerAuthor(rows: Reference[]): Reference[] {
  const seen = new Set<string>();
  const out: Reference[] = [];
  for (const row of rows) {
    if (seen.has(row.author)) continue;
    seen.add(row.author);
    out.push(row);
    if (out.length === KEEP) break;
  }
  return out;
}

// Style references are a bonus: any failure here must never block the rewrite itself
export async function findReferences(
  supabase: Pick<SupabaseClient, "rpc">,
  text: string,
  uiLocale: Lang,
  embedder: () => Embedder = getEmbedder,
): Promise<Reference[]> {
  if (process.env.STYLE_REFERENCES === "off") return [];

  try {
    const vector = embedder().embed(text);
    if (!vector) return [];

    // The text's own language wins over the interface language
    const lang = guessLanguage(text) ?? uiLocale;
    const { data, error } = await supabase.rpc("match_style_passages", {
      query_embedding: asVector(vector),
      match_lang: lang,
      match_kind: null,
      match_count: CANDIDATES,
    });
    if (error) {
      console.error("Style search failed", error.code);
      return [];
    }
    return onePerAuthor((data ?? []) as Reference[]);
  } catch (error) {
    console.error("Style references unavailable", error);
    return [];
  }
}
