import type { Allowance, AllowanceResponse } from "./types";

export type ShownAllowance = Allowance & { resetsAt: Date };

// What the line above the editor says. It lives here so that the end of an attempt, elsewhere on the
// page, can have it asked again. In memory only: signing out reloads the page.
const listeners = new Set<() => void>();
let current: ShownAllowance | null = null;
let asked = 0;

export function subscribeAllowance(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getAllowance = () => current;

// The server's page has an empty line, and so does the first render over it
export const getServerAllowance = (): ShownAllowance | null => null;

// When the database's day turns over
const nextMidnightUtc = (now: Date) =>
  new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

const isAllowance = (value?: Partial<Allowance> | null): value is Allowance =>
  typeof value?.limit === "number" &&
  typeof value.open === "boolean" &&
  (value.used === null || typeof value.used === "number");

async function ask(): Promise<Allowance | null> {
  try {
    const response = await fetch("/api/rewrite", { cache: "no-store" });
    const body: Partial<AllowanceResponse> | null = await response.json();
    return isAllowance(body?.allowance) ? body.allowance : null;
  } catch {
    return null;
  }
}

export async function refreshAllowance() {
  const mine = ++asked;
  const answer = await ask();
  // A later question is on its way, and its answer knows more than this one
  if (mine !== asked) return;
  current = answer && { ...answer, resetsAt: nextMidnightUtc(new Date()) };
  listeners.forEach((listener) => listener());
}

// The count may have moved. A page that shows no line asks nothing.
export function nudgeAllowance() {
  if (listeners.size > 0) void refreshAllowance();
}
