import type { Options } from "@/components/rewrite-options";

export type Draft = { text: string; options: Options };

// What the reader has typed, kept while they move around the site: a language switch or a trip to
// the history page recreates the editor. In memory only: it goes with the tab, and signing out
// reloads the page.
let draft: Draft | null = null;

export const readDraft = () => draft;

export const saveDraft = (value: Draft | null) => {
  draft = value;
};
