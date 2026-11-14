import { plainTypography } from "@/lib/text";
import { sameAttribution } from "./attribution";
import { flipsNegation } from "./negation";
import { sameNumbers } from "./numbers";
import type { RawEdit } from "./schema";
import { readsAsUnit, sameBounds, sameUnits, touchesFigure } from "./units";

// Most edits one answer may carry: a longer list is noise, and costs the user a long review
export const MAX_EDITS = 40;
// A replacement may be somewhat longer than what it replaces, never wildly so
const MAX_GROWTH = 3;
const MAX_SPAN_CHARS = 600;

export type FactChange =
  | "numbers_changed"
  | "units_changed"
  | "figures_swapped"
  | "negation_changed"
  | "bounds_changed";

export type DropReason =
  | "unchanged"
  | "too_long"
  | "span_too_long"
  | FactChange
  | "markup"
  | "too_many";

const MARKUP = /<\/?[a-z][^>]*>|\]\(|^\s*#{1,6}\s/i;

const tidy = (value: string) =>
  plainTypography(value).replace(/\s+/g, " ").trim();
const squash = (value: string) => tidy(value).toLowerCase();

// Title case the prompt asks to take off: two words or more lose the capitals that open them, and nothing
// else changes. One word's case is noise ("Internet"). Beside a figure a capital can be a unit, and 5 Mg
// compares the same as 5 mg, so that stays out too.
function takesOffTitleCase(original: string, replacement: string): boolean {
  const [before, after] = [tidy(original), tidy(replacement)];
  const words = new Set<number>();
  for (const { 0: part, index } of before.matchAll(/\p{L}+/gu)) {
    const end = index + part.length;
    const lowered = after.slice(index, end);
    if (part === lowered) continue;
    if (
      part !== lowered.charAt(0).toUpperCase() + lowered.slice(1) ||
      ((part.length === 1 || readsAsUnit(part)) &&
        touchesFigure(before, index, end))
    ) {
      return false;
    }
    // "L'Homme" and "Jean-Pierre" are one word each
    words.add(before.lastIndexOf(" ", index));
  }
  return words.size >= 2;
}

// Rewording must not touch the numbers: the same ones in, the same ones out, in any order. Each
// keeps its unit and stays with its name, a denial stays, and a bound keeps its direction. These read
// words next to figures, not meaning: docs/ARCHITECTURE.md lists what they cannot see.
export function factChange(
  original: string,
  replacement: string,
): FactChange | null {
  if (!sameNumbers(original, replacement)) return "numbers_changed";
  if (!sameUnits(original, replacement)) return "units_changed";
  if (!sameAttribution(original, replacement)) return "figures_swapped";
  if (flipsNegation(original, replacement)) return "negation_changed";
  if (!sameBounds(original, replacement)) return "bounds_changed";
  return null;
}

export function whyDrop(edit: RawEdit): DropReason | null {
  if (
    squash(edit.original) === squash(edit.replacement) &&
    !takesOffTitleCase(edit.original, edit.replacement)
  ) {
    return "unchanged";
  }
  if (edit.original.length > MAX_SPAN_CHARS) return "span_too_long";
  if (
    edit.replacement.length > Math.max(200, edit.original.length * MAX_GROWTH)
  ) {
    return "too_long";
  }
  if (MARKUP.test(edit.replacement)) return "markup";
  return factChange(edit.original, edit.replacement);
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
