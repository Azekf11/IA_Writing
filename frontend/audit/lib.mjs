// Shared pieces of the site audit: result collection, local Supabase helpers, mailbox access.
import { execFileSync } from "node:child_process";
import { createServerClient } from "@supabase/ssr";

export class Warn extends Error {}
export const warn = (detail) => {
  throw new Warn(detail);
};

export const results = [];
// Problems seen while pages were open: console errors, failed requests, thrown exceptions
export const issues = [];

// Runs one check. Returning a string is a pass with a note; throwing fails; `warn()` warns.
export async function check(area, name, fn) {
  const started = performance.now();
  let status = "pass";
  let detail = "";
  try {
    detail = (await fn()) ?? "";
  } catch (error) {
    status = error instanceof Warn ? "warn" : "fail";
    detail = error instanceof Error ? error.message : String(error);
  }
  const ms = Math.round(performance.now() - started);
  results.push({ area, name, status, detail, ms });
  const mark = { pass: "ok  ", warn: "WARN", fail: "FAIL" }[status];
  console.log(
    `${mark} [${area}] ${name}${detail ? ` - ${String(detail).split("\n")[0].slice(0, 140)}` : ""}`,
  );
}

export const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};
export const median = (values) => percentile(values, 50);

// ---- local Supabase -------------------------------------------------------------------------

export function localEnv() {
  const out = execFileSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    cwd: new URL("../../", import.meta.url).pathname,
  });
  const env = {};
  for (const line of out.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0)
      env[line.slice(0, at)] = line.slice(at + 1).replace(/^"|"$/g, "");
  }
  for (const key of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
    if (!env[key])
      throw new Error(
        `supabase status has no ${key}: is the local stack running?`,
      );
  }
  return env;
}

const headers = (env, key = env.SECRET_KEY, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

let counter = 0;
export async function createUser(env, label = "u") {
  const email = `audit-${label}-${Date.now()}-${counter++}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const response = await fetch(`${env.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await response.json();
  expect(response.ok, `could not create a test user: ${JSON.stringify(user)}`);
  return { id: user.id, email, password };
}

export async function deleteUser(env, user) {
  await fetch(`${env.API_URL}/auth/v1/admin/users/${user.id}`, {
    method: "DELETE",
    headers: headers(env),
  });
}

// Signs in outside the browser and returns the session cookies, ready for Playwright
export async function sessionCookies(env, user) {
  const jar = new Map();
  const client = createServerClient(env.API_URL, env.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => list.forEach(({ name, value }) => jar.set(name, value)),
    },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) throw error;
  return [...jar].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
  }));
}

const today = () => new Date().toISOString().slice(0, 10);

export async function setUsage(env, user, count) {
  await fetch(`${env.API_URL}/rest/v1/usage?on_conflict=user_id,day`, {
    method: "POST",
    headers: headers(env, env.SECRET_KEY, {
      Prefer: "resolution=merge-duplicates",
    }),
    body: JSON.stringify({ user_id: user.id, day: today(), count }),
  });
}

export async function getUsage(env, user) {
  const response = await fetch(
    `${env.API_URL}/rest/v1/usage?user_id=eq.${user.id}&day=eq.${today()}&select=count`,
    { headers: headers(env) },
  );
  const rows = await response.json();
  return rows[0]?.count ?? 0;
}

export async function historyRows(env, user) {
  const response = await fetch(
    `${env.API_URL}/rest/v1/rewrites?user_id=eq.${user.id}&select=id,original,edit_count`,
    { headers: headers(env) },
  );
  return response.json();
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(fn, { timeout = 5000, every = 100 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > end) return value;
    await sleep(every);
  }
}

// ---- mailbox (Mailpit, bundled with the local Supabase stack) -----------------------------

const MAIL = "http://127.0.0.1:54324/api/v1";

export const clearMailbox = () =>
  fetch(`${MAIL}/messages`, { method: "DELETE" }).catch(() => {});

export async function magicLinkFor(email) {
  const message = await until(
    async () => {
      const list = await (await fetch(`${MAIL}/messages`)).json();
      return list.messages?.find((m) =>
        m.To?.some((to) => to.Address === email),
      );
    },
    { timeout: 8000, every: 250 },
  );
  expect(message, `no email arrived for ${email}`);
  const full = await (await fetch(`${MAIL}/message/${message.ID}`)).json();
  const link = /https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/.exec(
    full.Text + full.HTML,
  )?.[0];
  expect(link, "the email holds no sign-in link");
  return link.replaceAll("&amp;", "&");
}
