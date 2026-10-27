"use client";

import { useTranslations } from "next-intl";
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
          return <span key={index}>{segment.text}</span>;
        }

        const { edit } = segment;
        const decision = decisions[edit.id] ?? "pending";
        const accepted = decision === "accepted";
        const rejected = decision === "rejected";

        return (
          <span
            key={edit.id}
            data-decision={decision}
            className="my-1 block rounded-lg border border-foreground/15 p-3"
          >
            <span className="block text-sm">
              <span className="sr-only">{t("removed")}: </span>
              <span
                className={
                  accepted
                    ? "bg-red-500/15 text-red-600 line-through dark:text-red-400"
                    : rejected
                      ? undefined
                      : "bg-red-500/10"
                }
              >
                {edit.original}
              </span>
            </span>
            <span className="mt-1 block text-sm">
              <span className="sr-only">{t("added")}: </span>
              <span
                className={
                  rejected
                    ? "text-foreground/40 line-through"
                    : "bg-green-500/15 text-green-700 dark:text-green-400"
                }
              >
                {edit.replacement || t("emptyReplacement")}
              </span>
            </span>
            <span className="mt-1 block text-xs text-foreground/60">
              {edit.reason}
            </span>
            <span className="mt-2 flex gap-2">
              {decision === "pending" ? (
                <>
                  <button
                    type="button"
                    onClick={() => onDecide(edit.id, "accepted")}
                    className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background"
                  >
                    {t("accept")}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDecide(edit.id, "rejected")}
                    className="rounded-md border border-foreground/30 px-3 py-1 text-xs font-medium"
                  >
                    {t("reject")}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => onDecide(edit.id, "pending")}
                  className="rounded-md border border-foreground/30 px-3 py-1 text-xs font-medium"
                >
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
