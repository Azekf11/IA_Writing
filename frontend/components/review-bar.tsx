"use client";

import { ArrowDown, Check, Copy, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";

const button =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40";

// On a phone the two buttons of the sticky row are their icons, so that it stays one row
const iconOnPhone = "border border-border hover:bg-surface-2 max-sm:p-2.5";

type Props = {
  writing: boolean;
  total: number;
  accepted: number;
  // Edits still waiting for a decision
  pending: number;
  canUndo: boolean;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onUndo: () => void;
  onNext: () => void;
  // Says whether the text reached the clipboard
  onCopy: () => Promise<boolean>;
};

// Progress while the answer arrives or is decided, stuck to the top of the screen with the two things
// a long review needs at hand; below it, in the flow of the page, the bulk actions and the way back
// from a decision. Two children of the review rather than one box: a sticky element only travels
// within its parent. The cards' scroll margin leaves room for the sticky row, so it has to stay one
// row. A bulk button's label changes under the pointer, and from "the rest" to "all" a second click
// would reach the edits the first one left alone: only the first click counts.
export function ReviewBar({
  writing,
  total,
  accepted,
  pending,
  canUndo,
  onAcceptAll,
  onRejectAll,
  onUndo,
  onNext,
  onCopy,
}: Props) {
  const t = useTranslations("Review");
  const [copied, setCopied] = useState(false);
  const rest = pending > 0 && pending < total;
  const rejected = total - accepted - pending;
  const nothingNext = writing || pending === 0;

  async function copy() {
    if (!(await onCopy())) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 overflow-hidden rounded-xl border border-border bg-surface py-2 pl-4 pr-2 shadow-card">
        <p className="min-w-0 text-xs text-muted sm:text-sm">
          {writing
            ? t("found", { count: total })
            : t("summary", { accepted, rejected, pending })}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            // Stays on the page and focusable, like the undo control below
            onClick={nothingNext ? undefined : onNext}
            aria-disabled={nothingNext}
            className={cn(
              button,
              iconOnPhone,
              "aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
            )}
          >
            <ArrowDown className="size-4" aria-hidden />
            <span className="max-sm:sr-only">{t("next")}</span>
          </button>
          <button
            type="button"
            onClick={firstClick(copy)}
            className={cn(button, iconOnPhone)}
          >
            {copied ? (
              <Check className="size-4 text-add" aria-hidden />
            ) : (
              <Copy className="size-4" aria-hidden />
            )}
            <span className="max-sm:sr-only">
              {copied ? t("copied") : t("copyShort")}
            </span>
          </button>
        </div>
        <div
          className="absolute inset-x-0 bottom-0 h-1 bg-surface-2"
          aria-hidden
        >
          <div
            className={cn(
              "h-full bg-accent transition-[width] duration-300 forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none",
              writing && "motion-safe:animate-pulse",
            )}
            style={{
              width: writing
                ? "100%"
                : `${((total - pending) / Math.max(total, 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            // Stays on the page and focusable with nothing to undo, or the keyboard would lose its place
            onClick={firstClick(() => {
              if (canUndo) onUndo();
            })}
            aria-disabled={!canUndo}
            className={cn(
              button,
              "border border-border hover:bg-surface-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40",
            )}
          >
            <Undo2 className="size-4" aria-hidden />
            {t("undoLast")}
          </button>
          <button
            type="button"
            onClick={firstClick(onAcceptAll)}
            disabled={writing}
            className={cn(
              button,
              "bg-accent text-accent-foreground hover:bg-accent-hover",
            )}
          >
            <Check className="size-4" aria-hidden />
            {t(rest ? "acceptRest" : "acceptAll")}
          </button>
          <button
            type="button"
            onClick={firstClick(onRejectAll)}
            disabled={writing}
            className={cn(button, "border border-border hover:bg-surface-2")}
          >
            {t(rest ? "rejectRest" : "rejectAll")}
          </button>
        </div>
        {!writing && pending > 0 && (
          <p className="text-xs text-muted">
            {t("keepsOriginal", { count: pending })}
          </p>
        )}
        {!writing && (
          // No keyboard to speak of on a device that cannot hover
          <p className="text-xs text-muted [@media(hover:none)]:hidden">
            {t("shortcuts")}
          </p>
        )}
      </div>
    </>
  );
}
