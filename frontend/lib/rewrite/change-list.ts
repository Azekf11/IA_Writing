import type { Decision, Overrides } from "./apply";
import type { Edit } from "./types";

// The list's own words, in the language of the page, punctuation included
export type ChangeListWords = {
  title: string;
  before: string;
  after: string;
  why: string;
  // Shown for a replacement that takes the words out
  removed: string;
};

// The accepted edits in reading order, as plain text. It records those edits and nothing else: it
// says nothing about who wrote the text.
export function changeList(
  edits: Edit[],
  decisions: Record<string, Decision>,
  overrides: Overrides,
  words: ChangeListWords,
): string {
  const entries = edits
    .filter((edit) => decisions[edit.id] === "accepted")
    .sort((a, b) => a.start - b.start)
    .map((edit, index) => {
      const after = overrides[edit.id] ?? edit.replacement;
      return [
        `${index + 1}. ${words.before} ${edit.original}`,
        `${words.after} ${after.trim() ? after : words.removed}`,
        `${words.why} ${edit.reason}`,
      ].join("\n");
    });
  return `${[words.title, ...entries].join("\n\n")}\n`;
}
