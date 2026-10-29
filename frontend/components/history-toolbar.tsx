"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

const quiet =
  "rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed";

type Props = {
  count: number;
  query: string;
  onQuery: (value: string) => void;
  onClear: () => void;
  busy: boolean;
};

// Search box, entry count, and a delete-all that asks twice
export function HistoryToolbar({
  count,
  query,
  onQuery,
  onClear,
  busy,
}: Props) {
  const t = useTranslations("History");
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="relative min-w-0 flex-1 sm:max-w-xs">
        <span className="sr-only">{t("search")}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("search")}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm transition-colors placeholder:text-muted/70 focus:border-accent"
        />
      </label>

      <div className="flex items-center gap-3 text-sm text-muted">
        <span>{t("count", { count })}</span>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="sr-only">{t("clearConfirm", { count })}</span>
            <button
              type="button"
              onClick={() => {
                onClear();
                setConfirming(false);
              }}
              disabled={busy}
              className="rounded-md bg-remove-soft px-2 py-1 text-xs font-medium text-remove"
            >
              {t("clearYes")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={quiet}
            >
              {t("clearNo")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={quiet}
          >
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  );
}
