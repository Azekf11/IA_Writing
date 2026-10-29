"use client";

import { motion } from "motion/react";
import { ArrowLeft, BookOpen, Check, Copy, Sparkles } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DiffView } from "@/components/diff-view";
import { TextEditor } from "@/components/text-editor";
import { cn } from "@/lib/cn";
import { applyEdits, type Decision } from "@/lib/rewrite/apply";
import { fetchEdits, RewriteRequestError } from "@/lib/rewrite/client";
import type { ClientErrorCode } from "@/lib/rewrite/client";
import type { Edit, ReferenceCredit } from "@/lib/rewrite/types";

type View = "editing" | "loading" | "reviewing";

const button =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all active:scale-95";

export function RewriteWorkspace() {
  const t = useTranslations("Review");
  const tErrors = useTranslations("Errors");
  const tEditor = useTranslations("Editor");
  const locale = useLocale();

  const [text, setText] = useState("");
  const [view, setView] = useState<View>("editing");
  const [edits, setEdits] = useState<Edit[]>([]);
  const [credits, setCredits] = useState<ReferenceCredit[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [errorCode, setErrorCode] = useState<ClientErrorCode | null>(null);
  const [copied, setCopied] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);

  // The review opens below the page header: bring it into view, unless motion is reduced
  useEffect(() => {
    if (view !== "reviewing") return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    reviewRef.current?.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [view]);

  async function rewrite() {
    setView("loading");
    setErrorCode(null);
    try {
      const result = await fetchEdits(text, locale);
      setEdits(result.edits);
      setCredits(result.references ?? []);
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
        onExample={() => setText(tEditor("exampleText"))}
        status={view === "loading" ? "loading" : "idle"}
        error={errorCode && tErrors(errorCode)}
      />
    );
  }

  const result = applyEdits(text, edits, decisions);
  const accepted = edits.filter((e) => decisions[e.id] === "accepted").length;
  const authors = [...new Set(credits.map((c) => c.author))].join(", ");

  return (
    <motion.section
      ref={reviewRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex scroll-mt-6 flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Sparkles className="size-5 text-accent-text" aria-hidden />
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={() => setView("editing")}
          className={cn(button, "border border-border hover:bg-surface-2")}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t("backToEditor")}
        </button>
      </div>

      {authors && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <BookOpen className="size-3.5 shrink-0" aria-hidden />
          {t("inspiredBy", { authors })}
        </p>
      )}

      {edits.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-5 shadow-card">
          {t("noEdits")}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3" aria-live="polite">
              <p className="text-sm text-muted">
                {t("summary", { accepted, total: edits.length })}
              </p>
              <div
                className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"
                aria-hidden
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${(accepted / edits.length) * 100}%` }}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => decideAll("accepted")}
                className={cn(
                  button,
                  "bg-accent text-accent-foreground hover:brightness-110",
                )}
              >
                <Check className="size-4" aria-hidden />
                {t("acceptAll")}
              </button>
              <button
                type="button"
                onClick={() => decideAll("rejected")}
                className={cn(
                  button,
                  "border border-border hover:bg-surface-2",
                )}
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

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("result")}</h3>
              <button
                type="button"
                onClick={() => copy(result)}
                className={cn(
                  button,
                  "border border-border hover:bg-surface-2",
                )}
              >
                {copied ? (
                  <Check className="size-4 text-add" aria-hidden />
                ) : (
                  <Copy className="size-4" aria-hidden />
                )}
                {copied ? t("copied") : t("copy")}
              </button>
            </div>
            <p
              data-testid="result"
              className="whitespace-pre-wrap leading-relaxed"
            >
              {result}
            </p>
          </div>
        </>
      )}
    </motion.section>
  );
}
