"use client";

import { useEffect, useState } from "react";

type WordDiff = typeof import("@/lib/rewrite/word-diff").wordDiff;

let loaded: WordDiff | null = null;

// Only a reader who gets a review needs it. Asked for with the rewrite, it is there before the first
// edit. If it cannot be fetched, edits stay shown as whole lines.
export const loadWordDiff = () =>
  import("@/lib/rewrite/word-diff").then(
    (module) => (loaded = module.wordDiff),
    () => null,
  );

// Null until the code has arrived
export function useWordDiff(): WordDiff | null {
  const [diff, setDiff] = useState(() => loaded);

  useEffect(() => {
    if (diff) return;
    let live = true;
    loadWordDiff().then((found) => {
      if (live && found) setDiff(() => found);
    });
    return () => {
      live = false;
    };
  }, [diff]);

  return diff;
}
