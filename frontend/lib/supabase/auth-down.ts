import { isAuthRetryableFetchError } from "@supabase/supabase-js";

// How long a route gives one call to Auth: as long as one database call may take. The server's client
// limits its table calls, not its calls to Auth, and nothing else limits the session check.
export const AUTH_MS = 8_000;

// The auth server being out of reach or overloaded does not mean the user signed out
export const authIsDown = (error: { status?: number } | null) =>
  isAuthRetryableFetchError(error) ||
  error?.status === 429 ||
  (error?.status ?? 0) >= 500;

const LATE = Object.freeze({ code: "deadline" });

// Settles as `work` does, or fails with the code "deadline" once AUTH_MS have passed, when the call
// may still go through
export async function inTime<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(reject, AUTH_MS, LATE);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// What the session check answers, or null when it has not answered within AUTH_MS: a key set not
// cached yet, or a legacy token that goes to Auth, can stall, and that is Auth being down too
export async function claimsInTime<Claims>(session: {
  auth: { getClaims(): Promise<Claims> };
}): Promise<Claims | null> {
  try {
    return await inTime(session.auth.getClaims());
  } catch (error) {
    if (error === LATE) return null;
    throw error;
  }
}
