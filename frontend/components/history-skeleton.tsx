import { useFormatter, useTranslations } from "next-intl";
import { HISTORY_PAGE, ROW_DATE } from "@/lib/history";

// A row's date and count of edits, of a usual length
const SAMPLE_DATE = new Date("2026-11-13T10:00:00Z");
const SAMPLE_EDITS = 3;

const bar = "skeleton absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full";

// The list before it arrives: the same search box and the same rows, so the toolbar keeps its place
// when it does. A row holds three lines of text, the most a row shows: a shorter text closes up and
// the rows below it move up, and the note above a history longer than one page moves every row down.
export function HistorySkeleton() {
  const t = useTranslations("History");
  const format = useFormatter();

  return (
    <div aria-busy className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-40 flex-1 rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm sm:max-w-xs max-sm:text-base">
          &nbsp;
        </div>
        {/* The toolbar's own words, unseen, so that the line wraps where the list's does, in either
            language. The count is a full first page's. */}
        <div className="relative flex items-center gap-3 text-sm">
          <span className="invisible">
            {t("count", { count: HISTORY_PAGE })}
          </span>
          <span className="invisible px-2 py-1 text-xs font-medium">
            {t("clear")}
          </span>
          <div className={`${bar} h-4`} />
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border border-y border-border">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex flex-col gap-2 py-4">
            {/* A row's own words too: on a phone its first line takes two */}
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="relative">
                <span className="invisible">
                  {format.dateTime(SAMPLE_DATE, ROW_DATE)} ·{" "}
                  {t("edits", { count: SAMPLE_EDITS })}
                </span>
                <span className={`${bar} h-3`} />
              </span>
              <span className="relative flex gap-1">
                <span className="invisible px-2 py-1 font-medium">
                  {t("reopen")}
                </span>
                <span className="invisible inline-flex items-center gap-1 px-2 py-1 font-medium">
                  <span className="size-3.5" />
                  {t("delete")}
                </span>
                <span className={`${bar} h-3`} />
              </span>
            </div>
            {/* The most lines a row shows of its text */}
            <div className="flex h-[3lh] flex-col justify-around leading-relaxed">
              <div className="skeleton h-3 w-full rounded-full" />
              <div className="skeleton h-3 w-full rounded-full" />
              <div className="skeleton h-3 w-2/3 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
