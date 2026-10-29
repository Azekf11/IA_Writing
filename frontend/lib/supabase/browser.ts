import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

// Returns null when Supabase is not configured
export function createClient() {
  const env = supabaseEnv();
  return env ? createBrowserClient(env.url, env.key) : null;
}
