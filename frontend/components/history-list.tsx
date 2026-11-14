"use client";

import { Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { HistoryToolbar } from "@/components/history-toolbar";
import { useEnterOnce } from "@/components/use-enter-once";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import {
  HISTORY_COLUMNS,
  HISTORY_PAGE,
  ROW_DATE,
  historyItem,
  olderThan,
  type HistoryItem,
} from "@/lib/history";
import { stashReopen } from "@/lib/rewrite/reopen";
import { foldForSearch } from "@/lib/text";

const quiet =
  "rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-2 hover:text-foreground aria-disabled:cursor-not-allowed";

// A large script that only these actions use: it is fetched then
async function rewrites() {
  const { createClient } = await import("@/lib/supabase/browser");
  return createClient()!.from("rewrites");
}

// When that script cannot be fetched, the same as a request that got no answer
const unreachable = { data: null, error: true, status: 0, count: null };

type Failure =
  | "deleteFailed"
  | "clearFailed"
  | "staleDelete"
  | "reopenFailed"
  | "loadMoreFailed";

// A failure is said beside what failed, or the list could put it out of sight: at the top, by the
// Load more button, or on a row, which goes by its id
const AT_TOP = "top";
const AT_MORE = "more";

// What the status line says about the reader's last step: a question while it is open, or what a
// delete did
type Said = "askRow" | "askAll" | "deleted" | "cleared";

// What a new answer from the server leaves in the list. It only ever holds the first page, so the
// rows the reader went on to load are kept after the row it now ends on. An answer that holds the
// whole history leaves nothing to keep.
function withLoaded(items: HistoryItem[], total: number, rows: HistoryItem[]) {
  if (items.length >= total) return items;
  const end = rows.findIndex((row) => row.id === items.at(-1)?.id);
  return end === -1 ? items : [...items, ...rows.slice(end + 1)];
}

export function HistoryList({
  owner,
  items,
  total: storedTotal = items.length,
}: {
  // The account the page was rendered for. The browser sends whichever session its cookie holds
  // now, so a tab left open after signing in as someone else must not act on that other account.
  owner: string;
  items: HistoryItem[];
  // How many entries the account holds: the page only loads the most recent ones
  total?: number;
}) {
  const t = useTranslations("History");
  const format = useFormatter();
  const router = useRouter();
  const searchId = useId();
  const emptyId = useId();
  const [rows, setRows] = useState(items);
  const [total, setTotal] = useState(storedTotal);
  const [failed, setFailed] = useState<{
    message: Failure;
    at: string;
  } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  // Delete all's question, which the toolbar shows and the status line says
  const [askingAll, setAskingAll] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  // The rows the last Load more brought, in their order, when they may take the focus
  const [loaded, setLoaded] = useState<string[] | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  // Where the keyboard goes once a delete has taken away the button it was on
  const [moveTo, setMoveTo] = useState<{ id: string } | null>(null);
  const [query, setQuery] = useState("");
  // A new answer from the server replaces its page, and leaves the search as it is
  const [served, setServed] = useState(items);
  if (items !== served) {
    setServed(items);
    setRows((current) => withLoaded(items, storedTotal, current));
    setTotal(storedTotal);
  }
  // An empty history has no toolbar: its question must not come back open with the next entries
  if (total === 0 && askingAll) setAskingAll(false);

  const searchable = useMemo(
    () => new Map(rows.map((row) => [row.id, foldForSearch(row.original)])),
    [rows],
  );
  const needle = foldForSearch(query.trim());
  const shown = needle
    ? rows.filter((row) => searchable.get(row.id)?.includes(needle))
    : rows;

  // A delete or a load takes the keyboard to a row's Reopen while the key can still be down: its
  // repeats would open that row in the editor
  useEnterOnce();

  // The button that was pressed ends up below what it brought, or goes with the last page: the
  // keyboard carries on from the first new row the search shows. When it shows none of them, the
  // focus stays where it is while the button is there, and goes to the search box once it has gone.
  // Only from that button, or from the page: the focus falls there when the button goes, and stays
  // there after a click in a browser that does not focus a clicked button, such as Safari. A reader
  // who has put the focus somewhere else while the load ran keeps it there. A click on text leaves
  // it on the page too, and loadMore then asks for no move.
  useEffect(() => {
    const at = document.activeElement;
    if (!loaded || (at !== more.current && at !== document.body)) return;
    const row = loaded
      .map((id) => document.getElementById(`reopen-${id}`))
      .find((button) => button !== null);
    if (row) row.focus({ preventScroll: true });
    else if (!more.current) document.getElementById(searchId)?.focus();
  }, [loaded, searchId]);

  // The neighbour can have gone too, if an answer from the server came first: then the search box,
  // there while the history holds anything, or else the empty history's line. Only from the page:
  // the focus falls there when what was pressed goes, and stays there after a click in a browser
  // that does not focus a clicked button, such as Safari. A reader who has put it somewhere else
  // while the delete ran keeps it there; a click on text leaves it on the page, and the delete then
  // asks for no move.
  useEffect(() => {
    if (!moveTo || document.activeElement !== document.body) return;
    const target =
      document.getElementById(moveTo.id) ??
      document.getElementById(searchId) ??
      document.getElementById(emptyId);
    target?.focus();
  }, [moveTo, searchId, emptyId]);

  // What a delete did has been said: a search counts its matches again. The box reads what was
  // typed before the scripts arrived through this, so it stays the same function.
  const search = useCallback((value: string) => {
    setQuery(value);
    setSaid((current) =>
      current === "deleted" || current === "cleared" ? null : current,
    );
  }, []);

  function askAll(asking: boolean) {
    setAskingAll(asking);
    setSaid((current) =>
      asking ? "askAll" : current === "askAll" ? null : current,
    );
  }

  // Say so when it fails: a silent no-op looks like a broken button. A 401 means the session ended
  // elsewhere, so the page has to follow. Nothing else asks for the page again: offline, that
  // would replace it with the browser's error page.
  function requestFailed(message: Failure, status: number, at: string) {
    setFailed({ message, at });
    if (status === 401) router.refresh();
  }

  // A delete that matched no row comes from a page the session has moved on from: another account
  // signed in here, or the row went in another tab. Nothing was deleted, and pressing again cannot
  // help. A reload shows what is there; asking for the page here would show the other account's
  // rows in place of these, with nothing said.
  async function remove(id: string) {
    // The row that takes its place, or the one before when it was the last one shown
    const at = shown.findIndex((row) => row.id === id);
    const neighbour = shown[at + 1] ?? shown[at - 1];
    setFailed(null);
    setPending(id);
    // As in loadMore: a click on text leaves the focus on the page, as a click on Yes does in a
    // browser that does not focus it, such as Safari, and as Yes does when an answer from the
    // server takes the row first: only a press while the delete runs tells them apart
    let pressed = false;
    const press = () => {
      pressed = true;
    };
    document.addEventListener("mousedown", press, true);
    const { error, status, count } = await rewrites()
      .then((table) =>
        table.delete({ count: "exact" }).in("id", [id]).eq("user_id", owner),
      )
      .catch(() => unreachable);
    document.removeEventListener("mousedown", press, true);
    // Read before this delete takes the row away, and with it the focus when it is on Yes
    const leftNowhere = pressed && document.activeElement === document.body;
    setPending(null);
    if (error) return requestFailed("deleteFailed", status, id);
    if (count === 0) return requestFailed("staleDelete", status, id);
    setAsking(null);
    setRows((current) => current.filter((row) => row.id !== id));
    setTotal((count) => count - 1);
    setSaid("deleted");
    if (!leftNowhere) {
      setMoveTo({ id: neighbour ? `reopen-${neighbour.id}` : searchId });
    }
    // Older entries can move up, and the browser's copy of this page must not bring the row back
    router.refresh();
  }

  // Every entry of the account, loaded or not. The filter is also what the API asks for: it
  // refuses a delete without one.
  async function clear() {
    setFailed(null);
    setPending("all");
    // As in remove: a click on text while it runs leaves the focus on the page, as Delete all does
    // when an answer from the server empties the history first: only a press tells them apart
    let pressed = false;
    const press = () => {
      pressed = true;
    };
    document.addEventListener("mousedown", press, true);
    const { error, status, count } = await rewrites()
      .then((table) => table.delete({ count: "exact" }).eq("user_id", owner))
      .catch(() => unreachable);
    document.removeEventListener("mousedown", press, true);
    // Read before this delete empties the history, which takes Delete all and the focus away
    const leftNowhere = pressed && document.activeElement === document.body;
    setPending(null);
    if (error) return requestFailed("clearFailed", status, AT_TOP);
    if (count === 0) return requestFailed("staleDelete", status, AT_TOP);
    setAsking(null);
    setRows([]);
    setTotal(0);
    setSaid("cleared");
    if (!leftNowhere) setMoveTo({ id: emptyId });
    router.refresh();
  }

  async function loadMore() {
    const last = rows.at(-1);
    if (!last) return;
    setFailed(null);
    setPending("more");
    // A click on text leaves the focus on the page, as this button does when it goes with the last
    // page, and as a click on it does in a browser that does not focus it, such as Safari: only a
    // press while the load runs tells them apart. One that leaves the focus on this button, such as
    // on the scrollbar, still lets the keyboard carry on; after a click that left it on the page,
    // any press stops it.
    let pressed = false;
    const press = () => {
      pressed = true;
    };
    document.addEventListener("mousedown", press, true);
    const { data, error, status } = await rewrites()
      .then((table) =>
        table
          .select(HISTORY_COLUMNS)
          .eq("user_id", owner)
          .or(olderThan(last))
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(HISTORY_PAGE),
      )
      .catch(() => unreachable);
    document.removeEventListener("mousedown", press, true);
    // Read while the button is still there: the last page takes it away, and the focus with it
    const leftNowhere = pressed && document.activeElement === document.body;
    setPending(null);
    if (error || !data) {
      return requestFailed("loadMoreFailed", status, AT_MORE);
    }
    const fresh = data.map(historyItem);
    // A refresh can land while this runs and bring the first of these rows into its own page
    const isNew = (known: HistoryItem[]) => (row: HistoryItem) =>
      !known.some(({ id }) => id === row.id);
    setRows((current) => [...current, ...fresh.filter(isNew(current))]);
    // A short page is the end of the list, whatever the count said when the page was drawn
    if (fresh.length < HISTORY_PAGE) {
      setTotal(rows.length + fresh.filter(isNew(rows)).length);
    }
    if (fresh.length > 0) {
      if (!leftNowhere) setLoaded(fresh.map((row) => row.id));
    } else {
      // Nothing where the count promised more: another account may have taken this tab's session
      router.refresh();
    }
  }

  // Nothing else can carry the rewrite to the editor: without this, it would open on something else
  function reopen(row: HistoryItem) {
    setFailed(null);
    if (stashReopen(row.original, row.edits)) router.push("/");
    else setFailed({ message: "reopenFailed", at: row.id });
  }

  // Only one action at a time. The buttons stay focusable meanwhile, or the keyboard would lose its
  // place in the list; the second click of a double click never counts (firstClick).
  const whenIdle = (action: () => void) =>
    firstClick(() => {
      if (pending === null) action();
    });

  const failure = failed && (
    <p
      role="alert"
      className="rounded-lg bg-remove-soft px-3 py-2 text-sm text-remove"
    >
      {t(failed.message)}
    </p>
  );

  // On the page before it has anything to say, and still there once the history is empty: many
  // screen readers do not announce a line that arrives together with its text. A question is said
  // while it is open and in sight, what a delete did until the reader searches, and the matches of
  // a search otherwise.
  const announced =
    said === "askRow" && shown.some((row) => row.id === asking)
      ? t("clearConfirm", { count: 1 })
      : said === "askAll" && askingAll
        ? t("clearConfirm", { count: total })
        : said === "deleted" || said === "cleared"
          ? t(said)
          : needle
            ? t("matches", { count: shown.length })
            : "";

  if (total === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 border-t border-border pt-8">
          {/* Where the keyboard goes once the last entry has gone */}
          <p id={emptyId} tabIndex={-1} className="font-medium outline-none!">
            {t("empty")}
          </p>
          <p className="text-sm text-muted">{t("emptyHint")}</p>
        </div>
        <p role="status" className="sr-only">
          {announced}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <HistoryToolbar
        count={total}
        query={query}
        onQuery={search}
        confirming={askingAll}
        onConfirming={askAll}
        onClear={clear}
        busy={pending !== null}
        searchId={searchId}
      />
      <p role="status" className="sr-only">
        {announced}
      </p>

      {total > rows.length && rows.length > 0 && (
        <p className="text-xs text-muted">
          {t("olderHidden", { count: rows.length })}
        </p>
      )}

      {failed?.at === AT_TOP && failure}

      {shown.length === 0 && needle ? (
        <p className="text-sm text-muted">{t("noMatch", { query })}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {shown.map((row) => {
            // Browsers word a date differently from Node, so the server's wording stays
            const date = format.dateTime(new Date(row.createdAt), ROW_DATE);
            return (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 py-4 transition-opacity",
                  (pending === row.id || pending === "all") && "opacity-50",
                )}
              >
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>
                    <time dateTime={row.createdAt} suppressHydrationWarning>
                      {date}
                    </time>
                    {" · "}
                    {t("edits", { count: row.editCount })}
                  </span>
                  <span className="flex gap-1">
                    <button
                      id={`reopen-${row.id}`}
                      type="button"
                      // Comes under the pointer when the Delete all question closes
                      onClick={whenIdle(() => reopen(row))}
                      aria-disabled={pending !== null}
                      aria-label={t("reopenRow", { date })}
                      suppressHydrationWarning
                      className={quiet}
                    >
                      {t("reopen")}
                    </button>
                    <button
                      id={`delete-${row.id}`}
                      type="button"
                      // Asks on the line below, out of reach of a double click. The list closes up
                      // after a delete, so the next row's Delete comes under the pointer.
                      onClick={whenIdle(() => {
                        setFailed(null);
                        setAsking(row.id);
                        setSaid("askRow");
                      })}
                      aria-disabled={pending !== null}
                      aria-label={t("deleteRow", { date })}
                      suppressHydrationWarning
                      className={cn(
                        quiet,
                        "inline-flex items-center gap-1 hover:bg-remove-soft hover:text-remove",
                      )}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {t("delete")}
                    </button>
                  </span>
                </div>
                {asking === row.id && (
                  <div
                    role="group"
                    aria-label={t("deleteRow", { date })}
                    className="flex flex-wrap items-center justify-end gap-2 text-sm"
                  >
                    <span>{t("clearConfirm", { count: 1 })}</span>
                    <button
                      type="button"
                      // This line closes another row's when it opens, which moves the list
                      onClick={whenIdle(() => remove(row.id))}
                      aria-disabled={pending !== null}
                      className="rounded-md bg-remove-soft px-2 py-1 text-xs font-medium text-remove aria-disabled:cursor-not-allowed"
                    >
                      {t("deleteYes")}
                    </button>
                    <button
                      type="button"
                      onClick={whenIdle(() => {
                        setFailed(null);
                        setAsking(null);
                        setSaid((current) =>
                          current === "askRow" ? null : current,
                        );
                        document.getElementById(`delete-${row.id}`)?.focus();
                      })}
                      aria-disabled={pending !== null}
                      className={quiet}
                    >
                      {t("clearNo")}
                    </button>
                  </div>
                )}
                {failed?.at === row.id && failure}
                <p className="line-clamp-3 whitespace-pre-wrap leading-relaxed">
                  {row.original}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {total > rows.length && rows.length > 0 && (
        <div className="flex flex-col items-center gap-2">
          {failed?.at === AT_MORE && failure}
          <button
            ref={more}
            type="button"
            // Whatever the list loses moves this under the pointer
            onClick={whenIdle(loadMore)}
            aria-disabled={pending !== null}
            className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95 aria-disabled:cursor-not-allowed"
          >
            {pending === "more" ? t("loadingMore") : t("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
