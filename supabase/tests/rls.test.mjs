// Who can read and change what, tested through the public API on a local stack: row-level
// security on the history, and tables that no browser may reach.
// Run: npm run test:db   (from frontend/; see README)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  client,
  createUser,
  deleteUser,
  localStack,
  psql,
  rpc,
  sqlState,
} from "./support.mjs";

const api = client(localStack());
let a;
let b;

const history = (user, path = "", options = {}) =>
  api.call(`/rest/v1/rewrites${path}`, { token: user?.token, ...options });

const write = (user, row) =>
  history(user, "", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });

// A refusal from the database itself, not a missing route
const denied = (response) => {
  assert.ok([401, 403].includes(response.status), `status ${response.status}`);
  assert.equal(sqlState(response), "42501");
};

before(async () => {
  a = await createUser(api, "rls-a");
  b = await createUser(api, "rls-b");
});

after(async () => {
  for (const user of [a, b]) if (user) await deleteUser(api, user);
});

describe("history: each user sees and changes only their own rows", () => {
  let row;

  it("lets a user save to their own history", async () => {
    const saved = await write(a, {
      user_id: a.id,
      original: "hello",
      locale: "en",
    });
    assert.equal(saved.status, 201);
    row = saved.body[0];
  });

  it("refuses a row written for someone else", async () => {
    const forged = await write(a, {
      user_id: b.id,
      original: "evil",
      locale: "en",
    });
    denied(forged);
  });

  it("refuses an unknown language and a text over 5000 characters", async () => {
    const locale = await write(a, {
      user_id: a.id,
      original: "x",
      locale: "de",
    });
    assert.equal(sqlState(locale), "23514");
    const long = await write(a, {
      user_id: a.id,
      original: "a".repeat(5001),
      locale: "en",
    });
    assert.equal(sqlState(long), "23514");
  });

  it("hides one user's rows from another", async () => {
    const seen = await history(b, "?select=id");
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body, []);
  });

  it("does not let another user delete a row", async () => {
    const attempt = await history(b, `?id=eq.${row.id}`, {
      method: "DELETE",
      prefer: "return=representation",
    });
    assert.deepEqual(attempt.body, [], "the delete must match no row");
    const still = await history(a, `?id=eq.${row.id}&select=id`);
    assert.equal(still.body.length, 1);
  });

  it("does not let another user change a row", async () => {
    const attempt = await history(b, `?id=eq.${row.id}`, {
      method: "PATCH",
      body: { original: "changed" },
    });
    denied(attempt);
  });

  it("lets the owner delete their row", async () => {
    const gone = await history(a, `?id=eq.${row.id}`, {
      method: "DELETE",
      prefer: "return=representation",
    });
    assert.equal(gone.body.length, 1);
  });

  // What "Delete all" sends. It must reach the rows the page does not list, and no one else's.
  it("lets a user delete their whole history at once, and nobody else's", async () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({
      user_id: a.id,
      original: `row ${i}`,
      locale: "en",
    }));
    assert.equal((await write(a, rows)).status, 201);
    const other = await write(b, {
      user_id: b.id,
      original: "someone else's",
      locale: "en",
    });
    denied(await history(null, "?id=not.is.null", { method: "DELETE" }));

    const gone = await history(a, "?id=not.is.null", {
      method: "DELETE",
      prefer: "return=representation",
    });
    assert.equal(gone.status, 200);
    assert.equal(gone.body.length, 55);
    assert.deepEqual((await history(a, "?select=id")).body, []);
    assert.equal((await history(b, "?select=id")).body.length, 1);

    await history(b, `?id=eq.${other.body[0].id}`, { method: "DELETE" });
  });

  it("removes a user's history and counters with their account", async () => {
    const c = await createUser(api, "rls-cascade");
    await write(c, { user_id: c.id, original: "keep", locale: "en" });
    assert.equal((await rpc(api, c, "reserve_quota")).status, 200);
    await deleteUser(api, c);
    for (const table of ["rewrites", "usage", "quota_reservations"]) {
      const left = await api.service(
        `/rest/v1/${table}?user_id=eq.${c.id}&select=user_id`,
      );
      assert.deepEqual(
        left.body,
        [],
        `${table} still holds rows of a deleted user`,
      );
    }
  });
});

describe("usage: readable by its owner, writable by nobody", () => {
  it("shows a user their own counter only", async () => {
    assert.equal((await rpc(api, a, "reserve_quota")).status, 200);
    const own = await api.call("/rest/v1/usage?select=user_id,count", {
      token: a.token,
    });
    assert.deepEqual(
      own.body.map((r) => r.user_id),
      [a.id],
    );
    const other = await api.call(`/rest/v1/usage?user_id=eq.${a.id}`, {
      token: b.token,
    });
    assert.deepEqual(other.body, []);
  });

  it("refuses any direct change to a counter", async () => {
    denied(
      await api.call(`/rest/v1/usage?user_id=eq.${a.id}`, {
        method: "PATCH",
        token: a.token,
        body: { count: 0 },
      }),
    );
    denied(
      await api.call("/rest/v1/usage", {
        method: "POST",
        token: a.token,
        body: { user_id: a.id, count: 0 },
      }),
    );
  });
});

describe("tables only the database itself may touch", () => {
  const closed = [
    "quota_limits",
    "usage_global",
    "quota_reservations",
    "style_passages",
  ];

  for (const table of closed) {
    it(`refuses to show ${table} to a signed-in user and to a visitor`, async () => {
      denied(await api.call(`/rest/v1/${table}?select=*`, { token: a.token }));
      denied(await api.call(`/rest/v1/${table}?select=*`));
    });
  }

  it("refuses to let a signed-in user raise the limits", async () => {
    denied(
      await api.call("/rest/v1/quota_limits?id=eq.true", {
        method: "PATCH",
        token: a.token,
        body: { user_daily: 1000 },
      }),
    );
  });
});

describe("visitors without an account", () => {
  it("cannot read any history", async () => {
    denied(await history(null, "?select=id"));
  });

  it("cannot call any quota or search function", async () => {
    const uuid = crypto.randomUUID();
    for (const [name, args] of [
      ["reserve_quota", {}],
      ["start_rewrite", { reservation: uuid }],
      ["finish_rewrite", { reservation: uuid, outcome: "succeeded" }],
      ["release_quota", { reservation: uuid }],
      [
        "search_style_passages",
        { reservation: uuid, query_embedding: "[1]", match_lang: "en" },
      ],
      ["read_style_passages", { reservation: uuid }],
    ]) {
      // 42501 is the missing EXECUTE grant, not the function's own sign-in check (28000)
      const response = await rpc(api, null, name, args);
      assert.equal(
        sqlState(response),
        "42501",
        `${name}: ${JSON.stringify(response.body)}`,
      );
    }
  });
});

// The behaviours above check known tables; this catches anything added later without thought
describe("every privilege browsers hold, read from the database catalog", () => {
  // What the role can do, however it got there: a grant to PUBLIC counts too
  const roles = "(values ('anon'), ('authenticated')) r(role)";
  const kinds =
    "unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)";

  it("is limited to the history and the user's own counter", () => {
    const rows = psql(`
      select r.role || ' ' || c.relname || ' ' ||
             string_agg(p.priv, ',' order by p.priv)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join ${roles}
      cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv)
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
        and has_table_privilege(r.role, c.oid, p.priv)
      group by r.role, c.relname order by 1`);
    assert.deepEqual(rows, [
      "authenticated rewrites DELETE,INSERT,SELECT",
      "authenticated usage SELECT",
    ]);
  });

  it("has nothing granted on single columns", () => {
    const rows = psql(`
      select r.role || ' ' || c.relname || ' ' || a.attname || ' ' || p.priv
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      cross join ${roles}
      cross join ${kinds}
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and has_column_privilege(r.role, c.oid, a.attnum, p.priv)
        and not has_table_privilege(r.role, c.oid, p.priv)
      order by 1`);
    assert.deepEqual(rows, []);
  });

  it("runs the six functions as their owner, with no search path to hijack", () => {
    const rows = psql(`
      select p.proname || ' ' || p.prosecdef || ' ' ||
             coalesce(array_to_string(p.proconfig, ','), 'none')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`);
    assert.deepEqual(rows, [
      'finish_rewrite true search_path=""',
      'read_style_passages true search_path=""',
      'release_quota true search_path=""',
      'reserve_quota true search_path=""',
      'search_style_passages true search_path=""',
      'start_rewrite true search_path=""',
    ]);
  });

  it("is limited to the six functions signed-in users need", () => {
    const rows = psql(`
      select p.proname || ' ' ||
             has_function_privilege('authenticated', p.oid, 'execute') || ' ' ||
             has_function_privilege('anon', p.oid, 'execute')
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' order by 1`);
    assert.deepEqual(rows, [
      "finish_rewrite true false",
      "read_style_passages true false",
      "release_quota true false",
      "reserve_quota true false",
      "search_style_passages true false",
      "start_rewrite true false",
    ]);
  });

  it("has row-level security on every table", () => {
    const rows = psql(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    assert.deepEqual(rows, []);
  });
});
