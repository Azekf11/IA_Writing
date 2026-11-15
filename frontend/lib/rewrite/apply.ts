import type { Edit } from "./types";

export type Decision = "pending" | "accepted" | "rejected";

// The writer's own wording for an edit, by id. The edit itself never changes.
export type Overrides = Record<string, string>;

// A slice of the original text, or an edit awaiting a decision
export type Segment =
  { kind: "text"; text: string } | { kind: "edit"; edit: Edit };

// Cut the text around each edit. Edits must be sorted and non-overlapping.
export function toSegments(text: string, edits: Edit[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const edit of edits) {
    if (edit.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, edit.start) });
    }
    segments.push({ kind: "edit", edit });
    cursor = edit.end;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

// What an accepted edit puts in the text. A suggested removal takes the blank on one side of its
// words as well, so that no double space is left: a wording written in its place gets that blank
// back, without doubling one the writer typed there.
function accepted(edit: Edit, wording: string | undefined): string {
  if (wording === undefined) return edit.replacement;
  if (edit.replacement.trim()) return wording;
  const [, lead, trail] = edit.original.match(/^(\s*)[\s\S]*?(\s*)$/)!;
  const inner = lead ? wording.trimStart() : wording;
  return lead + (trail ? inner.trimEnd() : inner) + trail;
}

// Only accepted edits change the text; pending and rejected keep the original
export function applyEdits(
  text: string,
  edits: Edit[],
  decisions: Record<string, Decision>,
  overrides: Overrides = {},
): string {
  return toSegments(text, edits)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const { edit } = segment;
      return decisions[edit.id] === "accepted"
        ? accepted(edit, overrides[edit.id])
        : text.slice(edit.start, edit.end);
    })
    .join("");
}
