import { sameNumbers } from "./numbers";
import type { RawEdit } from "./schema";
import type { Edit } from "./types";

type Range = [start: number, end: number];

const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1];

// A combining mark belongs to the letter before it, and a letter can take two code units.
// An emoji's variation selector and keycap are marks too, but no word ends there.
const ENDS_IN_WORD = /(?![\uFE0F\u20E3])[\p{L}\p{N}\p{M}]$/u;
const STARTS_WITH_WORD = /^[\p{L}\p{N}\p{M}]/u;
const wordEndsAt = (text: string, at: number) =>
  ENDS_IN_WORD.test(text.slice(Math.max(0, at - 2), at));
const wordStartsAt = (text: string, at: number) =>
  STARTS_WITH_WORD.test(text.slice(at, at + 2));
const cutsWord = (text: string, at: number) =>
  wordEndsAt(text, at) && wordStartsAt(text, at);

// A range that starts or ends inside a word is another word: "key" is not in "monkey"
const splitsWord = (text: string, [start, end]: Range) =>
  cutsWord(text, start) || cutsWord(text, end);

// A mark inside a figure. A range that stops on one leaves the digits out of the quote, so the
// number check cannot see it change the figure: "fell by -" before "5%", "1," before "200".
const FIGURE_MARK = /[\p{Pd}\p{Sc}\u2212,.:/%\u2030'\u2019]/u;
// What sticks to the digits before it, whatever comes next: "%" after "12"
const UNIT_MARK = /[\p{Sc}%\u2030]/u;
const isDigit = (ch: string | undefined) => ch !== undefined && /\d/.test(ch);

const cutsFigure = (text: string, [start, end]: Range) =>
  (isDigit(text[end]) && FIGURE_MARK.test(text[end - 1] ?? "")) ||
  (isDigit(text[start - 1]) &&
    (UNIT_MARK.test(text[start] ?? "") ||
      (FIGURE_MARK.test(text[start] ?? "") && isDigit(text[start + 1]))));

const usable = (text: string, range: Range, taken: Range[]) =>
  !splitsWord(text, range) &&
  !cutsFigure(text, range) &&
  !taken.some((other) => overlaps(range, other));

// First occurrence of `quote` that is whole words and does not collide with a taken range
function findFree(text: string, quote: string, taken: Range[]): number {
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(quote, from);
    if (start === -1) return -1;
    if (usable(text, [start, start + quote.length], taken)) return start;
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

// The same text in plain typography, character for character
export const plainTypography = (text: string) =>
  Array.from(text, (ch) => FOLD[ch] ?? ch).join("");

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
    if (usable(text, range, taken)) return range;
    from = at + 1;
  }
  return null;
}

// What still needs a space between them where a quote goes away: a word or what closes one, then a
// word or what opens one. "12%" then "a", "works" then "(and". Quote marks that can do both do not count.
const CLOSES_WORD = /[)\]}\u201d\u2019\u00bb%\u2030\p{Sc}?!]/u;
const OPENS_WORD = /[(\[{\u201c\u2018\u00ab\u00bf\u00a1\p{Sc}]/u;
const endsLikeWord = (text: string, at: number) =>
  wordEndsAt(text, at) || CLOSES_WORD.test(text[at - 1] ?? "");
const startsLikeWord = (text: string, at: number) =>
  wordStartsAt(text, at) || OPENS_WORD.test(text[at] ?? "");

// The replacement without the outer spaces the quote had, except where the text has none and a word
// comes next: " \u2014 " to ", " on a dash that touches its words
function trimLike(
  text: string,
  [start, end]: Range,
  { original, replacement }: RawEdit,
): string {
  const left =
    /^\s/.test(original) && !endsLikeWord(text, start)
      ? replacement.trimStart()
      : replacement;
  return /\s$/.test(original) && !startsLikeWord(text, end)
    ? left.trimEnd()
    : left;
}

const isBlank = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const lineBreaks = (value: string) => value.split("\n").length - 1;

// Marks that touch the word beside them, so a deleted word gives up the space on its other side
const OPENS = /[(\[{\u00ab\u201c\u2018"'\u00bf\u00a1\u2013\u2014*]/u;
const CLOSES = /[.,;:!?\u2026)\]}\u00bb\u201d\u2019"'\u2013\u2014*]/u;
// French sets these apart with a no-break space, or the mark can start a line: that space stays
const FRENCH_MARK = /[:;!?\u00bb]/u;

// What a deletion takes along, so no double space, blank block or stray space stays behind. The
// whitespace around the word, quoted or not, comes down to one side's: the side with more line
// breaks, so that paragraphs stay apart, or else the left one. A word alone on its line takes that
// line, and the next line keeps its indent. A space goes when the word touched punctuation on the
// other side. When another edit holds the right side, the left one goes instead, unless a line break
// would go with it.
function widenForDeletion(
  text: string,
  [start, end]: Range,
  taken: Range[],
): Range {
  let wordStart = start;
  while (wordStart < end && isBlank(text[wordStart])) wordStart++;
  if (wordStart === end) return [start, end];
  let wordEnd = end;
  while (isBlank(text[wordEnd - 1])) wordEnd--;
  let from = wordStart;
  while (isBlank(text[from - 1])) from--;
  let to = wordEnd;
  while (isBlank(text[to])) to++;

  const left = text.slice(from, wordStart);
  const right = text.slice(wordEnd, to);
  const keepLeft: Range = [wordStart, to];
  const keepRight: Range = [from, wordEnd];
  const free = (range: Range) => !taken.some((other) => overlaps(range, other));

  let wider: Range = [wordStart, wordEnd];
  if (from === 0 && (to === text.length || !right.includes("\n"))) {
    wider = [start, to];
  } else if (to === text.length) {
    wider = [from, end];
  } else if (from > 0 && lineBreaks(right) > lineBreaks(left)) {
    wider = [from, text.indexOf("\n", wordEnd)];
  } else if (right.includes("\n")) {
    wider = [
      from + left.lastIndexOf("\n") + 1,
      wordEnd + right.lastIndexOf("\n") + 1,
    ];
  } else if (
    left &&
    !left.includes("\n") &&
    FRENCH_MARK.test(text[to]) &&
    free(keepRight)
  ) {
    wider = keepRight;
  } else if (left && (right || left.includes("\n"))) {
    wider = keepLeft;
  } else if (left && CLOSES.test(text[to])) {
    wider = keepRight;
  } else if (right && OPENS.test(text[from - 1])) {
    wider = keepLeft;
  }
  if (free(wider)) return wider;
  return free(keepRight) && !left.includes("\n")
    ? keepRight
    : [wordStart, wordEnd];
}

// How a replacement starts or ends when it decides the spacing on that side itself: "de " to "d'"
// before "ami", " ," to ",". A dash counts, so that "by " to "by -" before "5%" stays a minus sign.
const SETS_LEFT = /^[\s\p{Pd}\u2212'\u2019.,;:!?\u2026)\]}\u201d\u00bb]/u;
const SETS_RIGHT = /[\s\p{Pd}\u2212'\u2019(\[{\u00bf\u00a1\u201c\u2018]$/u;
// Where no space belongs, in either language: "( very", "yes ,"
const NO_SPACE_AFTER = /[(\[{\u00bf\u00a1\u201c\u2018]/u;
const NO_SPACE_BEFORE = /[.,\u2026)\]}]/u;

// An exact quote can carry an outer space its replacement lost. That space stays in the text, or
// what it separates would join: "very good " to "great" before "idea", "Done. " to "Done." before
// "Next". A line break stays the same way.
function keepOuterSpace(
  text: string,
  [start, end]: Range,
  { original, replacement }: RawEdit,
): Range {
  if (!original.trim()) return [start, end];
  const before = original.slice(
    0,
    original.length - original.trimStart().length,
  );
  const after = original.slice(original.trimEnd().length);
  const previous = text[start - 1];
  const next = text[end];
  // Whitespace beside it makes a space redundant, but not a line break: one of a paragraph's two
  const needed = (outer: string, beside: string) =>
    !isBlank(beside) || outer.includes("\n");
  return [
    before &&
    !SETS_LEFT.test(replacement) &&
    previous !== undefined &&
    needed(before, previous) &&
    !NO_SPACE_AFTER.test(previous)
      ? start + before.length
      : start,
    after &&
    !SETS_RIGHT.test(replacement) &&
    next !== undefined &&
    needed(after, next) &&
    !NO_SPACE_BEFORE.test(next)
      ? end - after.length
      : end,
  ];
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
  let range: Range | null =
    exact !== -1
      ? [exact, exact + edit.original.length]
      : findLoose(text, edit.original, taken);
  if (!range) return null;
  // A loose match leaves out the quote's outer spaces: the replacement must not keep them,
  // or applying it would double the spaces around it
  const written = exact !== -1 ? edit.replacement : trimLike(text, range, edit);
  // Spaces in place of a word delete it just as nothing does. A line break is a choice.
  let replacement =
    edit.original.trim() && /^[^\S\n]*$/.test(written) ? "" : written;
  if (!replacement) {
    range = widenForDeletion(text, range, taken);
    // Unless nothing else keeps two words apart: "\u2014" to " " in "works\u2014and"
    if (
      /[^\S\n]/.test(edit.replacement) &&
      endsLikeWord(text, range[0]) &&
      startsLikeWord(text, range[1])
    )
      replacement = " ";
  } else if (exact !== -1) {
    range = keepOuterSpace(text, range, edit);
  }
  // The guard only saw the quote. This is the text the reader would get, and it must read the same
  // figures: the quote can leave a figure's digits out, or the deletion join two of them.
  const result = text.slice(0, range[0]) + replacement + text.slice(range[1]);
  if (!sameNumbers(text, result)) return null;
  taken.push(range);
  return {
    ...edit,
    replacement,
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
