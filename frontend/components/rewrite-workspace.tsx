"use client";

import { motion } from "motion/react";
import { ArrowLeft, BookOpen, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { DiffView } from "@/components/diff-view";
import { DEFAULT_OPTIONS, type Options } from "@/components/rewrite-options";
import { ResultPanel } from "@/components/result-panel";
import { ReviewBar } from "@/components/review-bar";
import { TextEditor } from "@/components/text-editor";
import { useRewrite } from "@/components/use-rewrite";
import { applyEdits, type Decision } from "@/lib/rewrite/apply";
import { takeReopen } from "@/lib/rewrite/reopen";
import {
  isTyping,
  moveFocus,
  nextPending,
  reviewKey,
} from "@/lib/rewrite/keys";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95";

export function RewriteWorkspace() {
  const t = useTranslations("Review");
  const tErrors = useTranslations("Errors");
  const tEditor = useTranslations("Editor");
  const locale = useLocale();
  // Coming from the history page: that rewrite is shown again, edits included.
  // Read once, as the component is first created.
  const [reopened] = useState(() =>
    typeof window === "undefined" ? null : takeReopen(),
  );
  const rewrite = useRewrite(reopened?.edits);
  const { view, edits, credits } = rewrite;

  const [text, setText] = useState(reopened?.text ?? "");
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const reviewRef = useRef<HTMLElement>(null);

  // The review opens below the page header: bring it into view, unless motion is reduced.
  // Only when it first opens, not on every edit that arrives.
  const inReview = view !== "editing";
  useEffect(() => {
    if (!inReview) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    reviewRef.current?.scrollIntoView?.({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }, [inReview]);

  // A, R, J and K work once the answer is complete, and never while typing in a field
  const reviewing = view === "reviewing";
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      const key = reviewKey(event);
      if (!key || isTyping(event.target)) return;
      event.preventDefault();

      if (key === "next" || key === "previous") {
        const to = moveFocus(edits, activeId, key);
        setActiveId(to);
        if (to) {
          document
            .getElementById(`review-${to}`)
            ?.scrollIntoView?.({ block: "nearest" });
        }
        return;
      }
      const id = activeId ?? edits[0]?.id;
      if (!id) return;
      const decision: Decision = key === "accept" ? "accepted" : "rejected";
      const next = { ...decisions, [id]: decision };
      setDecisions(next);
      const to = nextPending(edits, next, id);
      setActiveId(to);
      document
        .getElementById(`review-${to}`)
        ?.scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reviewing, edits, activeId, decisions]);

  function submit() {
    setDecisions({});
    setActiveId(null);
    rewrite.start({
      text,
      locale,
      strength: options.strength,
      voice: options.voice,
    });
  }

  if (view === "editing") {
    return (
      <TextEditor
        value={text}
        onChange={setText}
        onSubmit={submit}
        onExample={() => setText(tEditor("exampleText"))}
        options={options}
        onOptionsChange={setOptions}
        status={rewrite.loading ? "loading" : "idle"}
        error={rewrite.errorCode && tErrors(rewrite.errorCode)}
      />
    );
  }

  const writing = view === "writing";
  const accepted = edits.filter((e) => decisions[e.id] === "accepted").length;
  const authors = [...new Set(credits.map((c) => c.author))].join(", ");
  const decideAll = (decision: Decision) =>
    setDecisions(Object.fromEntries(edits.map((e) => [e.id, decision])));

  return (
    <motion.section
      ref={reviewRef}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="flex scroll-mt-6 flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-serif text-2xl font-medium">{t("title")}</h2>
        {writing ? (
          <button type="button" onClick={rewrite.stop} className={quiet}>
            <Square className="size-3.5" aria-hidden />
            {tEditor("stop")}
          </button>
        ) : (
          <button
            type="button"
            onClick={rewrite.backToEditor}
            className={quiet}
          >
            <ArrowLeft className="size-4" aria-hidden />
            {t("backToEditor")}
          </button>
        )}
      </div>

      {authors && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <BookOpen className="size-3.5 shrink-0" aria-hidden />
          {t("inspiredBy", { authors })}
        </p>
      )}

      {rewrite.stopped && (
        <p role="status" className="text-sm text-muted">
          {t("stopped")}
        </p>
      )}

      {edits.length === 0 && !writing ? (
        <p className="rounded-xl border border-border bg-surface p-5 shadow-card">
          {t("noEdits")}
        </p>
      ) : (
        <>
          <ReviewBar
            writing={writing}
            total={edits.length}
            accepted={accepted}
            onAcceptAll={() => decideAll("accepted")}
            onRejectAll={() => decideAll("rejected")}
          />
          <DiffView
            text={text}
            edits={edits}
            activeId={reviewing ? activeId : null}
            decisions={decisions}
            onDecide={(id, decision) =>
              setDecisions((current) => ({ ...current, [id]: decision }))
            }
          />
          <ResultPanel result={applyEdits(text, edits, decisions)} />
          {reviewing && edits.length > 0 && (
            <p className="text-xs text-muted">{t("shortcuts")}</p>
          )}
        </>
      )}
    </motion.section>
  );
}
