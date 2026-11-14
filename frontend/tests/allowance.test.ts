import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAllowance } from "@/lib/rewrite/allowance";
import { fakeQuery } from "./fake-query";

type Tables = Parameters<typeof readAllowance>[0];
type Day = { day: string; count: number };

const LIMITS = { user_daily: 5, global_daily: 15, global_monthly: 300 };
const NOON = new Date("2026-03-15T12:00:00Z");

// As the database would, only the days from the asked date on come back
function globalDays(days: Day[]) {
  const query = fakeQuery({ data: days, error: null });
  query.gte.mockImplementation((_column, from) => {
    if (!query.answer.error) {
      query.answer = {
        data: days.filter((row) => row.day >= from),
        error: null,
      };
    }
    return query;
  });
  return query;
}

function clients({
  limits = LIMITS,
  days = [] as Day[],
  own = null as { count: number } | null,
} = {}) {
  const reads = {
    quota_limits: fakeQuery({ data: limits, error: null }),
    usage_global: globalDays(days),
    usage: fakeQuery({ data: own, error: null }),
  };
  const server = { from: vi.fn((table: keyof typeof reads) => reads[table]) };
  const session = { from: vi.fn((table: keyof typeof reads) => reads[table]) };
  return {
    reads,
    server,
    session,
    tables: [
      server as unknown as Tables,
      session as unknown as Tables,
    ] as const,
  };
}

type Made = ReturnType<typeof clients>;
const ask = ({ tables }: Made, account: string | null = null, now = NOON) =>
  readAllowance(tables[0], tables[1], account, now);

describe("readAllowance", () => {
  it("gives a visitor the limit, and reads nobody's usage", async () => {
    const made = clients();
    expect(await ask(made)).toEqual({ limit: 5, used: null, open: true });
    expect(made.session.from).not.toHaveBeenCalled();
    expect(made.server.from).not.toHaveBeenCalledWith("usage");
  });

  it("gives an account its own count of the day, read through its own session", async () => {
    const made = clients({ own: { count: 2 } });
    expect(await ask(made, "user-1")).toEqual({
      limit: 5,
      used: 2,
      open: true,
    });
    expect(made.session.from.mock.calls).toEqual([["usage"]]);
    expect(made.server.from).not.toHaveBeenCalledWith("usage");
    expect(made.reads.usage.eq.mock.calls).toEqual([
      ["user_id", "user-1"],
      ["day", "2026-03-15"],
    ]);
  });

  it("counts nothing used for an account with no row today", async () => {
    expect((await ask(clients(), "user-1")).used).toBe(0);
  });

  it("reads the limits and the app-wide counts through the server's client only", async () => {
    const made = clients({ own: { count: 1 } });
    await ask(made, "user-1");
    expect(made.server.from.mock.calls.flat().sort()).toEqual([
      "quota_limits",
      "usage_global",
    ]);
    expect(made.reads.quota_limits.select).toHaveBeenCalledWith(
      "user_daily, global_daily, global_monthly",
    );
  });

  // start_rewrite's windows are the date in UTC, whatever the server's or the reader's zone
  it.each([
    [
      "an evening in UTC, past midnight east of it",
      "2026-03-01T00:30:00+02:00",
      "2026-02-28",
      "2026-02-01",
    ],
    [
      "the last instant of a year",
      "2026-12-31T23:59:59.999Z",
      "2026-12-31",
      "2026-12-01",
    ],
    [
      "the first instant of a year",
      "2027-01-01T00:00:00.000Z",
      "2027-01-01",
      "2027-01-01",
    ],
    [
      "the day after February's last, in a leap year",
      "2028-03-01T00:00:00.000Z",
      "2028-03-01",
      "2028-03-01",
    ],
  ])("takes the UTC day and month on %s", async (_, instant, day, month) => {
    const made = clients();
    await ask(made, "user-1", new Date(instant));
    expect(made.reads.usage.eq).toHaveBeenCalledWith("day", day);
    expect(made.reads.usage_global.gte).toHaveBeenCalledWith("day", month);
  });

  describe("whether rewriting is open", () => {
    const today = (count: number) => ({ day: "2026-03-15", count });

    it.each([
      ["nothing has been used", []],
      ["one short of the daily ceiling", [today(14)]],
      [
        "the daily ceiling was reached yesterday",
        [{ day: "2026-03-14", count: 15 }],
      ],
      ["the monthly total is one short", [{ day: "2026-03-02", count: 299 }]],
      [
        "last month used the whole ceiling",
        [{ day: "2026-02-28", count: 300 }],
      ],
    ] as [string, Day[]][])("is open when %s", async (_, days) => {
      expect((await ask(clients({ days }))).open).toBe(true);
    });

    it.each([
      ["the daily ceiling is reached", {}, [today(15)]],
      ["the daily ceiling is passed", {}, [today(16)]],
      [
        "the month adds up to its ceiling",
        {},
        [
          { day: "2026-03-01", count: 290 },
          { day: "2026-03-14", count: 9 },
          today(1),
        ],
      ],
      ["the day's ceiling is 0, the owner's pause", { global_daily: 0 }, []],
      ["the month's ceiling is 0", { global_monthly: 0 }, []],
      ["no account has any attempt", { user_daily: 0 }, []],
    ] as [string, Partial<typeof LIMITS>, Day[]][])(
      "is closed when %s",
      async (_, limits, days) => {
        const made = clients({ limits: { ...LIMITS, ...limits }, days });
        expect((await ask(made)).open).toBe(false);
      },
    );

    it("counts a row of a later date as the database does", async () => {
      const days = [{ day: "2026-04-02", count: 300 }];
      expect((await ask(clients({ days }))).open).toBe(false);
    });
  });

  it("says nothing of the app-wide counts", async () => {
    const made = clients({
      own: { count: 1 },
      days: [{ day: "2026-03-15", count: 7 }],
    });
    expect(Object.keys(await ask(made, "user-1")).sort()).toEqual([
      "limit",
      "open",
      "used",
    ]);
  });

  it.each(["quota_limits", "usage_global", "usage"] as const)(
    "fails when the read of %s fails",
    async (table) => {
      const made = clients();
      made.reads[table].answer = { data: null, error: { code: "57014" } };
      await expect(ask(made, "user-1")).rejects.toEqual({ code: "57014" });
    },
  );

  it("gives each read a deadline", async () => {
    const made = clients();
    await ask(made, "user-1");
    for (const query of Object.values(made.reads)) {
      expect(query.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    }
  });
});

describe("the store behind the line", () => {
  // It keeps its answer from one call to the next, so each test has its own
  let store: typeof import("@/lib/rewrite/allowance-store");
  const MEMBER = { limit: 5, used: 2, open: true };

  beforeEach(async () => {
    vi.resetModules();
    store = await import("@/lib/rewrite/allowance-store");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const answering = (body: unknown) => {
    const fetchMock = vi.fn(async () => Response.json(body));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("asks without a cache, keeps the answer and tells who listens", async () => {
    const fetchMock = answering({ allowance: MEMBER });
    const listener = vi.fn();
    store.subscribeAllowance(listener);
    await store.refreshAllowance();
    expect(fetchMock).toHaveBeenCalledWith("/api/rewrite", {
      cache: "no-store",
    });
    expect(store.getAllowance()).toMatchObject(MEMBER);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("gives the same object until the next answer, as a store must", async () => {
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    expect(store.getAllowance()).toBe(store.getAllowance());
  });

  it("stops telling a listener that has left", async () => {
    answering({ allowance: MEMBER });
    const listener = vi.fn();
    store.subscribeAllowance(listener)();
    await store.refreshAllowance();
    expect(listener).not.toHaveBeenCalled();
  });

  // The server has no answer to give: the first render over its page must not have one either
  it("has nothing for the server's render, even once it has an answer", async () => {
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    expect(store.getServerAllowance()).toBeNull();
  });

  it.each([
    ["in the evening", "2026-03-15T23:59:59Z", "2026-03-16T00:00:00.000Z"],
    ["at midnight itself", "2026-03-16T00:00:00Z", "2026-03-17T00:00:00.000Z"],
    [
      "at the end of a year",
      "2026-12-31T23:00:00Z",
      "2027-01-01T00:00:00.000Z",
    ],
    [
      "at the end of a leap February",
      "2028-02-29T10:00:00Z",
      "2028-03-01T00:00:00.000Z",
    ],
  ])("comes back at the next UTC midnight, %s", async (_, now, reset) => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    expect(store.getAllowance()?.resetsAt.toISOString()).toBe(reset);
  });

  it("keeps the answer to the latest question, whichever comes back last", async () => {
    const first = Promise.withResolvers<Response>();
    const second = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );
    const listener = vi.fn();
    store.subscribeAllowance(listener);
    const earlier = store.refreshAllowance();
    const later = store.refreshAllowance();
    second.resolve(Response.json({ allowance: { ...MEMBER, used: 3 } }));
    await later;
    first.resolve(Response.json({ allowance: { ...MEMBER, used: 1 } }));
    await earlier;
    expect(store.getAllowance()?.used).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["the site cannot say", { allowance: null }],
    ["an error", { error: "server_error" }],
    ["no body", null],
    ["a limit that is not a number", { allowance: { ...MEMBER, limit: "5" } }],
    ["an open that is not a boolean", { allowance: { ...MEMBER, open: 1 } }],
    ["a count that is not a number", { allowance: { ...MEMBER, used: "2" } }],
    ["a count that is missing", { allowance: { limit: 5, open: true } }],
  ])("drops the line on %s", async (_, body) => {
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    answering(body);
    await store.refreshAllowance();
    expect(store.getAllowance()).toBeNull();
  });

  it("drops the line when the answer is not JSON", async () => {
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"type":"start"}\n{')),
    );
    await store.refreshAllowance();
    expect(store.getAllowance()).toBeNull();
  });

  it("drops the line when the network fails, and does not throw", async () => {
    answering({ allowance: MEMBER });
    await store.refreshAllowance();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(store.refreshAllowance()).resolves.toBeUndefined();
    expect(store.getAllowance()).toBeNull();
  });

  // An attempt ending on a page with no line, such as during a test of the editor alone, asks nothing
  it("asks again after an attempt only while a line is on the page", async () => {
    const fetchMock = answering({ allowance: MEMBER });
    store.nudgeAllowance();
    expect(fetchMock).not.toHaveBeenCalled();
    const leave = store.subscribeAllowance(() => {});
    store.nudgeAllowance();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    leave();
    store.nudgeAllowance();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
