"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchEdits,
  isAbort,
  RewriteRequestError,
  type ClientErrorCode,
} from "@/lib/rewrite/client";
import type { RewriteInput } from "@/lib/rewrite/client";
import type { Edit, ReferenceCredit, ReviewSource } from "@/lib/rewrite/types";
import { nudgeAllowance } from "@/lib/rewrite/allowance-store";
import { onSignedIn } from "@/lib/signed-in";

// editing: the text box. writing: the model is still answering and edits appear as they come.
// reviewing: the answer is complete, or was stopped, or stopped short.
export type View = "editing" | "writing" | "reviewing";

// An earlier rewrite to show without asking the model again. `open` puts it on screen; otherwise it
// waits behind the editor. By default it opens when it has edits.
export type InitialRewrite = {
  edits: Edit[];
  credits?: ReferenceCredit[];
  stopped?: boolean;
  cutShort?: boolean;
  open?: boolean;
  source?: ReviewSource;
  more?: number;
};

// Everything about one rewrite request: its state, and how to start or stop it
export function useRewrite(initial: InitialRewrite = { edits: [] }) {
  const [view, setView] = useState<View>(
    (initial.open ?? initial.edits.length > 0) ? "reviewing" : "editing",
  );
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Edit[]>(initial.edits);
  const [credits, setCredits] = useState<ReferenceCredit[]>(
    initial.credits ?? [],
  );
  const [errorCode, setErrorCode] = useState<ClientErrorCode | null>(null);
  const [stopped, setStopped] = useState(initial.stopped ?? false);
  // The model stopped early: these are only the edits it wrote before that
  const [cutShort, setCutShort] = useState(initial.cutShort ?? false);
  // Set when these edits were made in the browser
  const [source, setSource] = useState<ReviewSource | null>(
    initial.source ?? null,
  );
  // What the free check found beyond the edits it shows
  const [more, setMore] = useState(initial.more ?? 0);
  const abort = useRef<AbortController | null>(null);
  // Edits seen so far, readable from the catch block without waiting for a render
  const seen = useRef<Edit[]>(initial.edits);

  // Leaving the page cancels the request, so nobody pays for more of an answer nobody reads
  useEffect(() => () => abort.current?.abort(), []);

  // A session has arrived since this refusal: "sign in to rewrite" is no longer true
  useEffect(() => {
    if (errorCode === "unauthorized")
      return onSignedIn(() => setErrorCode(null));
  }, [errorCode]);

  // `giveBack` puts back the caller's part of the review this request replaces, when that review
  // comes back
  async function start(input: RewriteInput, giveBack?: () => void) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const earlier = { edits, credits, stopped, cutShort, source, more };
    seen.current = [];

    setErrorCode(null);
    setStopped(false);
    setCutShort(false);
    setSource(null);
    setMore(0);
    setEdits([]);
    setCredits([]);
    // Stay on the editor until the first edit arrives: no empty review screen
    setView("editing");
    setLoading(true);

    try {
      const result = await fetchEdits(input, {
        signal: controller.signal,
        onStart: setCredits,
        onEdit: (edit) => {
          // Edits arrive in the model's order; the review and the result need reading order
          seen.current = [...seen.current, edit].sort(
            (a, b) => a.start - b.start,
          );
          setEdits(seen.current);
          setView("writing");
        },
      });
      setEdits(result.edits);
      setCredits(result.references);
      setCutShort(result.partial === true);
      setView("reviewing");
    } catch (error) {
      if (isAbort(error)) return;
      const code =
        error instanceof RewriteRequestError ? error.code : "server_error";
      // Edits already shown stay: an error after them is not a reason to lose them. A refusal is
      // different: the model declined the text, and the server keeps nothing of that answer.
      if (seen.current.length > 0 && code !== "refused") {
        setCutShort(true);
        setView("reviewing");
      } else {
        // Nothing came in place of the review this request was to replace: it is still the
        // reader's, behind the editor
        seen.current = earlier.edits;
        setEdits(earlier.edits);
        if (earlier.edits.length > 0) {
          setCredits(earlier.credits);
          setStopped(earlier.stopped);
          setCutShort(earlier.cutShort);
          setSource(earlier.source);
          setMore(earlier.more);
          giveBack?.();
        }
        setErrorCode(code);
        setView("editing");
      }
    } finally {
      if (abort.current === controller) setLoading(false);
      nudgeAllowance();
    }
  }

  function stop() {
    abort.current?.abort();
    setLoading(false);
    setStopped(true);
    setView("reviewing");
  }

  // Opens a review made in the browser: no request, so no attempt and no history row
  function show(found: Edit[], from: ReviewSource, notShown = 0) {
    abort.current?.abort();
    seen.current = found;
    setErrorCode(null);
    setLoading(false);
    setStopped(false);
    setCutShort(false);
    setSource(from);
    setMore(notShown);
    setEdits(found);
    setCredits([]);
    setView("reviewing");
  }

  // The review is over: back to the editor, with nothing left to return to
  function clear() {
    seen.current = [];
    setEdits([]);
    setCredits([]);
    setStopped(false);
    setCutShort(false);
    setSource(null);
    setMore(0);
    setView("editing");
  }

  return {
    view,
    loading,
    edits,
    credits,
    errorCode,
    stopped,
    cutShort,
    source,
    more,
    start,
    show,
    stop,
    clear,
    backToEditor: () => setView("editing"),
    // What a failed request said was about that request, and the reader has moved on from it. A
    // request to sign in stays true until a session arrives, which takes it away.
    backToReview: () => {
      setErrorCode((code) => (code === "unauthorized" ? code : null));
      setView("reviewing");
    },
  };
}
