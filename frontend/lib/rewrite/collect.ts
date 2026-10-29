import { MAX_EDITS, whyDrop } from "./guard";
import { locateOne } from "./locate";
import type { RawEdit } from "./schema";
import type { Edit } from "./types";

// Applies the same rules as guardEdits + locateEdits, one edit at a time, so an edit can reach
// the user the moment the model finishes writing it. Ids follow arrival order and never change:
// a decision made while the model is still writing stays attached to the right edit.
export class EditCollector {
  private taken: [number, number][] = [];
  private kept: Edit[] = [];
  private seen = 0;
  readonly dropped: Record<string, number> = {};

  constructor(private readonly text: string) {}

  // The edit to show, or null when it is unsafe, repeated or cannot be found in the text
  add(raw: RawEdit): Edit | null {
    const reason = whyDrop(raw);
    if (reason) return this.drop(reason);
    if (this.seen >= MAX_EDITS) return this.drop("too_many");

    const located = locateOne(this.text, raw, this.taken);
    if (!located) return this.drop("not_found");

    const edit: Edit = { id: `edit-${this.seen++}`, ...located };
    this.kept.push(edit);
    return edit;
  }

  // Every kept edit, in reading order
  result(): Edit[] {
    return [...this.kept].sort((a, b) => a.start - b.start);
  }

  private drop(reason: string): null {
    this.dropped[reason] = (this.dropped[reason] ?? 0) + 1;
    return null;
  }
}
