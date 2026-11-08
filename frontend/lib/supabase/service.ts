import "server-only";
import { createClient } from "@supabase/supabase-js";

// The server's own identity for the quota functions, the corpus search and writing the history.
// Importing this from client code fails the build, and the key has no NEXT_PUBLIC_ prefix, so it
// never reaches a bundle. It acts as service_role whoever the visitor is: the route passes it only
// the account it read from the verified session. Null when not configured, and the route then
// refuses to run: a preview without the key cannot spend anything.
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
  });
}
