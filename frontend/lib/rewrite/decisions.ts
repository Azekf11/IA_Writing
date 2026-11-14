import type { Decision, Overrides } from "./apply";
import type { Edit } from "./types";

export type Decisions = Record<string, Decision>;

// All that the writer has settled about the edits. An undo step puts the whole of it back, so
// whatever joins the decisions here later is covered without changing Undo.
export type ReviewState = { decisions: Decisions; overrides: Overrides };

// A review as it stands and the steps that led to it. Every change gives a new value.
export type ReviewLog = { now: ReviewState; earlier: ReviewState[] };

export const NEW_LOG: ReviewLog = {
  now: { decisions: {}, overrides: {} },
  earlier: [],
};

const decisionOf = (decisions: Decisions, id: string): Decision =>
  decisions[id] ?? "pending";

export const pendingEdits = (edits: Edit[], decisions: Decisions): Edit[] =>
  edits.filter((edit) => decisionOf(decisions, edit.id) === "pending");

const without = (overrides: Overrides, ids: string[]): Overrides =>
  Object.fromEntries(
    Object.entries(overrides).filter(([id]) => !ids.includes(id)),
  );

// A change that changes nothing leaves no step behind: Undo would seem to do nothing
function settle(log: ReviewLog, ids: string[], decision: Decision): ReviewLog {
  const { decisions, overrides } = log.now;
  const changed = ids.filter((id) => decisionOf(decisions, id) !== decision);
  if (changed.length === 0) return log;
  const next = { ...decisions };
  for (const id of changed) next[id] = decision;
  return {
    now: {
      ...log.now,
      decisions: next,
      // A wording belongs to an accepted edit: taking that back returns to the model's suggestion
      overrides:
        decision === "accepted" ? overrides : without(overrides, changed),
    },
    earlier: [...log.earlier, log.now],
  };
}

export const decide = (
  log: ReviewLog,
  id: string,
  decision: Decision,
): ReviewLog => settle(log, [id], decision);

// While some edits are undecided the bulk buttons reach only those: what the writer has settled
// stays as it is. Once none is left, they apply to every edit.
export function decideAll(
  log: ReviewLog,
  edits: Edit[],
  decision: Decision,
): ReviewLog {
  const undecided = pendingEdits(edits, log.now.decisions);
  const targets = undecided.length > 0 ? undecided : edits;
  return settle(
    log,
    targets.map((edit) => edit.id),
    decision,
  );
}

// Accepts the edit with the writer's own wording, as one step. Blank wording is refused: taking
// words out needs the spacing work done on the server, and Accept still does it for a suggested
// removal. The suggestion's own words need no entry.
export function reword(log: ReviewLog, edit: Edit, wording: string): ReviewLog {
  const written = wording.normalize("NFC");
  if (!written.trim()) return log;
  const { decisions, overrides } = log.now;
  const unchanged =
    decisionOf(decisions, edit.id) === "accepted" &&
    (overrides[edit.id] ?? edit.replacement) === written;
  if (unchanged) return log;
  const others = without(overrides, [edit.id]);
  return {
    now: {
      ...log.now,
      decisions: { ...decisions, [edit.id]: "accepted" },
      overrides:
        written === edit.replacement
          ? others
          : { ...others, [edit.id]: written },
    },
    earlier: [...log.earlier, log.now],
  };
}

export const canUndo = (log: ReviewLog): boolean => log.earlier.length > 0;

export function undo(log: ReviewLog): ReviewLog {
  const previous = log.earlier.at(-1);
  return previous ? { now: previous, earlier: log.earlier.slice(0, -1) } : log;
}

// The first edit in reading order on which two states differ
export function firstChanged(
  edits: Edit[],
  before: ReviewState,
  after: ReviewState,
): string | null {
  const edit = edits.find(
    ({ id }) =>
      decisionOf(before.decisions, id) !== decisionOf(after.decisions, id) ||
      before.overrides[id] !== after.overrides[id],
  );
  return edit?.id ?? null;
}
