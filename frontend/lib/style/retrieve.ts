import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedder, type Embedder } from "./embedder";
import { guessLanguage, type Lang } from "./language";
import { referencesEnabled } from "./switch";

export type Reference = {
  id: string;
  author: string;
  title: string;
  kind: "fiction" | "essay" | "book" | "news";
  year: number | null;
  body: string;
  similarity: number;
};

// How many excerpts reach the prompt, and how many candidates we fetch to pick them from
const KEEP = 3;
const CANDIDATES = 10;
// A floor, not a topic filter. Measured with this embedder: prose on a clear topic scores
// 0.45 to 0.55, corporate jargon about 0.35, and code or gibberish anywhere from 0.2 to 0.33,
// so no threshold separates "related" from "unrelated". This only drops the weakest matches.
// Style references guide rhythm, not subject, so a loose match is still usable.
export const MIN_SIMILARITY = 0.2;
// A stalled search must not eat the model's time. Far above what a search normally takes.
const SEARCH_MS = 5_000;

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

// Style references are a bonus: any failure here must never block the rewrite itself.
// The search needs a started ticket of this account: the database allows one search per ticket.
export async function findReferences(
  server: Pick<SupabaseClient, "rpc">,
  account: string,
  ticket: string,
  text: string,
  uiLocale: Lang,
  embedder: () => Embedder = getEmbedder,
): Promise<Reference[]> {
  if (!referencesEnabled()) return [];

  try {
    const vector = embedder().embed(text);
    if (!vector) return [];

    // The text's own language wins over the interface language
    const lang = guessLanguage(text) ?? uiLocale;
    const { data, error } = await server
      .rpc("search_style_passages", {
        account,
        reservation: ticket,
        query_embedding: asVector(vector),
        match_lang: lang,
        match_count: CANDIDATES,
      })
      .abortSignal(AbortSignal.timeout(SEARCH_MS));
    if (error) {
      console.error("Style search failed", error.code);
      return [];
    }
    const related = ((data ?? []) as Reference[]).filter(
      (row) => row.similarity >= MIN_SIMILARITY,
    );
    return onePerAuthor(related);
  } catch (error) {
    // The name only: an error message can quote the text it failed on
    console.error(
      "Style references unavailable",
      error instanceof Error ? error.name : typeof error,
    );
    return [];
  }
}
