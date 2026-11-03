import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteError } from "@/lib/rewrite/claude";
import { MAX_CHARS } from "@/lib/text";

const requestEdits = vi.fn();
const streamEdits = vi.fn();
// Work scheduled with after() is collected, so tests can wait for it
const scheduled: Promise<unknown>[] = [];
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => Promise<unknown>) => {
    scheduled.push(task());
  },
}));
const createClient = vi.fn();

vi.mock("@/lib/rewrite/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rewrite/claude")>()),
  requestEdits: (...args: unknown[]) => requestEdits(...args),
  streamEdits: (...args: unknown[]) => streamEdits(...args),
}));
const findReferences = vi.fn();
vi.mock("@/lib/style/retrieve", () => ({
  findReferences: (...args: unknown[]) => findReferences(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { POST } = await import("@/app/api/rewrite/route");

const post = (body: unknown, signal?: AbortSignal) =>
  POST(
    new Request("http://localhost/api/rewrite", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    }),
  );

const call = async (body: unknown) => {
  const response = await post(body);
  await Promise.all(scheduled.splice(0));
  return response;
};

const lines = async (response: Response) =>
  (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

type RpcResult = { data: unknown; error: { code: string } | null };

// Fake Supabase client: a signed-in user, and the answers of the quota functions
function fakeSupabase({
  userId = "user-1" as string | null,
  reserve = { data: "res-1", error: null } as RpcResult,
  start = { data: true, error: null } as RpcResult,
  insertError = null as { code: string } | null,
  authError = null as Error | null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const rpc = vi.fn(async (name: string) => {
    if (name === "reserve_quota") return reserve;
    if (name === "start_rewrite") return start;
    return { data: true, error: null };
  });
  const client = {
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : null,
        error: authError,
      }),
    },
    rpc,
    from: vi.fn(() => ({ insert })),
  };
  return { client, insert, rpc };
}

const names = (rpc: ReturnType<typeof fakeSupabase>["rpc"]) =>
  rpc.mock.calls.map(([name]) => name);

const EDIT = { original: "world", replacement: "there", reason: "warmer" };

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  requestEdits.mockReset();
  streamEdits.mockReset();
  createClient.mockReset();
  findReferences.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/rewrite: input and access", () => {
  it("rejects invalid JSON", async () => {
    const response = await call("not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects empty, oversized and unknown-locale input", async () => {
    const bodies = [
      { text: "" },
      { text: "   " },
      { text: "a".repeat(MAX_CHARS + 1) },
      { text: "hello", locale: "de" },
    ];
    for (const body of bodies) {
      expect((await call(body)).status).toBe(400);
    }
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("rejects an oversized body before parsing it", async () => {
    const response = await call("x".repeat(41_000));
    expect(response.status).toBe(413);
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("refuses an unknown intensity and an oversized voice", async () => {
    expect((await call({ text: "hi", strength: "extreme" })).status).toBe(400);
    expect((await call({ text: "hi", voice: "v".repeat(1501) })).status).toBe(
      400,
    );
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the API key is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    createClient.mockResolvedValue(fakeSupabase().client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
  });

  it("fails closed when Supabase is not configured", async () => {
    createClient.mockResolvedValue(null);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("requires a signed-in user before anything else", async () => {
    const { client, rpc } = fakeSupabase({ userId: null });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
    expect(findReferences).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("does not tell a signed-in user to sign in when the auth server is out of reach", async () => {
    const { client, rpc } = fakeSupabase({
      userId: null,
      // Status 0: no answer at all, which only the error's type tells apart
      authError: new AuthRetryableFetchError("fetch failed", 0),
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(rpc).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it.each([429, 500])(
    "does not tell a signed-in user to sign in when the auth server answers %s",
    async (status) => {
      const { client, rpc } = fakeSupabase({
        userId: null,
        authError: new AuthApiError("try later", status, undefined),
      });
      createClient.mockResolvedValue(client);
      const response = await call({ text: "hello" });
      expect(response.status).toBe(500);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("still answers unauthorized to a token the auth server rejects", async () => {
    const { client, rpc } = fakeSupabase({
      userId: null,
      authError: new AuthApiError("invalid JWT", 403, "bad_jwt"),
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/rewrite: quota before any cost", () => {
  it("leaves the limits to the database: reserve_quota takes no argument", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello" });
    expect(rpc).toHaveBeenCalledWith("reserve_quota");
  });

  it.each([
    ["53400", "too_many_requests"],
    ["53401", "quota_exceeded"],
    ["53402", "global_quota_exceeded"],
    ["53403", "global_quota_exceeded"],
  ])(
    "maps a refusal %s to %s, before the search and the model",
    async (sqlState, code) => {
      const { client, rpc } = fakeSupabase({
        reserve: { data: null, error: { code: sqlState } },
      });
      createClient.mockResolvedValue(client);
      const response = await call({ text: "hello" });
      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: code });
      // Nothing was spent and nothing was reserved, so there is nothing to give back
      expect(findReferences).not.toHaveBeenCalled();
      expect(requestEdits).not.toHaveBeenCalled();
      expect(names(rpc)).toEqual(["reserve_quota"]);
    },
  );

  it("still refuses with plain JSON, not a stream, when streaming was asked", async () => {
    const { client } = fakeSupabase({
      reserve: { data: null, error: { code: "53401" } },
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello", stream: true });
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("json");
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the quota check errors", async () => {
    const { client } = fakeSupabase({
      reserve: { data: null, error: { code: "PGRST000" } },
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(findReferences).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the database cannot be reached at all", async () => {
    const { client, rpc } = fakeSupabase();
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello", stream: true });
    expect(response.status).toBe(500);
    expect(streamEdits).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the quota check returns no ticket", async () => {
    const { client } = fakeSupabase({ reserve: { data: null, error: null } });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it.each([
    ["refuses the ticket", { data: false, error: null }, 500, "server_error"],
    ["errors", { data: null, error: { code: "XX000" } }, 500, "server_error"],
    [
      "finds the app's daily ceiling reached",
      { data: null, error: { code: "53402" } },
      429,
      "global_quota_exceeded",
    ],
    [
      "finds the app's monthly ceiling reached",
      { data: null, error: { code: "53403" } },
      429,
      "global_quota_exceeded",
    ],
  ])(
    "does not search or call the model when start_rewrite %s, and gives the attempt back",
    async (_case, start, status, code) => {
      const { client, rpc } = fakeSupabase({ start: start as RpcResult });
      createClient.mockResolvedValue(client);
      const response = await call({ text: "hello", stream: true });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
      expect(findReferences).not.toHaveBeenCalled();
      expect(streamEdits).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith("release_quota", {
        reservation: "res-1",
      });
      expect(rpc).not.toHaveBeenCalledWith("finish_rewrite", expect.anything());
    },
  );

  it("reserves, then starts, then searches: each step waits for the one before", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const order: string[] = [];
    const slow = async <T>(name: string, value: T) => {
      order.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${name}`);
      return value;
    };
    rpc.mockImplementation(async (name: string) =>
      slow(name, {
        data: name === "reserve_quota" ? "res-1" : true,
        error: null,
      }),
    );
    findReferences.mockImplementation(() => slow("references", []));
    requestEdits.mockImplementation(() => slow("model", []));
    await call({ text: "hello" });

    expect(order.slice(0, 8)).toEqual([
      "start:reserve_quota",
      "end:reserve_quota",
      "start:start_rewrite",
      "end:start_rewrite",
      "start:references",
      "end:references",
      "start:model",
      "end:model",
    ]);
  });

  // Once a ticket exists, the platform may end the function when the reader leaves, except for
  // work handed to after(): nothing that closes the ticket may wait until the answer is ready
  it("holds the function open from the moment a ticket exists", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    streamEdits.mockResolvedValue([]);
    let heldAtStart = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name === "start_rewrite") heldAtStart = scheduled.length;
      return {
        data: name === "reserve_quota" ? "res-1" : true,
        error: null,
      };
    });
    const response = await call({ text: "hello", stream: true });
    await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(heldAtStart).toBe(1);
  });

  // The platform may end the function once the reader has left, except for work given to after().
  // These hold on until the ticket is closed; the test's after() runs what it is handed.
  describe("what after() is handed stays open until the ticket is closed", () => {
    const pendingFinish = (name: string) => {
      const { client, rpc } = fakeSupabase();
      createClient.mockResolvedValue(client);
      let close = () => {};
      const closed = new Promise<void>((resolve) => {
        close = resolve;
      });
      rpc.mockImplementation(async (called: string) => {
        if (called === name) await closed;
        return {
          data: called === "reserve_quota" ? "res-1" : true,
          error: null,
        };
      });
      return { close, rpc };
    };
    const settled = async () => {
      const held = Promise.all(scheduled.splice(0)).then(() => true);
      const waited = new Promise((resolve) =>
        setTimeout(() => resolve(false), 30),
      );
      return Promise.race([held, waited]);
    };

    it("on a streamed answer", async () => {
      const { close, rpc } = pendingFinish("finish_rewrite");
      streamEdits.mockResolvedValue([]);
      const response = await post({ text: "hello", stream: true });
      await lines(response);
      const handed = scheduled.slice();
      expect(await settled()).toBe(false);
      expect(rpc).toHaveBeenCalledWith("finish_rewrite", expect.anything());
      close();
      await Promise.all(handed);
    });

    it("on a whole answer", async () => {
      const { close } = pendingFinish("finish_rewrite");
      requestEdits.mockResolvedValue([]);
      await post({ text: "hello" });
      const handed = scheduled.slice();
      expect(await settled()).toBe(false);
      close();
      await Promise.all(handed);
    });

    it("on a failed whole answer", async () => {
      const { close } = pendingFinish("finish_rewrite");
      requestEdits.mockRejectedValue(new RewriteError("busy", 503));
      await post({ text: "hello" });
      const handed = scheduled.slice();
      expect(await settled()).toBe(false);
      close();
      await Promise.all(handed);
    });

    it("when the attempt goes back", async () => {
      const { close, rpc } = pendingFinish("release_quota");
      const controller = new AbortController();
      const answer = rpc.getMockImplementation()!;
      rpc.mockImplementation(async (name: string) => {
        if (name === "reserve_quota") controller.abort();
        return answer(name);
      });
      await post({ text: "hello", stream: true }, controller.signal);
      const handed = scheduled.slice();
      expect(await settled()).toBe(false);
      expect(rpc).toHaveBeenCalledWith("release_quota", expect.anything());
      close();
      await Promise.all(handed);
    });
  });

  it("lets go of the function on every way out", async () => {
    const paths = [
      fakeSupabase({ start: { data: false, error: null } }),
      fakeSupabase(),
    ];
    for (const { client } of paths) {
      createClient.mockResolvedValue(client);
      requestEdits.mockResolvedValue([]);
      await post({ text: "hello" });
      await expect(
        Promise.race([
          Promise.all(scheduled.splice(0)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("still held")), 500),
          ),
        ]),
      ).resolves.toBeDefined();
    }
  });

  it("gives the attempt back when the reader left before the start", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const controller = new AbortController();
    rpc.mockImplementation(async (name: string) => {
      if (name === "reserve_quota") {
        controller.abort();
        return { data: "res-1", error: null };
      }
      return { data: true, error: null };
    });
    const response = await post(
      { text: "hello", stream: true },
      controller.signal,
    );
    await Promise.all(scheduled.splice(0));
    expect(response.status).toBe(499);
    expect(names(rpc)).toEqual(["reserve_quota", "release_quota"]);
    expect(findReferences).not.toHaveBeenCalled();
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("hands the ticket to the style search", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "Hello world", locale: "fr" });
    expect(findReferences).toHaveBeenCalledWith(
      client,
      "res-1",
      "Hello world",
      "fr",
    );
  });
});

describe("POST /api/rewrite: one answer at a time", () => {
  it("returns located edits and saves them to the history", async () => {
    const { client, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([
      EDIT,
      { original: "missing", replacement: "x", reason: "not in text" },
    ]);

    const response = await call({ text: "Hello world", locale: "fr" });
    expect(response.status).toBe(200);
    const { edits } = await response.json();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ id: "edit-0", start: 6, end: 11 });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        original: "Hello world",
        edits: [
          expect.objectContaining({
            id: "edit-0",
            original: "world",
            replacement: "there",
            start: 6,
            end: 11,
          }),
        ],
        edit_count: 1,
        locale: "fr",
      }),
    );
  });

  it("does not call an answer whose every edit failed a check 'nothing to change'", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([
      { original: "missing", replacement: "x", reason: "not in text" },
      { original: "world 12", replacement: "world 13", reason: "changed" },
    ]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_error" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "failed",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does call it 'nothing to change' when every edit changed nothing anyway", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([
      { original: "world", replacement: "world", reason: "fine" },
    ]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect((await response.json()).edits).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ edits: [], edit_count: 0 }),
    );
  });

  it("closes the ticket as a success, without giving the attempt back", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({ text: "Hello world" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("passes the style references to Claude and credits them in the response", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const refs = [
      {
        id: "1",
        author: "Jane Austen",
        title: "Emma",
        kind: "fiction",
        body: "b",
        similarity: 0.4,
      },
    ];
    findReferences.mockResolvedValue(refs);
    requestEdits.mockResolvedValue([EDIT]);

    const response = await call({ text: "Hello world" });
    expect(requestEdits).toHaveBeenCalledWith(
      "Hello world",
      refs,
      undefined,
      { strength: "standard", voice: undefined },
      expect.any(Number),
    );
    const body = await response.json();
    expect(body.references).toEqual([{ author: "Jane Austen", title: "Emma" }]);
    // The excerpt goes to the model, never back to the browser
    expect(JSON.stringify(body)).not.toContain('"body"');
  });

  describe("the time already used by the request", () => {
    // The model's deadline counts from the request's arrival, whatever came before it
    const slowSearch = () =>
      findReferences.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 40)),
      );

    it("reaches the model call of a whole answer", async () => {
      const { client } = fakeSupabase();
      createClient.mockResolvedValue(client);
      slowSearch();
      requestEdits.mockResolvedValue([EDIT]);
      await call({ text: "Hello world" });
      expect(requestEdits.mock.calls[0].at(-1)).toBeGreaterThanOrEqual(30);
    });

    it("reaches the model call of a stream", async () => {
      const { client } = fakeSupabase();
      createClient.mockResolvedValue(client);
      slowSearch();
      streamEdits.mockResolvedValue([]);
      const response = await call({ text: "Hello world", stream: true });
      await response.text();
      expect(streamEdits.mock.calls[0].at(-1)).toBeGreaterThanOrEqual(30);
    });
  });

  it("rewrites without references when none are found", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect((await response.json()).references).toEqual([]);
  });

  it("passes the intensity and the voice to the model", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello", strength: "light", voice: "Short lines." });
    expect(requestEdits).toHaveBeenCalledWith(
      "hello",
      [],
      undefined,
      { strength: "light", voice: "Short lines." },
      expect.any(Number),
    );
  });

  it("never stores the voice sample in the history", async () => {
    const { client, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({ text: "Hello world", voice: "My own unmistakable voice." });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(insert.mock.calls)).not.toContain("unmistakable");
  });

  it("does not make the user wait for the history save", async () => {
    const { client, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    let release: () => void = () => {};
    insert.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({ error: null });
      }),
    );
    requestEdits.mockResolvedValue([EDIT]);
    const response = await Promise.race([
      post({ text: "Hello world" }),
      new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 500)),
    ]);
    // The save is still pending, yet the answer is already there
    expect(response).toBeInstanceOf(Response);
    release();
    await Promise.all(scheduled.splice(0));
  });

  it("reports where the time went in a Server-Timing header", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    const response = await call({ text: "hello" });
    expect(response.headers.get("Server-Timing")).toMatch(
      /^prep;dur=\d+, model;dur=\d+, total;dur=\d+$/,
    );
  });

  it("keeps a model failure counted: the ticket closes as failed, nothing is given back", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new RewriteError("busy", 503));

    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "busy" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "failed",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps a refusal counted too", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new RewriteError("refused", 422));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(422);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "failed",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("does not turn a success into a refund when closing the ticket fails", async () => {
    const { client, rpc } = fakeSupabase();
    rpc.mockImplementation(async (name: string) =>
      name === "reserve_quota"
        ? { data: "res-1", error: null }
        : name === "finish_rewrite"
          ? { data: null, error: { code: "XX000" } }
          : { data: true, error: null },
    );
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("still returns the result, and closes the ticket, when saving the history fails", async () => {
    const { client, rpc } = fakeSupabase({ insertError: { code: "42501" } });
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
  });

  it("still closes the ticket when saving the history throws, and logs no message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, rpc, insert } = fakeSupabase();
    insert.mockRejectedValue(new TypeError("fetch failed: my secret text"));
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(logged).toHaveBeenCalledWith("History save failed", "TypeError");
    expect(logged.mock.calls.flat().map(String).join(" ")).not.toContain(
      "secret",
    );
  });

  it("hides unexpected errors behind a generic code, and keeps them out of the logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new Error("secret details"));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret");
  });
});

describe("POST /api/rewrite: streamed answers", () => {
  // The page always streams, so this is the path that promises the browser no excerpt
  it("sends only the source of each excerpt to the browser", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    findReferences.mockResolvedValue([
      {
        id: "p1",
        author: "Jane Austen",
        title: "Emma",
        kind: "fiction",
        year: 1815,
        body: "The whole excerpt, which stays on the server.",
        similarity: 0.5,
      },
    ]);
    streamEdits.mockResolvedValue([]);
    const response = await call({ text: "Hello world", stream: true });
    const [first] = await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(first).toEqual({
      type: "start",
      references: [{ author: "Jane Austen", title: "Emma" }],
    });
  });

  it("streams when asked: events, then the history and a closed ticket", async () => {
    const { client, insert, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit({ original: "world", replacement: "there", reason: "warmer" });
    });
    const response = await call({ text: "Hello world", stream: true });
    const sent = await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(sent.map((l) => l.type)).toEqual(["start", "edit", "done"]);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ edit_count: 1 }),
    );
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
  });

  it("streams a failure as an event, and the attempt stays counted", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    streamEdits.mockRejectedValue(new RewriteError("busy", 503));
    const response = await call({ text: "hello", stream: true });
    const sent = await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "failed",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("counts the attempt when the reader leaves while the model writes", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const controller = new AbortController();
    streamEdits.mockImplementation(
      async (_t, _r, _e, _o, _c, signal: AbortSignal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve()),
        );
      },
    );
    const response = await post(
      { text: "hello", stream: true },
      controller.signal,
    );
    expect(response.status).toBe(200);
    controller.abort();
    await Promise.all(scheduled.splice(0));
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "cancelled",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  // Started, then the reader left: no refund, because the ticket no longer proves nothing was
  // spent. The attempt counts, and the abort stops the call before it reaches the service.
  it("counts the attempt when the reader leaves before the model is called", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const controller = new AbortController();
    findReferences.mockImplementation(async () => {
      controller.abort();
      return [];
    });
    let sawAbort = false;
    streamEdits.mockImplementation(
      async (_t, _r, _e, _o, _c, signal: AbortSignal) => {
        sawAbort = signal.aborted;
        throw new RewriteError("upstream_error", 502);
      },
    );
    const response = await post(
      { text: "hello", stream: true },
      controller.signal,
    );
    expect(response.status).toBe(200);
    await Promise.all(scheduled.splice(0));
    expect(sawAbort).toBe(true);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "cancelled",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("closes the ticket even when the history cannot be saved", async () => {
    const { client, rpc } = fakeSupabase({ insertError: { code: "42501" } });
    createClient.mockResolvedValue(client);
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(EDIT);
    });
    const response = await call({ text: "Hello world", stream: true });
    await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
      outcome: "succeeded",
    });
  });
});
