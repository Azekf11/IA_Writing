"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef } from "react";
import { useTypedEarly } from "@/components/use-typed-early";

const quiet =
  "rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:cursor-not-allowed";

type Props = {
  count: number;
  query: string;
  onQuery: (value: string) => void;
  // Whether Delete all is asking. The list holds it, and says the question on its status line.
  confirming: boolean;
  onConfirming: (asking: boolean) => void;
  onClear: () => void;
  busy: boolean;
  searchId: string;
};

// Search box, entry count, and a delete-all that asks twice. The question gets its own line:
// nothing opens under the pointer, so a double click cannot answer it, and it says that every
// entry goes, including those a search has hidden.
export function HistoryToolbar({
  count,
  query,
  onQuery,
  confirming,
  onConfirming,
  onClear,
  busy,
  searchId,
}: Props) {
  const t = useTranslations("History");
  const box = useTypedEarly<HTMLInputElement>(query, onQuery);
  const clearAll = useRef<HTMLButtonElement>(null);

  // The question's line goes either way: the keyboard goes back to the button that opened it, which
  // stays on the page while the answer runs
  const close = () => {
    onConfirming(false);
    clearAll.current?.focus();
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <label className="relative min-w-40 flex-1 sm:max-w-xs">
        <span className="sr-only">{t("search")}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
        <input
          ref={box}
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={t("search")}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm transition-colors placeholder:text-muted focus:border-accent max-sm:text-base"
        />
      </label>

      <div className="flex items-center gap-3 text-sm text-muted">
        <span>{t("count", { count })}</span>
        <button
          ref={clearAll}
          type="button"
          onClick={() => onConfirming(true)}
          className={quiet}
        >
          {t("clear")}
        </button>
      </div>

      {confirming && (
        <div
          role="group"
          aria-label={t("clear")}
          className="flex w-full flex-wrap items-center justify-end gap-2 text-sm"
        >
          <span>{t("clearConfirm", { count })}</span>
          <button
            type="button"
            onClick={() => {
              onClear();
              close();
            }}
            disabled={busy}
            className="rounded-md bg-remove-soft px-2 py-1 text-xs font-medium text-remove"
          >
            {t("clearYes")}
          </button>
          <button type="button" onClick={close} className={quiet}>
            {t("clearNo")}
          </button>
        </div>
      )}
    </div>
  );
}
