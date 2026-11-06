// What the migration 20261107000000 closes: nothing a browser holds reaches the quota, the corpus
// or the writing of the history, however it asks. The scenario below is the one that used to work.
// Run: npm run test:db   (from frontend/; see README)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  client,
  createUser,
  deleteUser,
  getLimits,
  globalToday,
  localStack,
  psql,
  rpc,
  saveScene,
  sqlState,
  ticket,
  unitVector,
  userToday,
} from "./support.mjs";

const api = client(localStack());
const made = [];

const user = async (label) => {
  const u = await createUser(api, label);
  made.push(u);
  return u;
};

const server = (name, args) =>
  api.service(`/rest/v1/rpc/${name}`, { method: "POST", body: args });

// Refused by the database itself, or by an API that no longer knows the function
const refused = (response, label) => {
  assert.ok(
    [401, 403, 404].includes(response.status),
    `${label}: ${response.status}`,
  );
  assert.ok(
    ["42501", "PGRST202"].includes(sqlState(response)),
    `${label}: ${sqlState(response)}`,
  );
};

let a;
let b;
let c;
let passageId;
let restore = async () => {};

before(async () => {
  restore = await saveScene(api);
  [a, b, c] = await Promise.all([
    user("access-a"),
    user("access-b"),
    user("access-c"),
  ]);
  passageId = "dbtest-access-1";
  const inserted = await api.service("/rest/v1/style_passages", {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: [
      {
        id: passageId,
        author: "Access test",
        title: "Test",
        lang: "en",
        kind: "essay",
        n_words: 3,
        body: "ACCESS-CANARY passage.",
        embedding: unitVector(0),
      },
    ],
  });
  assert.ok(
    inserted.status < 300,
    `could not insert a passage: ${inserted.status}`,
  );
});

after(async () => {
  await api.service(`/rest/v1/style_passages?id=eq.${passageId}`, {
    method: "DELETE",
  });
  for (const u of made) await deleteUser(api, u);
  await restore();
});

describe("the attack that used to work, as shipped: 5 / 2 / 15 / 300", () => {
  it("runs at the shipped limits", async () => {
    const { user_daily, max_in_flight, global_daily, global_monthly } =
      await getLimits(api);
    assert.deepEqual(
      { user_daily, max_in_flight, global_daily, global_monthly },
      {
        user_daily: 5,
        max_in_flight: 2,
        global_daily: 15,
        global_monthly: 300,
      },
    );
  });

  it("three accounts spend nothing of the day's places through the API", async () => {
    const before = await globalToday(api);
    for (const u of [a, b, c]) {
      for (let i = 0; i < 5; i++) {
        // Every shape of the call, old and new
        const fake = crypto.randomUUID();
        for (const [name, args] of [
          ["reserve_quota", {}],
          ["reserve_quota", { account: u.id }],
          ["start_rewrite", { reservation: fake }],
          ["start_rewrite", { account: u.id, reservation: fake }],
          ["finish_rewrite", { reservation: fake, outcome: "succeeded" }],
          [
            "finish_rewrite",
            { account: u.id, reservation: fake, outcome: "succeeded" },
          ],
          ["release_quota", { reservation: fake }],
          ["release_quota", { account: u.id, reservation: fake }],
        ]) {
          refused(await rpc(api, u, name, args), name);
        }
      }
      assert.equal(await userToday(api, u), 0);
    }
    assert.equal(await globalToday(api), before);
  });

  it("a ticket of one's own does not open the corpus either", async () => {
    const reserved = await server("reserve_quota", { account: a.id });
    assert.equal(reserved.status, 200);
    const id = reserved.body;
    assert.equal(
      (await server("start_rewrite", { account: a.id, reservation: id })).body,
      true,
    );

    for (const [name, args] of [
      [
        "search_style_passages",
        { reservation: id, query_embedding: unitVector(0), match_lang: "en" },
      ],
      [
        "search_style_passages",
        {
          account: a.id,
          reservation: id,
          query_embedding: unitVector(0),
          match_lang: "en",
        },
      ],
      ["read_style_passages", { reservation: id }],
    ]) {
      const response = await rpc(api, a, name, args);
      refused(response, name);
      assert.doesNotMatch(JSON.stringify(response.body), /ACCESS-CANARY/);
    }
    assert.equal(
      (await ticket(api, id)).searched_at,
      null,
      "its one search stays unused",
    );
    assert.equal(
      (
        await server("finish_rewrite", {
          account: a.id,
          reservation: id,
          outcome: "cancelled",
        })
      ).body,
      true,
    );
  });
});

describe("the history", () => {
  const forged = (owner) => ({
    user_id: owner.id,
    original: "Never rewritten by the site.",
    edits: [],
    edit_count: 999,
    locale: "en",
  });

  it("takes no row from a signed-in user, for themselves or anyone else", async () => {
    for (const owner of [a, b]) {
      const response = await api.call("/rest/v1/rewrites", {
        method: "POST",
        token: a.token,
        body: forged(owner),
        prefer: "return=representation",
      });
      assert.equal(response.status, 403);
      assert.equal(sqlState(response), "42501");
    }
    const { body } = await api.service(
      `/rest/v1/rewrites?user_id=in.(${a.id},${b.id})&select=id`,
    );
    assert.deepEqual(body, []);
  });

  it("takes no row from a visitor", async () => {
    const response = await api.call("/rest/v1/rewrites", {
      method: "POST",
      body: forged(a),
    });
    assert.equal(sqlState(response), "42501");
  });

  it("still lets its owner read and delete, under row-level security", async () => {
    const saved = await api.service("/rest/v1/rewrites", {
      method: "POST",
      body: { user_id: a.id, original: "kept", locale: "en" },
      prefer: "return=representation",
    });
    assert.equal(saved.status, 201, "the server still writes it");
    const id = saved.body[0].id;

    const history = (who, options = {}) =>
      api.call(`/rest/v1/rewrites?id=eq.${id}`, {
        token: who.token,
        ...options,
      });
    assert.equal((await history(a)).body.length, 1);
    assert.deepEqual((await history(b)).body, []);
    assert.deepEqual(
      (await history(b, { method: "DELETE", prefer: "return=representation" }))
        .body,
      [],
    );
    assert.equal(
      (await history(a, { method: "DELETE", prefer: "return=representation" }))
        .body.length,
      1,
    );
  });
});

// rls.test.mjs reads every privilege browsers hold from the catalog, whichever migration ran last;
// these are the other things this one removes
describe("what else the migration removes, read from the database catalog", () => {
  it("leaves two policies on the history, and they read and delete", () => {
    const rows = psql(`
      select policyname || ' ' || cmd from pg_policies
      where schemaname = 'public' and tablename = 'rewrites' order by 1`);
    assert.deepEqual(rows, [
      "rewrites: delete own DELETE",
      "rewrites: read own SELECT",
    ]);
  });

  it("no longer keeps what the two-call search stored", () => {
    const rows = psql(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'quota_reservations'
        and column_name = 'search_results'`);
    assert.deepEqual(rows, []);
  });
});
