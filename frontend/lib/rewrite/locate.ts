import type { RawEdit } from "./schema";
import type { Edit } from "./types";

type Range = [start: number, end: number];

const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1];

// First occurrence of `quote` that does not collide with a taken range
function findFree(text: string, quote: string, taken: Range[]): number {
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(quote, from);
    if (start === -1) return -1;
    const range: Range = [start, start + quote.length];
    if (!taken.some((other) => overlaps(range, other))) return start;
    from = start + 1;
  }
  return -1;
}

// Models often retype typography: curly quotes become straight, a non-breaking space a plain one
const FOLD: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u00a0": " ",
  "\u202f": " ",
  "\u2011": "-",
};

// Text folded to plain typography, with a map from each folded index back to the original.
// Runs of whitespace become one space, so line breaks do not defeat a match.
function fold(text: string): { folded: string; origin: number[] } {
  let folded = "";
  const origin: number[] = [];
  let pendingSpace = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = FOLD[text[i]] ?? text[i];
    if (/\s/.test(ch)) {
      if (folded.length > 0 && pendingSpace === -1) pendingSpace = i;
      continue;
    }
    if (pendingSpace !== -1) {
      origin[folded.length] = pendingSpace;
      folded += " ";
      pendingSpace = -1;
    }
    origin[folded.length] = i;
    folded += ch;
  }
  return { folded, origin };
}

// Fallback when the exact quote is missing: match on folded typography and map back
function findLoose(text: string, quote: string, taken: Range[]): Range | null {
  const needle = fold(quote).folded;
  if (!needle) return null;
  const { folded, origin } = fold(text);
  let from = 0;
  while (from <= folded.length) {
    const at = folded.indexOf(needle, from);
    if (at === -1) return null;
    const range: Range = [origin[at], origin[at + needle.length - 1] + 1];
    if (!taken.some((other) => overlaps(range, other))) return range;
    from = at + 1;
  }
  return null;
}

export type Located = Omit<Edit, "id">;

// Where one edit's quote sits in the text, or null when it is absent or collides with a
// range already taken. `original` is rewritten to the exact text found, so a loose match
// still diffs cleanly. Pushes the range it takes onto `taken`.
export function locateOne(
  text: string,
  edit: RawEdit,
  taken: Range[],
): Located | null {
  if (!edit.original || edit.original === edit.replacement) return null;
  const exact = findFree(text, edit.original, taken);
  const range: Range | null =
    exact !== -1
      ? [exact, exact + edit.original.length]
      : findLoose(text, edit.original, taken);
  if (!range) return null;
  taken.push(range);
  return {
    ...edit,
    original: text.slice(range[0], range[1]),
    start: range[0],
    end: range[1],
  };
}

// LLMs count characters badly, so offsets are computed here, not by the model.
// Edits whose quote is not in the text are dropped; the rest are sorted by position.
export function locateEdits(text: string, raw: RawEdit[]): Edit[] {
  const taken: Range[] = [];
  const found: Located[] = [];
  for (const edit of raw) {
    const located = locateOne(text, edit, taken);
    if (located) found.push(located);
  }
  return found
    .sort((a, b) => a.start - b.start)
    .map((edit, index) => ({ id: `edit-${index}`, ...edit }));
}
