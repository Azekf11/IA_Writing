import type { RawEdit } from "./schema";

// Most edits one answer may carry: a longer list is noise, and costs the user a long review
export const MAX_EDITS = 40;
// A replacement may be somewhat longer than what it replaces, never wildly so
const MAX_GROWTH = 3;
const MAX_SPAN_CHARS = 600;

export type DropReason =
  | "unchanged"
  | "too_long"
  | "span_too_long"
  | "numbers_changed"
  | "markup"
  | "too_many";

const MARKUP = /<\/?[a-z][^>]*>|\]\(|^\s*#{1,6}\s/i;
// 1,200 | 3.5 | 2019 | 5 000: the digits that carry facts
const NUMBER = /\d+(?:[.,\u00a0 ]\d{3})*(?:[.,]\d+)?/g;

const digitsOf = (value: string) =>
  (value.match(NUMBER) ?? []).map((n) => n.replace(/[\s\u00a0.,]/g, "")).sort();

const squash = (value: string) =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

export function whyDrop(edit: RawEdit): DropReason | null {
  if (squash(edit.original) === squash(edit.replacement)) return "unchanged";
  if (edit.original.length > MAX_SPAN_CHARS) return "span_too_long";
  if (
    edit.replacement.length > Math.max(200, edit.original.length * MAX_GROWTH)
  ) {
    return "too_long";
  }
  if (MARKUP.test(edit.replacement)) return "markup";
  // Rewording must not touch the facts: same numbers in, same numbers out
  const before = digitsOf(edit.original);
  const after = digitsOf(edit.replacement);
  if (before.length !== after.length || before.some((n, i) => n !== after[i])) {
    return "numbers_changed";
  }
  return null;
}

export type Guarded = { kept: RawEdit[]; dropped: Record<string, number> };

// Claude's edits are suggestions: anything that looks unsafe is discarded before the user sees it
export function guardEdits(edits: RawEdit[]): Guarded {
  const kept: RawEdit[] = [];
  const dropped: Record<string, number> = {};
  const drop = (reason: DropReason) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };

  for (const edit of edits) {
    const reason = whyDrop(edit);
    if (reason) drop(reason);
    else if (kept.length >= MAX_EDITS) drop("too_many");
    else kept.push(edit);
  }
  return { kept, dropped };
}
