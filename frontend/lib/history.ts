import type { Edit } from "@/lib/rewrite/types";

export type HistoryItem = {
  id: string;
  original: string;
  edits: Edit[];
  editCount: number;
  createdAt: string;
};

export const HISTORY_COLUMNS = "id, original, edits, edit_count, created_at";

// How many rows one read brings, for the page's first answer and for each Load more
export const HISTORY_PAGE = 50;

// When a row was written. The zone is the site's, not the reader's (i18n/request.ts), so it is shown.
export const ROW_DATE = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
} as const;

type HistoryRow = {
  id: string;
  original: string;
  edits: unknown;
  edit_count: number;
  created_at: string;
};

export const historyItem = (row: HistoryRow): HistoryItem => ({
  id: row.id,
  original: row.original,
  edits: Array.isArray(row.edits) ? row.edits : [],
  editCount: row.edit_count,
  createdAt: row.created_at,
});

// The filter for what comes after this row, newest first. The date stays the string the database
// gave: a Date drops the microseconds, so the boundary would repeat a row or skip one. Rows written
// in one statement share a date, which is why the order and the filter both end on the id.
export const olderThan = ({ createdAt, id }: HistoryItem) =>
  `created_at.lt."${createdAt}",and(created_at.eq."${createdAt}",id.lt.${id})`;
