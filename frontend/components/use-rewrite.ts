"use client";

import { useEffect, useRef, useState } from "react";
import {
  fetchEdits,
  RewriteRequestError,
  type ClientErrorCode,
} from "@/lib/rewrite/client";
import type { RewriteInput } from "@/lib/rewrite/client";
import type { Edit, ReferenceCredit } from "@/lib/rewrite/types";

// editing: the text box. writing: the model is still answering and edits appear as they come.
// reviewing: the answer is complete (or was stopped).
export type View = "editing" | "writing" | "reviewing";

const isAbort = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

// Everything about one rewrite request: its state, and how to start or stop it
// `initial` shows an earlier rewrite straight away, without asking the model again
export function useRewrite(initial: Edit[] = []) {
  const [view, setView] = useState<View>(
    initial.length > 0 ? "reviewing" : "editing",
  );
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Edit[]>(initial);
  const [credits, setCredits] = useState<ReferenceCredit[]>([]);
  const [errorCode, setErrorCode] = useState<ClientErrorCode | null>(null);
  const [stopped, setStopped] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // Edits seen so far, readable from the catch block without waiting for a render
  const seen = useRef<Edit[]>(initial);

  // Leaving the page cancels the request, so nobody pays for an answer nobody reads
  useEffect(() => () => abort.current?.abort(), []);

  async function start(input: RewriteInput) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    seen.current = [];

    setErrorCode(null);
    setStopped(false);
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
          seen.current = [...seen.current, edit];
          setEdits(seen.current);
          setView("writing");
        },
      });
      setEdits(result.edits);
      setCredits(result.references);
      setView("reviewing");
    } catch (error) {
      if (isAbort(error)) return;
      // Edits already shown stay: an error after them is not a reason to lose them
      if (seen.current.length > 0) {
        setView("reviewing");
      } else {
        setErrorCode(
          error instanceof RewriteRequestError ? error.code : "server_error",
        );
        setView("editing");
      }
    } finally {
      if (abort.current === controller) setLoading(false);
    }
  }

  function stop() {
    abort.current?.abort();
    setLoading(false);
    setStopped(true);
    setView("reviewing");
  }

  return {
    view,
    loading,
    edits,
    credits,
    errorCode,
    stopped,
    start,
    stop,
    backToEditor: () => setView("editing"),
  };
}
