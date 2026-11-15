import type { Options } from "@/components/rewrite-options";
import type { ReviewLog } from "@/lib/rewrite/decisions";
import type { Edit, ReferenceCredit, ReviewSource } from "@/lib/rewrite/types";
import { STRENGTHS, type Strength } from "@/lib/text";

// A finished review. `text` is the exact string its offsets refer to; the box can hold another one.
export type KeptReview = {
  text: string;
  edits: Edit[];
  credits: ReferenceCredit[];
  stopped: boolean;
  cutShort: boolean;
  log: ReviewLog;
  activeId: string | null;
  // On screen when the reader left, rather than behind the editor
  open: boolean;
  // Came from the history, so `text` is not something the reader typed
  reopened: boolean;
  // Made in the browser, not by the model
  source?: ReviewSource;
  // What the free check found beyond the edits it shows
  more?: number;
};

export type Draft = { text: string; options: Options; review?: KeptReview };

// What the reader has typed and the review they are in, kept while they move around the site: a
// language switch or a trip to the history page recreates the editor. In memory only, never in the
// browser's storage: it goes with the tab, a reload loses it, and signing out reloads the page. A
// first render on a full load finds nothing here, as on the server.
let draft: Draft | null = null;

export const readDraft = () => draft;

export const saveDraft = (value: Draft | null) => {
  draft = value;
};

// A sign-in link opens a new page, usually in another tab, where that memory is empty. So asking for
// one is the one moment the text goes to storage: localStorage, because of the other tab. The writing
// sample stays out, as the page promises it is not kept.
const KEY = "rewrity:sign-in-draft";

// As long as a sign-in link works: otp_expiry in supabase/config.toml
const MAX_AGE_MS = 60 * 60 * 1000;

export type KeptDraft = { text: string; strength: Strength; keep?: false };

export function keepDraftForSignIn(): void {
  // Nothing to keep now, and an earlier request's copy is not what the reader is working on
  if (!draft?.text.trim()) return clearKeptDraft();
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        text: draft.text,
        strength: draft.options.strength,
        keep: draft.options.keep,
        at: Date.now(),
      }),
    );
  } catch {
    // Storage can be blocked or full: the text then stays in the tab that asked
  }
}

function parseKept(raw: string): KeptDraft | null {
  try {
    const { text, strength, keep, at } = JSON.parse(raw);
    const usable =
      typeof text === "string" &&
      STRENGTHS.includes(strength) &&
      typeof at === "number" &&
      Date.now() - at <= MAX_AGE_MS;
    return usable
      ? { text, strength, keep: keep === false ? false : undefined }
      : null;
  } catch {
    return null;
  }
}

// Leaves a usable copy in place: only the editor that takes it removes it, since a tab that already
// holds a text does not need it and the tab the link opens still will. Too old or malformed, it goes.
export function readKeptDraft(): KeptDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const kept = parseKept(raw);
    if (!kept) localStorage.removeItem(KEY);
    return kept;
  } catch {
    return null;
  }
}

export function clearKeptDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage can be blocked: there is nothing to clear then
  }
}
