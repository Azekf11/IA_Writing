import "server-only";
import { createClient } from "@supabase/supabase-js";

// How long one database call may take, up to the response headers, which PostgREST sends once the
// query has run. It has to fit after the model's 50 s deadline, when the ticket still has to be closed
// inside the rewrite route's 60 s limit. Far above what a call normally takes.
export const DATABASE_MS = 8_000;

// The server's own identity, for two routes: /api/rewrite runs the quota functions, the corpus search
// and the history writes with it, and /api/account deletes the signed-in account. Importing this
// from client code fails the build, and the key has no NEXT_PUBLIC_ prefix, so it never reaches a
// bundle. It acts as service_role whoever the visitor is: each route passes it only the account it
// read from the verified session. Null when not configured, and both routes then refuse to run: a
// preview without the key cannot spend anything or delete an account.
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { timeout: DATABASE_MS },
  });
}
