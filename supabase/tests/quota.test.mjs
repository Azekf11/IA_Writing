// The quota policy, tested through the public API with real accounts on a local stack:
// limits, ceilings shared by every account, concurrency, ticket states and direct calls.
// Run: npm run test:db   (from frontend/; see README)
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  age,
  client,
  createUser,
  deleteUser,
  getLimits,
  globalOn,
  globalThisMonth,
  globalToday,
  localStack,
  rpc,
  saveScene,
  setGlobalOn,
  setGlobalToday,
  setLimits,
  sqlState,
  ticket,
  today,
  unitVector,
  userToday,
} from "./support.mjs";

const api = client(localStack());
const made = [];
let restore = async () => {};
let shipped;

const user = async (label) => {
  const u = await createUser(api, label);
  made.push(u);
  return u;
};

// Room for everything except the limit a test is about
const ROOMY = {
  user_daily: 1000,
  global_daily: 100000,
  global_monthly: 1000000,
  max_in_flight: 100,
  ticket_ttl_seconds: 90,
};
const limits = (values) => setLimits(api, { ...ROOMY, ...values });

const reserve = (u) => rpc(api, u, "reserve_quota");
const start = (u, id) => rpc(api, u, "start_rewrite", { reservation: id });
const finish = (u, id, outcome = "succeeded") =>
  rpc(api, u, "finish_rewrite", { reservation: id, outcome });
const release = (u, id) => rpc(api, u, "release_quota", { reservation: id });
const search = (u, id, lang = "en", count = 10) =>
  rpc(api, u, "search_style_passages", {
    reservation: id,
    query_embedding: unitVector(0),
    match_lang: lang,
    match_count: count,
  });
const read = (u, id) => rpc(api, u, "read_style_passages", { reservation: id });

// Reserves and returns the ticket id, failing the test if the reservation is refused
async function granted(u) {
  const response = await reserve(u);
  assert.equal(
    response.status,
    200,
    `refused: ${JSON.stringify(response.body)}`,
  );
  assert.match(response.body, /^[0-9a-f-]{36}$/);
  return response.body;
}

// Reserves and starts: the attempts the app-wide ceilings count
async function begun(u) {
  const id = await granted(u);
  assert.equal((await start(u, id)).body, true);
  return id;
}

// What the route does, as one call: its last answer tells how the attempt went
const attempt = async (u) => {
  const r = await reserve(u);
  return r.status === 200 ? start(u, r.body) : r;
};

const tally = (responses) => {
  const out = { granted: 0 };
  for (const r of responses) {
    const key = r.status === 200 ? "granted" : sqlState(r);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
};

before(async () => {
  shipped = await getLimits(api);
  restore = await saveScene(api);
  // Passages so the search has something to return: a few in English, and more in French than
  // one search may return, each further from the query vector than the one before
  const passage = (id, lang, embedding) => ({
    id: `dbtest-${id}`,
    author: `Test author ${id}`,
    title: "Test",
    lang,
    kind: "essay",
    n_words: 3,
    body: `Test passage ${id}.`,
    embedding,
  });
  const tilted = (i) =>
    `[${Array.from({ length: 256 }, (_, k) => (k === 0 ? 1 : k === 1 ? i / 10 : 0)).join(",")}]`;
  const rows = [
    ...Array.from({ length: 3 }, (_, i) =>
      passage(`en-${i}`, "en", unitVector(i)),
    ),
    ...Array.from({ length: 12 }, (_, i) =>
      passage(`fr-${i}`, "fr", tilted(i)),
    ),
  ];
  const inserted = await api.service("/rest/v1/style_passages", {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates",
  });
  assert.ok(
    inserted.status < 300,
    `could not insert passages: ${inserted.status}`,
  );
});

// Every other test sets its own values, so only this one would see a changed seed
describe("the limits as shipped", () => {
  it("are the ones the documentation states", () => {
    const { id: _id, ...values } = shipped;
    assert.deepEqual(
      values,
      {
        user_daily: 5,
        global_daily: 15,
        global_monthly: 300,
        max_in_flight: 2,
        ticket_ttl_seconds: 90,
      },
      "either a migration changed them, or an interrupted run left them: supabase db reset",
    );
  });
});

after(async () => {
  await api.service("/rest/v1/style_passages?id=like.dbtest-*", {
    method: "DELETE",
  });
  for (const u of made) await deleteUser(api, u);
  await restore();
});

describe("the limits belong to the database", () => {
  it("reserve_quota takes no limit from the caller", async () => {
    await limits({});
    const u = await user("args");
    const forged = await rpc(api, u, "reserve_quota", { daily_limit: 1000000 });
    assert.equal(
      forged.status,
      404,
      "a reserve_quota with arguments must not exist",
    );
    await granted(u);
  });

  it("stops one account at its daily limit", async () => {
    await limits({ user_daily: 3 });
    const u = await user("daily");
    for (let i = 0; i < 3; i++) await granted(u);
    assert.equal(sqlState(await reserve(u)), "53401");
    assert.equal(await userToday(api, u), 3, "a refusal must not be counted");
  });

  it("stops one account at its in-flight limit, and frees the slot when the ticket closes", async () => {
    await limits({ max_in_flight: 2 });
    const u = await user("inflight");
    const first = await granted(u);
    await granted(u);
    assert.equal(sqlState(await reserve(u)), "53400");
    assert.equal(await userToday(api, u), 2, "a refusal must not be counted");

    assert.equal((await start(u, first)).body, true);
    assert.equal((await finish(u, first)).body, true);
    await granted(u);
  });

  it("stops every account at the daily ceiling for the whole app", async () => {
    const used = await globalToday(api);
    await limits({ global_daily: used + 2 });
    const a = await user("global-a");
    const b = await user("global-b");
    await begun(a);
    await begun(b);
    const c = await user("global-c");
    assert.equal(sqlState(await reserve(c)), "53402");
    assert.equal(sqlState(await reserve(a)), "53402");
    assert.equal(await globalToday(api), used + 2);
  });

  it("stops every account at the monthly ceiling for the whole app", async () => {
    const used = await globalThisMonth(api);
    await limits({ global_monthly: used + 1 });
    const u = await user("monthly");
    await begun(u);
    assert.equal(sqlState(await reserve(u)), "53403");
    assert.equal(sqlState(await reserve(await user("monthly-other"))), "53403");
  });

  it("adds up every day of this month, and no day of the month before", async () => {
    const first = `${today().slice(0, 8)}01`;
    const lastMonth = new Date(Date.parse(first) - 86400000)
      .toISOString()
      .slice(0, 10);
    const before = await globalOn(api, lastMonth);
    await setGlobalOn(api, lastMonth, 1000000);
    try {
      const used = await globalThisMonth(api);
      await limits({ global_monthly: used + 1 });
      const u = await user("month-window");
      // Last month's count, however large, takes nothing from this month
      await begun(u);
      assert.equal(sqlState(await reserve(u)), "53403");

      // On the 1st there is no earlier day this month to test
      if (today() !== first) {
        const earlier = await globalOn(api, first);
        await limits({ global_monthly: used + 2 });
        const other = await user("month-window-held");
        const held = await granted(other);
        await setGlobalOn(api, first, earlier + 1);
        assert.equal(
          sqlState(await reserve(u)),
          "53403",
          "an earlier day of this month must count",
        );
        assert.equal(
          sqlState(await start(other, held)),
          "53403",
          "and for a ticket already held too",
        );
        assert.equal((await release(other, held)).body, true);
        await setGlobalOn(api, first, earlier);
      }
    } finally {
      await setGlobalOn(api, lastMonth, before);
    }
  });

  it("fails closed when the limits row is missing", async () => {
    const saved = (await api.service("/rest/v1/quota_limits?select=*")).body[0];
    await api.service("/rest/v1/quota_limits?id=eq.true", { method: "DELETE" });
    try {
      const u = await user("nolimits");
      const response = await reserve(u);
      assert.notEqual(response.status, 200, "no policy must mean no ticket");
      assert.equal(await userToday(api, u), 0);
    } finally {
      const back = await api.service("/rest/v1/quota_limits", {
        method: "POST",
        body: saved,
      });
      assert.ok(back.status < 300, "could not restore the limits row");
    }
  });
});

describe("no number of parallel requests or accounts gets past a limit", () => {
  it("lets exactly one of two parallel requests take the last attempt", async () => {
    for (let round = 0; round < 5; round++) {
      await limits({ user_daily: 1 });
      const u = await user(`last-${round}`);
      const results = tally(await Promise.all([reserve(u), reserve(u)]));
      assert.deepEqual(results, { granted: 1, 53401: 1 });
    }
  });

  it("holds the in-flight limit under a burst", async () => {
    await limits({ max_in_flight: 2 });
    const u = await user("burst");
    const results = tally(
      await Promise.all(Array.from({ length: 10 }, () => reserve(u))),
    );
    assert.deepEqual(results, { granted: 2, 53400: 8 });
    assert.equal(await userToday(api, u), 2);
  });

  it("shares the daily ceiling between accounts racing each other", async () => {
    const used = await globalToday(api);
    await limits({ user_daily: 5, global_daily: used + 7 });
    const accounts = await Promise.all(
      Array.from({ length: 6 }, (_, i) => user(`race-${i}`)),
    );
    // 6 accounts x 4 parallel attempts = 24 starts racing for 7 remaining places
    const results = tally(
      await Promise.all(
        accounts.flatMap((u) => Array.from({ length: 4 }, () => attempt(u))),
      ),
    );
    assert.equal(results.granted, 7);
    assert.equal(results[53402], 17);
    assert.equal(await globalToday(api), used + 7);
  });

  it("shares the monthly ceiling between accounts racing each other", async () => {
    const used = await globalThisMonth(api);
    await limits({ user_daily: 5, global_monthly: used + 7 });
    const accounts = await Promise.all(
      Array.from({ length: 6 }, (_, i) => user(`race-month-${i}`)),
    );
    const results = tally(
      await Promise.all(
        accounts.flatMap((u) => Array.from({ length: 4 }, () => attempt(u))),
      ),
    );
    assert.equal(results.granted, 7);
    assert.equal(results[53403], 17);
    assert.equal(await globalThisMonth(api), used + 7);
  });

  for (const [ceiling, code, count] of [
    ["global_daily", "53402", globalToday],
    ["global_monthly", "53403", globalThisMonth],
  ]) {
    it(`lets exactly one of two accounts take the last place of ${ceiling}`, async () => {
      for (let round = 0; round < 5; round++) {
        const used = await count(api);
        await limits({ [ceiling]: used + 1 });
        const a = await user(`last-${ceiling}-${round}-a`);
        const b = await user(`last-${ceiling}-${round}-b`);
        const results = tally(await Promise.all([attempt(a), attempt(b)]));
        assert.deepEqual(results, { granted: 1, [code]: 1 });
        assert.equal(await count(api), used + 1);
      }
    });
  }

  it("does not give the global attempts back when accounts are deleted", async () => {
    const before = await globalToday(api);
    await limits({});
    const throwaway = await createUser(api, "throwaway");
    await begun(throwaway);
    await begun(throwaway);
    await deleteUser(api, throwaway);
    assert.equal(await globalToday(api), before + 2);
  });
});

describe("a ticket moves forward once, and only for its owner", () => {
  it("gives back an unused ticket, once", async () => {
    await limits({});
    const u = await user("release");
    const before = await globalToday(api);
    const id = await granted(u);
    assert.equal((await release(u, id)).body, true);
    assert.equal(
      (await release(u, id)).body,
      false,
      "a second release must give nothing",
    );
    assert.equal(await userToday(api, u), 0);
    assert.equal(await globalToday(api), before);
    assert.equal((await ticket(api, id)).state, "released");
  });

  it("never gives back a started ticket, whatever the model did", async () => {
    await limits({});
    for (const outcome of ["succeeded", "failed", "cancelled"]) {
      const u = await user(`started-${outcome}`);
      const id = await granted(u);
      assert.equal((await start(u, id)).body, true);
      assert.equal((await release(u, id)).body, false);
      assert.equal((await finish(u, id, outcome)).body, true);
      assert.equal((await release(u, id)).body, false);
      assert.equal(await userToday(api, u), 1, `${outcome} must stay counted`);
      assert.equal((await ticket(api, id)).state, outcome);
    }
  });

  it("lets only a started ticket read the corpus, at most ten passages", async () => {
    await limits({});
    const u = await user("searched");
    const id = await granted(u);
    assert.equal(
      sqlState(await search(u, id)),
      "42501",
      "a reserved ticket cannot search",
    );
    assert.deepEqual((await read(u, id)).body, [], "nothing searched yet");
    await start(u, id);
    assert.deepEqual((await read(u, id)).body, [], "nothing searched yet");
    assert.equal((await search(u, id)).status, 204);
    const found = await read(u, id);
    assert.equal(found.status, 200);
    assert.ok(found.body.length > 0 && found.body.length <= 10);
  });

  it("returns ten passages at most, in the language asked for, nearest first", async () => {
    await limits({});
    const u = await user("search-cap");
    const fr = await begun(u);
    assert.equal((await search(u, fr, "fr", 1000)).status, 204);
    const french = await read(u, fr);
    assert.equal(french.status, 200);
    assert.deepEqual(
      french.body.map((row) => row.id),
      Array.from({ length: 10 }, (_, i) => `dbtest-fr-${i}`),
    );
    const similarities = french.body.map((row) => row.similarity);
    assert.deepEqual(
      similarities,
      [...similarities].sort((a, b) => b - a),
    );
    assert.equal(french.body[0].body, "Test passage fr-0.");

    const en = await begun(u);
    await search(u, en, "en", 1000);
    const english = await read(u, en);
    assert.ok(english.body.length > 0);
    assert.ok(english.body.every((row) => row.id.startsWith("dbtest-en-")));
  });

  it("refuses to start past the app's monthly ceiling, and the ticket can still be given back", async () => {
    const used = await globalThisMonth(api);
    await limits({ global_monthly: used + 1 });
    const a = await user("start-month-a");
    const b = await user("start-month-b");
    const first = await granted(a);
    const second = await granted(b);
    assert.equal((await start(a, first)).body, true);
    assert.equal(sqlState(await start(b, second)), "53403");
    assert.equal((await ticket(api, second)).state, "reserved");
    assert.equal((await release(b, second)).body, true);
    assert.equal(await userToday(api, b), 0);
    assert.equal(await globalThisMonth(api), used + 1);
  });

  it("does not count a reservation against the app until it starts", async () => {
    await limits({});
    const u = await user("not-yet");
    const before = await globalToday(api);
    const id = await granted(u);
    assert.equal(
      await globalToday(api),
      before,
      "held tickets must not block others",
    );
    await start(u, id);
    assert.equal(await globalToday(api), before + 1);
  });

  it("refuses to start past the app's ceiling, and the ticket can still be given back", async () => {
    const used = await globalToday(api);
    await limits({ global_daily: used + 1 });
    const a = await user("start-race-a");
    const b = await user("start-race-b");
    const first = await granted(a);
    const second = await granted(b);
    assert.equal((await start(a, first)).body, true);
    assert.equal(sqlState(await start(b, second)), "53402");
    assert.equal((await ticket(api, second)).state, "reserved");
    assert.equal((await release(b, second)).body, true);
    assert.equal(await userToday(api, b), 0);
  });

  it("allows one search per ticket", async () => {
    await limits({});
    const u = await user("search-once");
    const id = await begun(u);
    assert.equal((await search(u, id)).status, 204);
    const first = await read(u, id);
    assert.equal(sqlState(await search(u, id, "fr")), "42501");
    assert.deepEqual(
      (await read(u, id)).body,
      first.body,
      "reading again shows the same passages, not new ones",
    );
  });

  it("refuses a search without a live ticket", async () => {
    await limits({});
    const u = await user("search-none");
    assert.equal(sqlState(await search(u, crypto.randomUUID())), "42501");
    const old = await rpc(api, u, "match_style_passages", {
      query_embedding: unitVector(0),
      match_lang: "en",
    });
    assert.equal(old.status, 404, "the search without a ticket must not exist");
    const id = await granted(u);
    await start(u, id);
    await finish(u, id);
    assert.equal(
      sqlState(await search(u, id)),
      "42501",
      "a closed ticket cannot search",
    );
  });

  it("lets one of two parallel searches through", async () => {
    await limits({});
    const u = await user("search-race");
    const id = await begun(u);
    const answers = await Promise.all([search(u, id), search(u, id, "fr")]);
    assert.deepEqual(answers.map((r) => r.status).sort(), [204, 403]);
  });

  it("stops reading once the ticket is closed", async () => {
    await limits({});
    const u = await user("read-closed");
    const id = await begun(u);
    await search(u, id);
    assert.ok((await read(u, id)).body.length > 0);
    await finish(u, id);
    assert.deepEqual((await read(u, id)).body, []);
  });

  it("finishes a started ticket once, and refuses an unknown outcome", async () => {
    await limits({});
    const u = await user("finish");
    const id = await granted(u);
    assert.equal(
      (await finish(u, id)).body,
      false,
      "a ticket that never started",
    );
    await start(u, id);
    assert.equal(sqlState(await finish(u, id, "refunded")), "22023");
    assert.equal((await finish(u, id)).body, true);
    assert.equal((await finish(u, id, "failed")).body, false);
    assert.equal((await ticket(api, id)).state, "succeeded");
  });

  it("starts a ticket once", async () => {
    await limits({});
    const u = await user("start");
    const id = await granted(u);
    assert.equal((await start(u, id)).body, true);
    assert.equal((await start(u, id)).body, false);
    const other = await granted(u);
    await release(u, other);
    assert.equal(
      (await start(u, other)).body,
      false,
      "a released ticket cannot start",
    );
  });

  it("does nothing with another account's ticket", async () => {
    await limits({});
    const owner = await user("owner");
    const thief = await user("thief");
    const id = await granted(owner);
    assert.equal((await release(thief, id)).body, false);
    assert.equal((await start(thief, id)).body, false);
    assert.equal(sqlState(await search(thief, id)), "42501");
    await start(owner, id);
    assert.equal(
      sqlState(await search(thief, id)),
      "42501",
      "a started ticket reads the corpus for its owner only",
    );
    assert.equal((await finish(thief, id)).body, false);
    assert.equal((await ticket(api, id)).state, "started");
    assert.equal(await userToday(api, owner), 1);
    // The owner's one search was not used up
    assert.equal((await search(owner, id)).status, 204);
    assert.ok((await read(owner, id)).body.length > 0);
    assert.deepEqual(
      (await read(thief, id)).body,
      [],
      "what the search found is for its owner only",
    );
  });

  it("does nothing with a made-up ticket", async () => {
    await limits({});
    const u = await user("madeup");
    const fake = crypto.randomUUID();
    assert.equal((await release(u, fake)).body, false);
    assert.equal((await start(u, fake)).body, false);
    assert.equal((await finish(u, fake)).body, false);
    assert.equal(await userToday(api, u), 0);
  });

  it("lets only one of a start and a release racing on the same ticket win", async () => {
    await limits({});
    for (let round = 0; round < 5; round++) {
      const u = await user(`race-ticket-${round}`);
      const id = await granted(u);
      const [started, released] = await Promise.all([
        start(u, id),
        release(u, id),
      ]);
      assert.equal(Number(started.body) + Number(released.body), 1);
      assert.equal(await userToday(api, u), released.body ? 0 : 1);
    }
  });

  it("refunds once when two releases race", async () => {
    await limits({});
    const u = await user("double-release");
    await granted(u);
    const id = await granted(u);
    const both = await Promise.all([release(u, id), release(u, id)]);
    assert.deepEqual(both.map((r) => r.body).sort(), [false, true]);
    assert.equal(await userToday(api, u), 1);
  });
});

describe("abandoned tickets", () => {
  it("frees the slot of a ticket nobody closed, and gives it back only if it was never used", async () => {
    await limits({ max_in_flight: 3, ticket_ttl_seconds: 90 });
    const u = await user("expire");
    const unused = await granted(u);
    const started = await granted(u);
    await start(u, started);
    const searched = await begun(u);
    await search(u, searched);
    assert.equal(
      sqlState(await reserve(u)),
      "53400",
      "three tickets are running",
    );

    for (const id of [unused, started, searched]) await age(api, id, 120);
    // The next reservation closes the old tickets before counting
    await granted(u);
    assert.equal((await ticket(api, unused)).state, "released");
    assert.equal((await ticket(api, started)).state, "expired");
    assert.equal((await ticket(api, searched)).state, "expired");
    // 4 reserved, 1 given back
    assert.equal(await userToday(api, u), 3);
  });

  it("gives an abandoned ticket back to its owner, whoever's reservation closes it", async () => {
    await limits({ ticket_ttl_seconds: 90 });
    const owner = await user("expire-owner");
    const next = await user("expire-next");
    const id = await granted(owner);
    await age(api, id, 120);
    await granted(next);
    assert.equal((await ticket(api, id)).state, "released");
    assert.equal(await userToday(api, owner), 0);
    assert.equal(await userToday(api, next), 1);
  });

  it("refuses to start a ticket past its lifetime", async () => {
    await limits({ ticket_ttl_seconds: 90 });
    const u = await user("stale-start");
    const id = await granted(u);
    await age(api, id, 120);
    assert.equal((await start(u, id)).body, false);
    // Never started, so it can still be given back; left open, the next reservation would
    // release it and move the counters other tests measure
    assert.equal((await release(u, id)).body, true);
  });
});

describe("old tickets", () => {
  // Rows old enough to delete, without going through 200 reservations
  const oldClosed = (u, howMany, daysOld = 3) =>
    api.service("/rest/v1/quota_reservations", {
      method: "POST",
      body: Array.from({ length: howMany }, () => ({
        user_id: u.id,
        day: today(),
        state: "released",
        closed_at: new Date().toISOString(),
        created_at: new Date(Date.now() - daysOld * 86_400_000).toISOString(),
      })),
    });
  const countOld = async (u, olderThanDays = 2) => {
    const { body } = await api.service(
      `/rest/v1/quota_reservations?user_id=eq.${u.id}&created_at=lt.${new Date(Date.now() - olderThanDays * 86_400_000).toISOString()}&select=id`,
    );
    return body.length;
  };

  it("removes a few at a time, on accepted calls", async () => {
    await limits({});
    const u = await user("purge");
    assert.ok((await oldClosed(u, 250)).status < 300);
    await granted(u);
    assert.equal(await countOld(u), 50, "200 removed, 50 left for the next");
    await granted(u);
    assert.equal(await countOld(u), 0);
  });

  it("removes the oldest first", async () => {
    await limits({});
    const u = await user("purge-order");
    assert.ok((await oldClosed(u, 200, 3)).status < 300);
    assert.ok((await oldClosed(u, 5, 4)).status < 300);
    await granted(u);
    assert.equal(await countOld(u), 5, "200 removed");
    assert.equal(await countOld(u, 3.5), 0, "the oldest went first");
  });

  it("keeps tickets younger than two days", async () => {
    await limits({});
    const u = await user("purge-young");
    const closed = await granted(u);
    await release(u, closed);
    await age(api, closed, 86_400);
    await granted(u);
    assert.equal((await ticket(api, closed)).state, "released");
  });
});

describe("the public API offers no way around the counting", () => {
  it("does not run a function that counts through GET", async () => {
    await limits({});
    const u = await user("get");
    const response = await api.call("/rest/v1/rpc/reserve_quota", {
      token: u.token,
    });
    assert.notEqual(response.status, 200);
    assert.equal(await userToday(api, u), 0);
  });

  // Only true where the API keeps its default setting: hosted, that setting cannot be read here
  it("keeps what was counted when a caller asks to roll back", async () => {
    await limits({});
    const u = await user("rollback");
    const rollback = (name, body) =>
      api.call(`/rest/v1/rpc/${name}`, {
        method: "POST",
        token: u.token,
        body,
        prefer: "tx=rollback",
      });

    const reserved = await rollback("reserve_quota", {});
    assert.equal(reserved.status, 200);
    assert.equal(await userToday(api, u), 1);

    const before = await globalToday(api);
    await rollback("start_rewrite", { reservation: reserved.body });
    assert.equal(await globalToday(api), before + 1);

    await rollback("search_style_passages", {
      reservation: reserved.body,
      query_embedding: unitVector(0),
      match_lang: "en",
    });
    assert.equal(
      sqlState(await search(u, reserved.body)),
      "42501",
      "the ticket's one search must stay used",
    );
  });

  // The API runs a call and its outer query in one transaction, so a failing outer query undoes
  // what the function recorded, and a cast error quotes the value it failed on
  it("gives a ticket ten passages at most, even through errors in the outer query", async () => {
    await limits({});
    const u = await user("cast");
    const id = await begun(u);
    const args = {
      reservation: id,
      query_embedding: unitVector(0),
      match_lang: "fr",
    };
    const post = (name, query, body) =>
      api.call(`/rest/v1/rpc/${name}?${query}`, {
        method: "POST",
        token: u.token,
        body,
      });

    // The search hands over no text, whichever way its outer query goes
    for (const query of ["select=body::int", "limit=1&offset=1", "body=eq.x"]) {
      const response = await post("search_style_passages", query, args);
      assert.doesNotMatch(JSON.stringify(response.body), /Test passage/);
    }

    if ((await ticket(api, id)).searched_at === null) {
      assert.equal((await search(u, id, "fr")).status, 204);
    }
    assert.equal(sqlState(await search(u, id, "en")), "42501");

    // Twelve French passages exist: asks for each one by name
    const quoted = new Set();
    for (let i = 0; i < 12; i++) {
      const response = await post(
        "read_style_passages",
        `select=body::int&id=eq.dbtest-fr-${i}`,
        { reservation: id },
      );
      const match = /Test passage [\w-]+\./.exec(JSON.stringify(response.body));
      if (match) quoted.add(match[0]);
    }
    assert.deepEqual(
      [...quoted].sort(),
      Array.from({ length: 10 }, (_, i) => `Test passage fr-${i}.`).sort(),
      "only the ten passages the one search found",
    );
    assert.equal(sqlState(await search(u, id, "fr")), "42501");
  });
});

describe("counters stay consistent", () => {
  it("counts for the account at reservation and for the app at start", async () => {
    await limits({});
    const u = await user("both");
    const before = await globalToday(api);
    const id = await granted(u);
    assert.equal(await userToday(api, u), 1);
    assert.equal(await globalToday(api), before);
    await release(u, id);
    assert.equal(await userToday(api, u), 0);
    await begun(u);
    assert.equal(await userToday(api, u), 1);
    assert.equal(await globalToday(api), before + 1);
  });

  it("restores the global count it found", async () => {
    // Guards the helper the tests rely on to leave the local stack as they found it
    const now = await globalToday(api);
    await setGlobalToday(api, now + 5);
    assert.equal(await globalToday(api), now + 5);
    await setGlobalToday(api, now);
    assert.equal(await globalToday(api), now);
  });
});
