// Shared pieces of the site audit: result collection, local Supabase helpers, mailbox access.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  const args = ["status", "-o", "env"];
  // A stack started from another folder (one holding supabase/config.toml)
  if (process.env.SUPABASE_WORKDIR) {
    args.push("--workdir", process.env.SUPABASE_WORKDIR);
  }
  let out;
  try {
    out = execFileSync("supabase", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
    });
  } catch {
    throw new Error("`supabase status` failed: run `supabase start` first");
  }
  const env = {};
  for (const line of out.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0)
      env[line.slice(0, at)] = line.slice(at + 1).replace(/^"|"$/g, "");
  }
  for (const key of [
    "API_URL",
    "PUBLISHABLE_KEY",
    "SECRET_KEY",
    "MAILPIT_URL",
  ]) {
    if (!env[key]) throw new Error(`supabase status has no ${key}`);
  }
  // The audit changes limits and counters: it must never reach a hosted project
  const host = new URL(env.API_URL).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    throw new Error(`refusing to audit ${host}: local stacks only`);
  }
  return env;
}

const headers = (env, key = env.SECRET_KEY, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  ...extra,
});

// A call as the database owner. A failure throws, so a check can never pass on a broken query.
async function service(env, path, { method = "GET", body, prefer } = {}) {
  const response = await fetch(`${env.API_URL}${path}`, {
    method,
    headers: headers(env, env.SECRET_KEY, prefer ? { Prefer: prefer } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path.split("?")[0]}: ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

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

export const deleteUser = (env, user) =>
  service(env, `/auth/v1/admin/users/${user.id}`, { method: "DELETE" });

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

// The same session, marked as about to run out: within 90 s, the next request refreshes it
export async function expiringCookies(env, user, seconds = 5) {
  const cookies = await sessionCookies(env, user);
  const name = cookies[0].name.replace(/\.\d+$/, "");
  const prefix = "base64-";
  const joined = cookies
    .map((cookie) => cookie.value)
    .join("")
    .replaceAll(prefix, "");
  const session = JSON.parse(Buffer.from(joined, "base64url").toString());
  session.expires_at = Math.floor(Date.now() / 1000) + seconds;
  const value = `${prefix}${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  return `${name}=${value}`;
}

// A signed-in user's own token, to call the API as they could from their browser
export async function accessToken(env, user) {
  const response = await fetch(
    `${env.API_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: env.PUBLISHABLE_KEY },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
  );
  const session = await response.json();
  expect(session.access_token, "could not sign in");
  return session.access_token;
}

const today = () => new Date().toISOString().slice(0, 10);

export const setUsage = (env, user, count) =>
  service(env, "/rest/v1/usage?on_conflict=user_id,day", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { user_id: user.id, day: today(), count },
  });

export async function getUsage(env, user) {
  const rows = await service(
    env,
    `/rest/v1/usage?user_id=eq.${user.id}&day=eq.${today()}&select=count`,
  );
  return rows[0]?.count ?? 0;
}

// Rows written straight to the database, for checks that need more than a day's attempts
export const seedHistory = (env, user, count) =>
  service(env, "/rest/v1/rewrites", {
    method: "POST",
    body: Array.from({ length: count }, (_, i) => ({
      user_id: user.id,
      original: `Seeded rewrite ${i}.`,
      locale: "en",
    })),
  });

// One row with an edit, as the route saves it, for the flows that open it again
export const seedRewrite = (env, user, original, edit) =>
  service(env, "/rest/v1/rewrites", {
    method: "POST",
    body: {
      user_id: user.id,
      original,
      edits: [edit],
      edit_count: 1,
      locale: "en",
    },
  });

export const historyRows = (env, user) =>
  service(env, `/rest/v1/rewrites?user_id=eq.${user.id}&select=*`);

// ---- the quota policy ------------------------------------------------------------------------

export async function getLimits(env) {
  const [limits] = await service(env, "/rest/v1/quota_limits?select=*");
  delete limits.id;
  return limits;
}

export const setLimits = (env, values) =>
  service(env, "/rest/v1/quota_limits?id=eq.true", {
    method: "PATCH",
    body: values,
  });

// Runs `fn` under other limits, then puts the current ones back
export async function withLimits(env, values, fn) {
  const saved = await getLimits(env);
  await setLimits(env, values);
  try {
    return await fn();
  } finally {
    await setLimits(env, saved);
  }
}

export async function globalToday(env) {
  const rows = await service(
    env,
    `/rest/v1/usage_global?day=eq.${today()}&select=count`,
  );
  return rows[0]?.count ?? 0;
}

export async function globalThisMonth(env) {
  const rows = await service(
    env,
    `/rest/v1/usage_global?day=gte.${today().slice(0, 8)}01&select=count`,
  );
  return rows.reduce((sum, row) => sum + row.count, 0);
}

export const setGlobalToday = (env, count) =>
  service(env, "/rest/v1/usage_global?on_conflict=day", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: { day: today(), count },
  });

export const ticketsOf = (env, user) =>
  service(
    env,
    `/rest/v1/quota_reservations?user_id=eq.${user.id}&select=state&order=created_at.desc`,
  );

// How the user's latest attempt ended, once the route has closed its ticket
export async function closedAs(env, user) {
  const state = await until(
    async () => {
      const [latest] = await ticketsOf(env, user);
      return latest && !["reserved", "started"].includes(latest.state)
        ? latest.state
        : null;
    },
    { timeout: 6000 },
  );
  expect(state, "the ticket was never closed");
  return state;
}

// ---- passages for the run --------------------------------------------------------------------

// Written for this audit, close to its sample texts. The corpus itself lives outside git, and
// the checks that style references reach the model must also work on an empty local database.
const PASSAGES = [
  [
    "en",
    "People who talk plainly to each other tend to understand each other. A good conversation depends less on clever words than on listening, on asking what the other person meant, and on saying the same thing again in simpler terms when the first attempt has failed.",
  ],
  [
    "en",
    "The mayor stood up in the crowded hall and spoke for most of the hour. Nobody moved. When he finished, people stayed in their seats for a while, unsure whether the speech had ended, and then the room slowly filled with the sound of chairs.",
  ],
  [
    "en",
    "Effective communication plays a real part in how people connect. It is worth understanding that listening is a skill that improves with practice, and that we reach our potential when we embrace a few plain principles and say what we mean.",
  ],
  [
    "fr",
    "Bien communiquer demande du temps et de la patience. Les liens entre les gens se construisent sur de petites habitudes : écouter jusqu'au bout, poser une question simple, dire clairement ce que l'on pense et comprendre ce que l'autre a voulu dire.",
  ],
  [
    "fr",
    "Écouter n'est pas une compétence rare, mais c'est un travail. Il faut se taire, laisser l'autre finir sa phrase, et accepter de ne pas tout comprendre du premier coup. Dans un monde bruyant, la communication tient souvent à ce simple effort.",
  ],
  [
    "fr",
    "Le maire a parlé pendant près d'une heure dans la salle comble. Personne n'a bougé. À la fin de son discours, les gens sont restés assis un moment, sans trop savoir si c'était terminé, puis ils ont compris et sont sortis lentement.",
  ],
];

export const passageBodies = (lang) =>
  PASSAGES.filter(([of]) => !lang || of === lang).map(([, body]) => body);

export async function seedPassages(env) {
  // The app's own embedder, so the vectors match what the route will search with
  const { createEmbedder } = await import("../lib/style/embedder.ts");
  const embedder = createEmbedder();
  const rows = PASSAGES.map(([lang, body], i) => ({
    id: `audit-${i}`,
    author: `Audit passage ${i}`,
    title: "Written for the site audit",
    lang,
    kind: "essay",
    n_words: body.split(/\s+/).length,
    body,
    embedding: `[${embedder
      .embed(body)
      .map((v) => v.toFixed(6))
      .join(",")}]`,
  }));
  await service(env, "/rest/v1/style_passages?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: rows,
  });
}

export const hasPassages = async (env) =>
  (await service(env, "/rest/v1/style_passages?select=id&limit=1")).length > 0;

export const removePassages = (env) =>
  service(env, "/rest/v1/style_passages?id=like.audit-*", {
    method: "DELETE",
  });

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

const mail = (env) => `${env.MAILPIT_URL}/api/v1`;

export const clearMailbox = (env) =>
  fetch(`${mail(env)}/messages`, { method: "DELETE" }).catch(() => {});

export async function magicLinkFor(env, email) {
  const message = await until(
    async () => {
      const list = await (await fetch(`${mail(env)}/messages`)).json();
      return list.messages?.find((m) =>
        m.To?.some((to) => to.Address === email),
      );
    },
    { timeout: 8000, every: 250 },
  );
  expect(message, `no email arrived for ${email}`);
  const full = await (await fetch(`${mail(env)}/message/${message.ID}`)).json();
  const link = /https?:\/\/[^\s"<>]+\/auth\/v1\/verify[^\s"<>]+/.exec(
    full.Text + full.HTML,
  )?.[0];
  expect(link, "the email holds no sign-in link");
  return link.replaceAll("&amp;", "&");
}
