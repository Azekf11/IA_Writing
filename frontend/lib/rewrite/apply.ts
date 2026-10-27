import type { Edit } from "./types";

export type Decision = "pending" | "accepted" | "rejected";

// A slice of the original text, or an edit awaiting a decision
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "edit"; edit: Edit };

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

// Only accepted edits change the text; pending and rejected keep the original
export function applyEdits(
  text: string,
  edits: Edit[],
  decisions: Record<string, Decision>,
): string {
  return toSegments(text, edits)
    .map((segment) => {
      if (segment.kind === "text") return segment.text;
      const { edit } = segment;
      return decisions[edit.id] === "accepted"
        ? edit.replacement
        : text.slice(edit.start, edit.end);
    })
    .join("");
}
