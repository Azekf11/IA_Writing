import type { Edit } from "./types";

// A past rewrite handed from the history page to the editor.
// It travels in sessionStorage: a text of up to 5,000 characters does not belong in a URL,
// and it should not outlive the tab.
const KEY = "rewrity:reopen";

// Reopen navigates straight away, so anything older was abandoned on the way there
const MAX_AGE_MS = 60_000;

type Stashed = { text: string; edits: Edit[]; stamp: number };
export type Reopened = Omit<Stashed, "stamp">;

const isEdit = (value: unknown): value is Edit => {
  const e = value as Edit;
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.original === "string" &&
    typeof e.replacement === "string" &&
    typeof e.reason === "string" &&
    Number.isInteger(e.start) &&
    Number.isInteger(e.end)
  );
};

export function stashReopen(text: string, edits: Edit[]): void {
  try {
    const value: Stashed = { text, edits, stamp: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage can be blocked: the editor then opens on the reader's draft, or empty
  }
}

// Reads the stashed rewrite and leaves it there: React can throw a render away and start again,
// and the second read must find the same thing. clearReopen() runs once a render has been kept.
// Anything malformed is discarded, never trusted: offsets that no longer fit the text would cut
// the wrong words.
export function readReopen(): Reopened | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.text !== "string" || !Array.isArray(value.edits))
      return null;
    if (Date.now() - (value.stamp ?? 0) > MAX_AGE_MS) return null;
    const edits = value.edits.filter(isEdit);
    if (edits.length !== value.edits.length) return null;
    const fits = edits.every(
      (e: Edit) =>
        e.start >= 0 &&
        e.end <= value.text.length &&
        e.start < e.end &&
        value.text.slice(e.start, e.end) === e.original,
    );
    return fits ? { text: value.text, edits } : null;
  } catch {
    return null;
  }
}

export function clearReopen(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked: there is nothing to clear then
  }
}
