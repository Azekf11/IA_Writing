// Helpers for the database tests. They reach a LOCAL Supabase stack through its public HTTP API,
// the way the app and anyone with an account can: the publishable key plus a user's session.
// The secret key only sets the scene (users, limits, an old ticket) and checks the result.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// The folder holding this stack's supabase/config.toml
const workdir = () => process.env.SUPABASE_WORKDIR ?? ROOT;

// Reads the stack's URL and keys from `supabase status`. SUPABASE_WORKDIR selects another
// local stack (a folder holding supabase/config.toml), for example a throwaway copy.
export function localStack() {
  const args = ["status", "-o", "env"];
  if (process.env.SUPABASE_WORKDIR) {
    args.push("--workdir", process.env.SUPABASE_WORKDIR);
  }
  let out;
  try {
    out = execFileSync("supabase", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("`supabase status` failed: start the local stack first");
  }
  const env = {};
  for (const line of out.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0)
      env[line.slice(0, at)] = line.slice(at + 1).replace(/^"|"$/g, "");
  }
  for (const key of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY"]) {
    if (!env[key]) throw new Error(`supabase status has no ${key}`);
  }
  // These tests change limits and counters: they must never reach a hosted project
  const host = new URL(env.API_URL).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
    throw new Error(`refusing to run against ${host}: local stacks only`);
  }
  return env;
}

// call() acts as anonymous, or as a user when given their token; service() as the database owner
export function client(env) {
  const call = async (
    path,
    { method = "GET", token, key, body, prefer } = {},
  ) => {
    const headers = {
      apikey: key ?? env.PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (prefer) headers.Prefer = prefer;
    const response = await fetch(`${env.API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: response.status, body: json };
  };
  const service = (path, options = {}) =>
    call(path, { ...options, key: env.SECRET_KEY, token: env.SECRET_KEY });
  return { call, service };
}

let counter = 0;

// A confirmed user, signed in: { id, email, token }
export async function createUser(api, label) {
  const email = `dbtest-${label}-${Date.now()}-${counter++}@example.com`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const made = await api.service("/auth/v1/admin/users", {
    method: "POST",
    body: { email, password, email_confirm: true },
  });
  assert.ok(made.status < 300, `could not create a user: ${made.status}`);
  const session = await api.call("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  assert.ok(session.body?.access_token, "could not sign in");
  return { id: made.body.id, email, token: session.body.access_token };
}

export const deleteUser = (api, user) =>
  api.service(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" });

// A database function called through the API, as `user` (or anonymously without one)
export const rpc = (api, user, name, args = {}) =>
  api.call(`/rest/v1/rpc/${name}`, {
    method: "POST",
    token: user?.token,
    body: args,
  });

// The SQLSTATE of a refused call, e.g. "53401"
export const sqlState = (response) => response.body?.code;

// Rows of a read-only query run in the stack's database, for what the API does not expose
export function psql(sql) {
  const config = readFileSync(`${workdir()}/supabase/config.toml`, "utf8");
  const project = /^project_id = "(.+)"/m.exec(config)?.[1];
  assert.ok(project, "no project_id in config.toml");
  const out = execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-tA",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  );
  return out.split("\n").filter(Boolean);
}

export const today = () => new Date().toISOString().slice(0, 10);

export async function getLimits(api) {
  const { body } = await api.service("/rest/v1/quota_limits?select=*");
  assert.equal(body?.length, 1, "quota_limits must hold one row");
  return body[0];
}

export async function setLimits(api, values) {
  const response = await api.service("/rest/v1/quota_limits?id=eq.true", {
    method: "PATCH",
    body: values,
    prefer: "return=representation",
  });
  assert.equal(
    response.status,
    200,
    `could not set the limits: ${response.status}`,
  );
}

export async function globalToday(api) {
  const { body } = await api.service(
    `/rest/v1/usage_global?day=eq.${today()}&select=count`,
  );
  return body?.[0]?.count ?? 0;
}

export async function globalThisMonth(api) {
  const first = `${today().slice(0, 8)}01`;
  const { body } = await api.service(
    `/rest/v1/usage_global?day=gte.${first}&select=count`,
  );
  return (body ?? []).reduce((sum, row) => sum + row.count, 0);
}

export async function globalOn(api, day) {
  const { body } = await api.service(
    `/rest/v1/usage_global?day=eq.${day}&select=count`,
  );
  return body?.[0]?.count ?? 0;
}

export async function setGlobalOn(api, day, count) {
  const response = await api.service("/rest/v1/usage_global?on_conflict=day", {
    method: "POST",
    body: { day, count },
    prefer: "resolution=merge-duplicates",
  });
  assert.ok(
    response.status < 300,
    `could not set the global count: ${response.status}`,
  );
}

export const setGlobalToday = (api, count) => setGlobalOn(api, today(), count);

export async function userToday(api, user) {
  const { body } = await api.service(
    `/rest/v1/usage?user_id=eq.${user.id}&day=eq.${today()}&select=count`,
  );
  return body?.[0]?.count ?? 0;
}

export async function ticket(api, id) {
  const { body } = await api.service(
    `/rest/v1/quota_reservations?id=eq.${id}&select=state,started_at,searched_at,closed_at`,
  );
  return body?.[0] ?? null;
}

// Makes a ticket look `seconds` old, as if its request had crashed long ago
export async function age(api, id, seconds) {
  const created = new Date(Date.now() - seconds * 1000).toISOString();
  const response = await api.service(
    `/rest/v1/quota_reservations?id=eq.${id}`,
    {
      method: "PATCH",
      body: { created_at: created },
    },
  );
  assert.ok(
    response.status < 300,
    `could not age the ticket: ${response.status}`,
  );
}

// Saves the limits and today's global count, so a test run leaves the local stack as it was
export async function saveScene(api) {
  const { id: _id, ...limits } = await getLimits(api);
  const global = await globalToday(api);
  return async () => {
    await setLimits(api, limits);
    await setGlobalToday(api, global);
  };
}

// A 256-dimension unit vector along axis `i`, in pgvector's text format
export const unitVector = (i) =>
  `[${Array.from({ length: 256 }, (_, k) => (k === i ? 1 : 0)).join(",")}]`;
