import type { Edit } from "./types";

export type SampleEdit = Pick<Edit, "original" | "replacement" | "reason">;

// The page's example: edits written by hand in the message files and placed on its text here, so that
// no offset is written down anywhere. A quote the text does not hold is left out.
export function sampleEdits(text: string, written: SampleEdit[]): Edit[] {
  return written
    .flatMap((edit) => {
      const start = text.indexOf(edit.original);
      return start === -1
        ? []
        : [{ ...edit, start, end: start + edit.original.length }];
    })
    .sort((a, b) => a.start - b.start)
    .map((edit, index) => ({ id: `edit-${index}`, ...edit }));
}
