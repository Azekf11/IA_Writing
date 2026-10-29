"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

const button =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40";

type Props = {
  writing: boolean;
  total: number;
  accepted: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
};

// Progress while the answer arrives or is decided, and the two bulk actions
export function ReviewBar({
  writing,
  total,
  accepted,
  onAcceptAll,
  onRejectAll,
}: Props) {
  const t = useTranslations("Review");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3" aria-live="polite">
        <p className="text-sm text-muted">
          {writing
            ? t("found", { count: total })
            : t("summary", { accepted, total })}
        </p>
        <div
          className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2"
          aria-hidden
        >
          <div
            className={cn(
              "h-full rounded-full bg-accent transition-[width] duration-300",
              writing && "animate-pulse",
            )}
            style={{
              width: writing
                ? "100%"
                : `${(accepted / Math.max(total, 1)) * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAcceptAll}
          disabled={writing}
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
          onClick={onRejectAll}
          disabled={writing}
          className={cn(button, "border border-border hover:bg-surface-2")}
        >
          {t("rejectAll")}
        </button>
      </div>
    </div>
  );
}
