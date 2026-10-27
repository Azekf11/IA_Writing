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

// LLMs count characters badly, so offsets are computed here, not by Claude.
// Edits whose quote is not in the text are dropped.
export function locateEdits(text: string, raw: RawEdit[]): Edit[] {
  const taken: Range[] = [];
  const found: Omit<Edit, "id">[] = [];

  for (const edit of raw) {
    if (!edit.original || edit.original === edit.replacement) continue;
    const start = findFree(text, edit.original, taken);
    if (start === -1) continue;
    const end = start + edit.original.length;
    taken.push([start, end]);
    found.push({ ...edit, start, end });
  }

  return found
    .sort((a, b) => a.start - b.start)
    .map((edit, index) => ({ id: `edit-${index}`, ...edit }));
}
