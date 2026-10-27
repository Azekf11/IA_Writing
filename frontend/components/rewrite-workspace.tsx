"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { DiffView } from "@/components/diff-view";
import { TextEditor } from "@/components/text-editor";
import { applyEdits, type Decision } from "@/lib/rewrite/apply";
import { fetchEdits, RewriteRequestError } from "@/lib/rewrite/client";
import type { ClientErrorCode } from "@/lib/rewrite/client";
import type { Edit } from "@/lib/rewrite/types";

type View = "editing" | "loading" | "reviewing";

export function RewriteWorkspace() {
  const t = useTranslations("Review");
  const tErrors = useTranslations("Errors");

  const [text, setText] = useState("");
  const [view, setView] = useState<View>("editing");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [errorCode, setErrorCode] = useState<ClientErrorCode | null>(null);
  const [copied, setCopied] = useState(false);

  async function rewrite() {
    setView("loading");
    setErrorCode(null);
    try {
      const result = await fetchEdits(text);
      setEdits(result.edits);
      setDecisions({});
      setView("reviewing");
    } catch (error) {
      setErrorCode(
        error instanceof RewriteRequestError ? error.code : "server_error",
      );
      setView("editing");
    }
  }

  function decideAll(decision: Decision) {
    setDecisions(Object.fromEntries(edits.map((e) => [e.id, decision])));
  }

  async function copy(result: string) {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the text stays selectable on screen
    }
  }

  if (view !== "reviewing") {
    return (
      <TextEditor
        value={text}
        onChange={setText}
        onSubmit={rewrite}
        status={view === "loading" ? "loading" : "idle"}
        error={errorCode && tErrors(errorCode)}
      />
    );
  }

  const result = applyEdits(text, edits, decisions);
  const accepted = edits.filter((e) => decisions[e.id] === "accepted").length;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("title")}</h2>
        <button
          type="button"
          onClick={() => setView("editing")}
          className="text-sm underline"
        >
          {t("backToEditor")}
        </button>
      </div>

      {edits.length === 0 ? (
        <p className="rounded-lg border border-foreground/15 p-4">
          {t("noEdits")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-foreground/60" aria-live="polite">
              {t("summary", { accepted, total: edits.length })}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => decideAll("accepted")}
                className="rounded-md bg-foreground px-3 py-1 font-medium text-background"
              >
                {t("acceptAll")}
              </button>
              <button
                type="button"
                onClick={() => decideAll("rejected")}
                className="rounded-md border border-foreground/30 px-3 py-1 font-medium"
              >
                {t("rejectAll")}
              </button>
            </div>
          </div>

          <DiffView
            text={text}
            edits={edits}
            decisions={decisions}
            onDecide={(id, decision) =>
              setDecisions((current) => ({ ...current, [id]: decision }))
            }
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t("result")}</h3>
              <button
                type="button"
                onClick={() => copy(result)}
                className="rounded-md border border-foreground/30 px-3 py-1 text-sm font-medium"
              >
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            <p
              data-testid="result"
              className="whitespace-pre-wrap rounded-lg bg-foreground/5 p-3 leading-relaxed"
            >
              {result}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
