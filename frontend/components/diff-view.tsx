"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { toSegments, type Decision } from "@/lib/rewrite/apply";
import type { Edit } from "@/lib/rewrite/types";

type Props = {
  text: string;
  edits: Edit[];
  decisions: Record<string, Decision>;
  onDecide: (id: string, decision: Decision) => void;
};

// Original text with each suggested edit shown inline for review
export function DiffView({ text, edits, decisions, onDecide }: Props) {
  const t = useTranslations("Review");

  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {toSegments(text, edits).map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <span key={index} className="text-muted">
              {segment.text}
            </span>
          );
        }

        const { edit } = segment;
        const decision = decisions[edit.id] ?? "pending";
        const accepted = decision === "accepted";
        const rejected = decision === "rejected";

        return (
          <span
            key={edit.id}
            data-decision={decision}
            className={cn(
              "my-2 block rounded-xl border bg-surface p-4 transition-colors",
              accepted && "border-add/50",
              rejected && "border-border opacity-70",
              decision === "pending" && "border-border shadow-card",
            )}
          >
            <span className="block text-sm">
              <span className="sr-only">{t("removed")}: </span>
              <span
                className={cn(
                  "rounded bg-remove-soft px-1 py-0.5 text-remove",
                  accepted && "line-through",
                  rejected && "bg-transparent text-foreground",
                )}
              >
                {edit.original}
              </span>
            </span>
            <span className="mt-2 block text-sm">
              <span className="sr-only">{t("added")}: </span>
              <span
                className={cn(
                  "rounded bg-add-soft px-1 py-0.5 text-add",
                  rejected && "bg-transparent text-muted line-through",
                )}
              >
                {edit.replacement || t("emptyReplacement")}
              </span>
            </span>
            <span className="mt-2 block text-xs text-muted">{edit.reason}</span>
            <span className="mt-3 flex gap-2">
              {decision === "pending" ? (
                <>
                  <button
                    type="button"
                    onClick={() => onDecide(edit.id, "accepted")}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-all hover:brightness-110 active:scale-95"
                  >
                    <Check className="size-3.5" aria-hidden />
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(edit.id, "rejected")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2"
                  >
                    <X className="size-3.5" aria-hidden />
                    {t("reject")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onDecide(edit.id, "pending")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2"
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t("undo")}
                </button>
              )}
            </span>
          </span>
        );
      })}
    </div>
  );
}
