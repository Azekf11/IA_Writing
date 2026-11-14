// The URL and keys of a LOCAL Supabase stack, read from `supabase status`. The database tests and
// the site audit both go through here, because both change limits and counters: this is what
// keeps them off a hosted project. Node built-ins only, since the database workflow installs
// nothing.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "[::1]"];

export const BASE_KEYS = ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"];

// `supabase status -o env` prints one NAME="value" per line
export function parseStatus(output) {
  const env = {};
  for (const line of output.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0)
      env[line.slice(0, at)] = line.slice(at + 1).replace(/^"|"$/g, "");
  }
  return env;
}

// Throws unless the stack has every key asked for and answers on this machine
export function assertLocal(env, keys = BASE_KEYS) {
  for (const key of keys) {
    if (!env[key]) throw new Error(`supabase status has no ${key}`);
  }
  const host = new URL(env.API_URL).hostname;
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`refusing to run against ${host}: local stacks only`);
  }
  return env;
}

// SUPABASE_WORKDIR selects a stack started from another folder (one holding supabase/config.toml)
export function localStack(keys = BASE_KEYS) {
  const args = ["status", "-o", "env"];
  if (process.env.SUPABASE_WORKDIR) {
    args.push("--workdir", process.env.SUPABASE_WORKDIR);
  }
  let output;
  try {
    output = execFileSync("supabase", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("`supabase status` failed: run `supabase start` first");
  }
  return assertLocal(parseStatus(output), keys);
}
