import { sameAttribution } from "./attribution";
import { plainTypography } from "./locate";
import { flipsNegation } from "./negation";
import { sameNumbers } from "./numbers";
import type { RawEdit } from "./schema";
import { sameUnits } from "./units";

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
  | "units_changed"
  | "figures_swapped"
  | "negation_changed"
  | "markup"
  | "too_many";

const MARKUP = /<\/?[a-z][^>]*>|\]\(|^\s*#{1,6}\s/i;

const squash = (value: string) =>
  plainTypography(value).replace(/\s+/g, " ").trim().toLowerCase();

export function whyDrop(edit: RawEdit): DropReason | null {
  if (squash(edit.original) === squash(edit.replacement)) return "unchanged";
  if (edit.original.length > MAX_SPAN_CHARS) return "span_too_long";
  if (
    edit.replacement.length > Math.max(200, edit.original.length * MAX_GROWTH)
  ) {
    return "too_long";
  }
  if (MARKUP.test(edit.replacement)) return "markup";
  // Rewording must not touch the numbers: the same ones in, the same ones out, in any order. Each
  // keeps its unit and stays with its name, and a denial stays. These read words next to figures,
  // not meaning: docs/ARCHITECTURE.md lists what they cannot see.
  const { original, replacement } = edit;
  if (!sameNumbers(original, replacement)) return "numbers_changed";
  if (!sameUnits(original, replacement)) return "units_changed";
  if (!sameAttribution(original, replacement)) return "figures_swapped";
  if (flipsNegation(original, replacement)) return "negation_changed";
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
