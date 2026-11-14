// Which words of an edit change, so that the review can mark those and leave the rest plain. The
// page loads this on first use.

export type Run = { kind: "same" | "removed" | "added"; text: string };

// A figure with its percent sign (12,5 % | 1 000 | 3.14), then a word with its elisions and hyphens
// (l'homme | aujourd'hui | well-known), a run of spaces, or one other character
const FIGURE = String.raw`(?:\p{N}{1,3}(?:\p{Zs}\p{N}{3})+(?!\p{N})|\p{N}+)(?:[.,:/]\p{N}+)*(?:\p{Zs}?[%‰])?(?![\p{L}\p{N}])`;
const WORD = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-‐‑][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*`;
const TOKEN = new RegExp(String.raw`${FIGURE}|${WORD}|\s+|.`, "gsu");

// Enough for the longest edit the guard lets through: 600 characters against 1,800
const MAX_CELLS = 1_500_000;

// Below this share of letters and digits in common, marks would be noise: nearly everything would
// carry one
const MIN_SHARED = 1 / 3;

const weight = (text: string) => text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

// Longest common run of tokens. A table over what is left once the common start and end are set
// aside: most edits are short, and a long one is bounded by MAX_CELLS.
function align(a: string[], b: string[]): Run[] | null {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  if (n * m > MAX_CELLS) return null;
  const width = m + 1;
  const best = new Uint16Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      best[i * width + j] =
        a[start + i] === b[start + j]
          ? best[(i + 1) * width + j + 1] + 1
          : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
    }
  }

  const runs: Run[] = [];
  let removed = "";
  let added = "";
  // A space between two changes, which may yet join them into one mark
  let held = "";

  const endChange = () => {
    if (removed) runs.push({ kind: "removed", text: removed });
    if (added) runs.push({ kind: "added", text: added });
    removed = added = "";
  };
  const keep = (text: string) => {
    const last = runs.at(-1);
    if (last?.kind === "same") last.text += text;
    else runs.push({ kind: "same", text });
  };
  const same = (token: string) => {
    if ((removed || added) && !held && /^\s+$/.test(token)) {
      held = token;
      return;
    }
    endChange();
    keep(held + token);
    held = "";
  };
  const resumeChange = () => {
    removed += held;
    added += held;
    held = "";
  };

  a.slice(0, start).forEach(same);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      same(a[start + i]);
      i++;
      j++;
    } else {
      resumeChange();
      if (
        j >= m ||
        (i < n && best[(i + 1) * width + j] >= best[i * width + j + 1])
      ) {
        removed += a[start + i++];
      } else {
        added += b[start + j++];
      }
    }
  }
  a.slice(endA).forEach(same);
  endChange();
  if (held) keep(held);
  return runs;
}

// Null when the two sides share too little, or are too long to compare: the review then shows them
// whole, as lines. Otherwise same and removed runs rebuild `before`; same and added runs, `after`.
export function wordDiff(before: string, after: string): Run[] | null {
  const runs = align(before.match(TOKEN) ?? [], after.match(TOKEN) ?? []);
  if (!runs) return null;
  const total = weight(before) + weight(after);
  const shared = runs
    .filter((run) => run.kind === "same")
    .reduce((sum, run) => sum + weight(run.text), 0);
  return total > 0 && (2 * shared) / total >= MIN_SHARED ? runs : null;
}
