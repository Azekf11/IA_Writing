// Limits and choices the browser needs too. They live here, not beside the request schema, because
// importing that file would bring its validator into the page's script.

// Input cap keeps API costs and latency predictable
export const MAX_CHARS = 5000;

// The free check runs in the browser at no cost, so it takes far more than a rewrite. The bound is there to
// keep the page responsive.
export const MAX_CHECK_CHARS = 50_000;

// How much the model may change: light touches only clear tells, thorough also weaker ones
export const STRENGTHS = ["light", "standard", "thorough"] as const;
export type Strength = (typeof STRENGTHS)[number];

// A sample of the author's own writing, so edits can stay close to their voice
export const MAX_VOICE_CHARS = 1500;

// Measured as the text is sent: an accent pasted as a separate character counts once
export const countCharacters = (text: string): number =>
  text.normalize("NFC").length;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Models often retype typography: curly quotes become straight, a non-breaking space a plain one
export const FOLD: Record<string, string> = {
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

// What a search compares, on both sides: nobody types the accents, curly apostrophes and dashes a
// word processor left in a text, the ligatures and ellipsis a PDF leaves (NFKD spells them out), or
// its line breaks. Lower case comes first: the ligatures below are the lower-case ones. Unlike
// plainTypography, this one can change the length: nothing reads an offset in what it returns.
export const foldForSearch = (text: string) =>
  plainTypography(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0153/g, "oe")
    .replace(/\u00e6/g, "ae")
    .replace(/\u00df/g, "ss")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u02bc/g, "'")
    // Soft hyphens and zero-width characters, which nobody types
    .replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ");
