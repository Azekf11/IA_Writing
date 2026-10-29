import type { Edit } from "./types";

// A past rewrite handed from the history page to the editor.
// It travels in sessionStorage: a text of up to 5,000 characters does not belong in a URL,
// and it should not outlive the tab.
const KEY = "rewrity:reopen";

export type Reopened = { text: string; edits: Edit[]; stamp: number };

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
    const value: Reopened = { text, edits, stamp: Date.now() };
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Storage can be blocked: the editor then opens empty, which is harmless
  }
}

// Takes the stashed rewrite out, once. Anything malformed is discarded, never trusted:
// offsets that no longer fit the text would cut the wrong words.
export function takeReopen(): Reopened | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value?.text !== "string" || !Array.isArray(value.edits))
      return null;
    const edits = value.edits.filter(isEdit);
    if (edits.length !== value.edits.length) return null;
    const fits = edits.every(
      (e: Edit) =>
        e.start >= 0 &&
        e.end <= value.text.length &&
        e.start < e.end &&
        value.text.slice(e.start, e.end) === e.original,
    );
    return fits ? { text: value.text, edits, stamp: value.stamp ?? 0 } : null;
  } catch {
    return null;
  }
}
