import type { Decision } from "./apply";
import type { Edit } from "./types";

export type ReviewKey =
  "accept" | "reject" | "reword" | "undo" | "next" | "previous";

// Letters only, no modifier: a shortcut must never steal Ctrl+C, Cmd+R or browser keys. Shift
// counts as one too; a capital typed with Caps Lock comes without it.
// A held key repeats: moving can go on, but one press is one decision.
export function reviewKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}): ReviewKey | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
    return null;
  switch (event.key.toLowerCase()) {
    case "a":
      return event.repeat ? null : "accept";
    case "r":
      return event.repeat ? null : "reject";
    case "e":
      return event.repeat ? null : "reword";
    case "u":
      return event.repeat ? null : "undo";
    case "j":
      return "next";
    case "k":
      return "previous";
    default:
      return null;
  }
}

// Typing in a field is never a shortcut
export const isTyping = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  return (
    el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)
  );
};

// The edit that should have focus after `key`, given the one that has it now.
// Moving stops at both ends instead of wrapping around.
export function moveFocus(
  edits: Edit[],
  current: string | null,
  key: "next" | "previous",
): string | null {
  if (edits.length === 0) return null;
  const at = edits.findIndex((e) => e.id === current);
  if (at === -1) return edits[key === "next" ? 0 : edits.length - 1].id;
  const to = Math.min(
    edits.length - 1,
    Math.max(0, at + (key === "next" ? 1 : -1)),
  );
  return edits[to].id;
}

// After a decision, jump to the next edit still waiting for one; stay put when none is left
export function nextPending(
  edits: Edit[],
  decisions: Record<string, Decision>,
  after: string,
): string {
  const at = edits.findIndex((e) => e.id === after);
  for (let step = 1; step <= edits.length; step++) {
    const edit = edits[(at + step) % edits.length];
    if (!decisions[edit.id] || decisions[edit.id] === "pending") return edit.id;
  }
  return after;
}

// What the letters act on after a decision: the next edit waiting for one. None when all are
// decided, so that a letter pressed after the last decision cannot flip it.
export function markAfter(
  edits: Edit[],
  decisions: Record<string, Decision>,
  after: string,
): string | null {
  const to = nextPending(edits, decisions, after);
  return !decisions[to] || decisions[to] === "pending" ? to : null;
}
