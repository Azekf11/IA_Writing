import { format } from "node:util";
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
const createServiceClient = vi.fn();

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
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
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

// The two fake clients: the session only says who is asking and holds no rpc and no table, so a
// quota call or a history write through it fails the test. The server's answers the quota functions.
function fakeSupabase({
  userId = "user-1" as string | null,
  reserve = { data: "res-1", error: null } as RpcResult,
  start = { data: true, error: null } as RpcResult,
  insertError = null as {
    code: string;
    message?: string;
    details?: string;
  } | null,
  authError = null as Error | null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const rpc = vi.fn(async (name: string) => {
    if (name === "reserve_quota") return reserve;
    if (name === "start_rewrite") return start;
    return { data: true, error: null };
  });
  const server = { rpc, from: vi.fn(() => ({ insert })) };
  const client = {
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : null,
        error: authError,
      }),
    },
    server,
  };
  return { client, server, insert, rpc };
}

const connect = (client: ReturnType<typeof fakeSupabase>["client"]) => {
  createClient.mockResolvedValue(client);
  createServiceClient.mockReturnValue(client.server);
};

const names = (rpc: ReturnType<typeof fakeSupabase>["rpc"]) =>
  rpc.mock.calls.map(([name]) => name);

const EDIT = { original: "world", replacement: "there", reason: "warmer" };

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  requestEdits.mockReset();
  streamEdits.mockReset();
  createClient.mockReset();
  createServiceClient.mockReset();
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

  describe("the 40 000 byte bound", () => {
    // Everything after the bound is untouched: the session, the quota and the model
    const nothingElseRan = () => {
      expect(createClient).not.toHaveBeenCalled();
      expect(createServiceClient).not.toHaveBeenCalled();
      expect(requestEdits).not.toHaveBeenCalled();
      expect(streamEdits).not.toHaveBeenCalled();
    };

    it("refuses a body one byte over it", async () => {
      expect((await call("x".repeat(40_001))).status).toBe(413);
      nothingElseRan();
    });

    it("lets a body of exactly that size through to the next check", async () => {
      expect((await call("x".repeat(40_000))).status).toBe(400);
      nothingElseRan();
    });

    it("counts bytes, not characters", async () => {
      // 20 002 characters, far under the bound as characters, 40 002 bytes
      expect((await call(`"${"é".repeat(20_000)}"`)).status).toBe(413);
      expect((await call("€".repeat(13_334))).status).toBe(413);
      expect((await call("😀".repeat(10_001))).status).toBe(413);
      nothingElseRan();
      // The same characters, at the bound itself, reach the JSON check, not the size check
      expect((await call("é".repeat(20_000))).status).toBe(400);
      nothingElseRan();
    });

    // A stream has no Content-Length: only the bytes read can stop it
    const endless = () => {
      const seen = { pulled: 0, cancelled: false };
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          seen.pulled += 1;
          controller.enqueue(new Uint8Array(4_096).fill(120));
        },
        cancel() {
          seen.cancelled = true;
        },
      });
      return { body, seen };
    };
    const postStream = (body: ReadableStream<Uint8Array>, headers = {}) =>
      POST(
        new Request("http://localhost/api/rewrite", {
          method: "POST",
          body,
          headers,
          duplex: "half",
        } as RequestInit),
      );

    it("stops reading a body with no length, and tells the source to stop", async () => {
      const { body, seen } = endless();
      const request = postStream(body);
      expect((await request).status).toBe(413);
      expect(seen.cancelled).toBe(true);
      // 40 000 bytes are 10 pieces of 4 096; the stream may read a few ahead, never all of it
      expect(seen.pulled).toBeLessThan(16);
      nothingElseRan();
    });

    it("does not believe a Content-Length that says less than was sent", async () => {
      const { body, seen } = endless();
      const response = await postStream(body, { "content-length": "10" });
      expect(response.status).toBe(413);
      expect(seen.cancelled).toBe(true);
      nothingElseRan();
    });

    it("reassembles a character cut between two pieces", async () => {
      const whole = new TextEncoder().encode(
        JSON.stringify({ text: "déjà vu", locale: "fr" }),
      );
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const byte of whole) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      });
      const { client } = fakeSupabase();
      connect(client);
      requestEdits.mockResolvedValue([]);
      const response = await postStream(body);
      await Promise.all(scheduled.splice(0));
      expect(response.status).toBe(200);
      expect(requestEdits.mock.calls[0][0]).toBe("déjà vu");
    });

    it("answers 400 when the reader leaves mid-body", async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("connection lost"));
        },
      });
      expect((await postStream(body)).status).toBe(400);
      nothingElseRan();
    });

    it("still accepts the largest valid request, every character escaped", async () => {
      const escaped = (count: number) => "\\u20ac".repeat(count);
      const largest = `{"text":"${escaped(MAX_CHARS)}","voice":"${escaped(1500)}","locale":"en","strength":"standard","stream":false}`;
      expect(new TextEncoder().encode(largest).length).toBeLessThanOrEqual(
        40_000,
      );
      const { client } = fakeSupabase();
      connect(client);
      requestEdits.mockResolvedValue([]);
      expect((await call(largest)).status).toBe(200);
      expect(requestEdits).toHaveBeenCalledOnce();
    });
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
    const { client, rpc } = fakeSupabase();
    connect(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when Supabase is not configured", async () => {
    createClient.mockResolvedValue(null);
    createServiceClient.mockReturnValue(fakeSupabase().server);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the server's key is missing, as on a preview", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    createServiceClient.mockReturnValue(null);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(rpc).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("requires a signed-in user before anything else", async () => {
    const { client, rpc } = fakeSupabase({ userId: null });
    connect(client);
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
    connect(client);
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
      connect(client);
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
    connect(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/rewrite: the account comes from the verified session", () => {
  it("ignores an account named in the request", async () => {
    const { client, rpc, insert } = fakeSupabase({ userId: "user-1" });
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({
      text: "Hello world",
      account: "someone-else",
      user_id: "someone-else",
      reservation: "someone-elses-ticket",
    });
    for (const [, args] of rpc.mock.calls as unknown as [string, object][]) {
      expect(args).toMatchObject({ account: "user-1" });
    }
    expect(rpc).toHaveBeenCalledWith(
      "start_rewrite",
      expect.objectContaining({ reservation: "res-1" }),
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1" }),
    );
  });

  it("passes the session's account to every step of a streamed attempt", async () => {
    const { client, rpc } = fakeSupabase({ userId: "user-7" });
    connect(client);
    streamEdits.mockResolvedValue([]);
    const response = await call({ text: "hello", stream: true });
    await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(names(rpc)).toEqual([
      "reserve_quota",
      "start_rewrite",
      "finish_rewrite",
    ]);
    for (const [, args] of rpc.mock.calls as unknown as [string, object][]) {
      expect(args).toMatchObject({ account: "user-7" });
    }
  });
});

describe("POST /api/rewrite: quota before any cost", () => {
  it("leaves the limits to the database: reserve_quota takes the session's account, nothing else", async () => {
    const { client, rpc } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello" });
    expect(rpc).toHaveBeenCalledWith("reserve_quota", { account: "user-1" });
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
      connect(client);
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
    connect(client);
    const response = await call({ text: "hello", stream: true });
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("json");
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the quota check errors", async () => {
    const { client } = fakeSupabase({
      reserve: { data: null, error: { code: "PGRST000" } },
    });
    connect(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(findReferences).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the database cannot be reached at all", async () => {
    const { client, rpc } = fakeSupabase();
    rpc.mockRejectedValue(new TypeError("fetch failed"));
    connect(client);
    const response = await call({ text: "hello", stream: true });
    expect(response.status).toBe(500);
    expect(streamEdits).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("fails closed when the quota check returns no ticket", async () => {
    const { client } = fakeSupabase({ reserve: { data: null, error: null } });
    connect(client);
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
      connect(client);
      const response = await call({ text: "hello", stream: true });
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: code });
      expect(findReferences).not.toHaveBeenCalled();
      expect(streamEdits).not.toHaveBeenCalled();
      expect(rpc).toHaveBeenCalledWith("release_quota", {
        account: "user-1",
        reservation: "res-1",
      });
      expect(rpc).not.toHaveBeenCalledWith("finish_rewrite", expect.anything());
    },
  );

  it("reserves, then starts, then searches: each step waits for the one before", async () => {
    const { client, rpc } = fakeSupabase();
    connect(client);
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
    connect(client);
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
      connect(client);
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
      connect(client);
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
    connect(client);
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
    expect(rpc).toHaveBeenCalledWith("release_quota", {
      account: "user-1",
      reservation: "res-1",
    });
    expect(findReferences).not.toHaveBeenCalled();
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("hands the account and the ticket to the style search", async () => {
    const { client, server } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "Hello world", locale: "fr" });
    expect(findReferences).toHaveBeenCalledWith(
      server,
      "user-1",
      "res-1",
      "Hello world",
      "fr",
    );
  });
});

describe("POST /api/rewrite: one answer at a time", () => {
  it("returns located edits and saves them to the history", async () => {
    const { client, insert } = fakeSupabase();
    connect(client);
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
    connect(client);
    requestEdits.mockResolvedValue([
      { original: "missing", replacement: "x", reason: "not in text" },
      { original: "world 12", replacement: "world 13", reason: "changed" },
    ]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_error" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "failed",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("does call it 'nothing to change' when every edit changed nothing anyway", async () => {
    const { client, rpc, insert } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([
      { original: "world", replacement: "world", reason: "fine" },
    ]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect((await response.json()).edits).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ edits: [], edit_count: 0 }),
    );
  });

  it("closes the ticket as a success, without giving the attempt back", async () => {
    const { client, rpc } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({ text: "Hello world" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("passes the style references to Claude and credits them in the response", async () => {
    const { client } = fakeSupabase();
    connect(client);
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
      expect.any(Object),
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
      connect(client);
      slowSearch();
      requestEdits.mockResolvedValue([EDIT]);
      await call({ text: "Hello world" });
      expect(requestEdits.mock.calls[0][4]).toBeGreaterThanOrEqual(30);
    });

    it("reaches the model call of a stream", async () => {
      const { client } = fakeSupabase();
      connect(client);
      slowSearch();
      streamEdits.mockResolvedValue([]);
      const response = await call({ text: "Hello world", stream: true });
      await response.text();
      expect(streamEdits.mock.calls[0][6]).toBeGreaterThanOrEqual(30);
    });
  });

  it("rewrites without references when none are found", async () => {
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect((await response.json()).references).toEqual([]);
  });

  it("passes the intensity and the voice to the model", async () => {
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello", strength: "light", voice: "Short lines." });
    expect(requestEdits).toHaveBeenCalledWith(
      "hello",
      [],
      undefined,
      { strength: "light", voice: "Short lines." },
      expect.any(Number),
      expect.any(Object),
    );
  });

  it("never stores the voice sample in the history", async () => {
    const { client, insert } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({ text: "Hello world", voice: "My own unmistakable voice." });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(insert.mock.calls)).not.toContain("unmistakable");
  });

  it("does not make the user wait for the history save", async () => {
    const { client, insert, rpc } = fakeSupabase();
    connect(client);
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
    // And the ticket closes without it: a stalled save must not hold the slot
    const handed = scheduled.splice(0);
    await vi.waitFor(() => {
      expect(insert).toHaveBeenCalledOnce();
      expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
        account: "user-1",
        reservation: "res-1",
        outcome: "succeeded",
      });
    });
    release();
    await Promise.all(handed);
  });

  it("saves the history without waiting for the ticket to close", async () => {
    const { client, insert, rpc } = fakeSupabase();
    connect(client);
    let release: () => void = () => {};
    const closing = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpc.mockImplementation(async (name: string) => {
      if (name === "finish_rewrite") await closing;
      return { data: name === "reserve_quota" ? "res-1" : true, error: null };
    });
    requestEdits.mockResolvedValue([EDIT]);
    expect((await post({ text: "Hello world" })).status).toBe(200);
    const handed = scheduled.splice(0);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledOnce());
    release();
    await Promise.all(handed);
  });

  it("reports where the time went in a Server-Timing header", async () => {
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockResolvedValue([]);
    const response = await call({ text: "hello" });
    expect(response.headers.get("Server-Timing")).toMatch(
      /^prep;dur=\d+, model;dur=\d+, total;dur=\d+$/,
    );
  });

  it("keeps a model failure counted: the ticket closes as failed, nothing is given back", async () => {
    const { client, rpc, insert } = fakeSupabase();
    connect(client);
    requestEdits.mockRejectedValue(new RewriteError("busy", 503));

    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "busy" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "failed",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps a refusal counted too", async () => {
    const { client, rpc } = fakeSupabase();
    connect(client);
    requestEdits.mockRejectedValue(new RewriteError("refused", 422));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(422);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
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
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("still returns the result, and closes the ticket, when saving the history fails", async () => {
    const { client, rpc } = fakeSupabase({ insertError: { code: "42501" } });
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
  });

  it("still closes the ticket when saving the history throws, and logs no message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, rpc, insert } = fakeSupabase();
    insert.mockRejectedValue(new TypeError("fetch failed: my secret text"));
    connect(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
    expect(logged).toHaveBeenCalledWith("History save failed", "TypeError");
    expect(format(...logged.mock.calls.flat())).not.toContain("secret");
  });

  it("hides unexpected errors behind a generic code, and keeps them out of the logs", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockRejectedValue(new Error("secret details"));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
    expect(logged).toHaveBeenCalledExactlyOnceWith(
      "Unhandled rewrite error",
      "Error",
    );
    expect(format(...logged.mock.calls.flat())).not.toContain("secret");
  });
});

describe("POST /api/rewrite: streamed answers", () => {
  // The page always streams, so this is the path that promises the browser no excerpt
  it("sends only the source of each excerpt to the browser", async () => {
    const { client } = fakeSupabase();
    connect(client);
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
    connect(client);
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
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
  });

  it("streams a failure as an event, and the attempt stays counted", async () => {
    const { client, rpc, insert } = fakeSupabase();
    connect(client);
    streamEdits.mockRejectedValue(new RewriteError("busy", 503));
    const response = await call({ text: "hello", stream: true });
    const sent = await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "failed",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("counts the attempt when the reader leaves while the model writes", async () => {
    const { client, rpc, insert } = fakeSupabase();
    connect(client);
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
      account: "user-1",
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
    connect(client);
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
      account: "user-1",
      reservation: "res-1",
      outcome: "cancelled",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
    expect(insert).not.toHaveBeenCalled();
  });

  it("closes the ticket even when the history cannot be saved", async () => {
    const { client, rpc } = fakeSupabase({ insertError: { code: "42501" } });
    connect(client);
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit(EDIT);
    });
    const response = await call({ text: "Hello world", stream: true });
    await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      account: "user-1",
      reservation: "res-1",
      outcome: "succeeded",
    });
  });
});

describe("POST /api/rewrite: what an attempt leaves in the logs", () => {
  const CANARY = "CANARY-do-not-log";
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(format(...args));
      });
    }
  });

  const attempts = () =>
    logged
      .filter((line) => line.startsWith("Rewrite attempt "))
      .map((line) => JSON.parse(line.slice("Rewrite attempt ".length)));

  const fills = (report: object) =>
    Object.assign(report, {
      model: "claude-test",
      stopReason: "end_turn",
      inputTokens: 1200,
      outputTokens: 340,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      modelMs: 987.6,
      firstEditMs: 123.4,
    });

  it("says how a whole answer went, in numbers", async () => {
    const { client } = fakeSupabase();
    connect(client);
    findReferences.mockResolvedValue([
      {
        id: "p",
        author: "A",
        title: "T",
        kind: "essay",
        year: null,
        body: "b",
        similarity: 0.5,
      },
    ]);
    requestEdits.mockImplementation(
      async (_t, _r, _c, _o, _e, report: object) => {
        fills(report);
        return [EDIT, { original: "gone", replacement: "x", reason: "r" }];
      },
    );
    await call({ text: "Hello world" });
    expect(attempts()).toEqual([
      {
        state: "succeeded",
        model: "claude-test",
        stop_reason: "end_turn",
        input_tokens: 1200,
        output_tokens: 340,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        prep_ms: expect.any(Number),
        model_ms: 988,
        first_edit_ms: 123,
        references: 1,
        edits: 1,
        dropped: 1,
      },
    ]);
  });

  it("says how a streamed answer went", async () => {
    const { client } = fakeSupabase();
    connect(client);
    streamEdits.mockImplementation(
      async (_t, _r, onEdit, _o, _c, _s, _e, report: object) => {
        fills(report);
        onEdit(EDIT);
      },
    );
    const response = await call({ text: "Hello world", stream: true });
    await lines(response);
    await Promise.all(scheduled.splice(0));
    expect(attempts()).toEqual([
      expect.objectContaining({
        state: "succeeded",
        input_tokens: 1200,
        output_tokens: 340,
        edits: 1,
        dropped: 0,
      }),
    ]);
  });

  it.each([
    ["a failure", new RewriteError("busy", 503), "failed"],
    ["a refusal", new RewriteError("refused", 422), "failed"],
  ])("reports %s as %s", async (_case, error, state) => {
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockRejectedValue(error);
    await call({ text: "hello" });
    expect(attempts()).toEqual([expect.objectContaining({ state, edits: 0 })]);
  });

  it("reports a refused reservation and a refused start by their code, with no model", async () => {
    const refused = fakeSupabase({
      reserve: { data: null, error: { code: "53401" } },
    });
    connect(refused.client);
    await call({ text: "hello" });
    expect(attempts().at(-1)).toEqual({ state: "quota_exceeded" });

    const full = fakeSupabase({
      start: { data: null, error: { code: "53402" } },
    });
    connect(full.client);
    await call({ text: "hello" });
    expect(attempts().at(-1)).toEqual({ state: "global_quota_exceeded" });
  });

  it("reports an attempt given back", async () => {
    const { client, rpc } = fakeSupabase();
    connect(client);
    const controller = new AbortController();
    rpc.mockImplementation(async (name: string) => {
      if (name === "reserve_quota") controller.abort();
      return { data: name === "reserve_quota" ? "res-1" : true, error: null };
    });
    await post({ text: "hello", stream: true }, controller.signal);
    await Promise.all(scheduled.splice(0));
    expect(attempts()).toEqual([{ state: "released" }]);
  });

  it("does not copy a stop reason it does not know", async () => {
    const { client } = fakeSupabase();
    connect(client);
    requestEdits.mockImplementation(
      async (_t, _r, _c, _o, _e, report: { stopReason?: string }) => {
        report.stopReason = `${CANARY} a free text`;
        return [];
      },
    );
    await call({ text: "hello" });
    expect(attempts()[0].stop_reason).toBe("other");
    expect(logged.join("\n")).not.toContain(CANARY);
  });

  it("keeps the text, the voice, the excerpts and the answer out of every log line", async () => {
    for (const stream of [false, true]) {
      // The database quotes the row it refused
      const { client } = fakeSupabase({
        insertError: {
          code: "42501",
          message: `new row refused: ${CANARY} text and more`,
          details: `Failing row contains (${CANARY} text and more).`,
        },
      });
      connect(client);
      findReferences.mockResolvedValue([
        {
          id: `${CANARY}-id`,
          author: `${CANARY}-author`,
          title: `${CANARY}-title`,
          kind: "essay",
          year: null,
          body: `${CANARY}-excerpt`,
          similarity: 0.5,
        },
      ]);
      const edit = {
        original: `${CANARY} text`,
        replacement: `${CANARY} replaced`,
        reason: `${CANARY} reason`,
      };
      const answer = async (...args: unknown[]) => {
        fills(args.at(-1) as object);
        if (stream) (args[2] as (e: typeof edit) => void)(edit);
        return [edit];
      };
      requestEdits.mockImplementation(answer);
      streamEdits.mockImplementation(answer);
      const response = await call({
        text: `${CANARY} text and more`,
        voice: `${CANARY} voice`,
        stream,
      });
      await response.text();
      await Promise.all(scheduled.splice(0));
    }
    expect(attempts()).toHaveLength(2);
    expect(logged.join("\n")).not.toContain(CANARY);
    expect(vi.mocked(console.error).mock.calls).toEqual([
      ["History save failed", "42501"],
      ["History save failed", "42501"],
    ]);
  });
});
