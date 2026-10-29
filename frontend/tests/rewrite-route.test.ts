import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteError } from "@/lib/rewrite/claude";
import { DAILY_LIMIT, MAX_IN_FLIGHT } from "@/lib/rewrite/limits";
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

const call = async (body: unknown) => {
  const response = await POST(
    new Request("http://localhost/api/rewrite", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
  await Promise.all(scheduled.splice(0));
  return response;
};

// Fake Supabase client: signed-in user, quota result and insert result
function fakeSupabase({
  userId = "user-1" as string | null,
  reservation = "res-1" as string | null,
  quotaError = null as { code: string } | null,
  insertError = null as { code: string } | null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const rpc = vi.fn(async (name: string) =>
    name === "reserve_quota"
      ? { data: reservation, error: quotaError }
      : { data: name === "finish_rewrite" ? true : null, error: null },
  );
  const client = {
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : null,
      }),
    },
    rpc,
    from: vi.fn(() => ({ insert })),
  };
  return { client, insert, rpc };
}

const EDIT = { original: "world", replacement: "there", reason: "warmer" };

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  requestEdits.mockReset();
  streamEdits.mockReset();
  createClient.mockReset();
  findReferences.mockReset().mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/rewrite", () => {
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

  it("requires a signed-in user", async () => {
    const { client, rpc } = fakeSupabase({ userId: null });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(rpc).not.toHaveBeenCalled();
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("blocks the request when the daily quota is used up", async () => {
    const { client } = fakeSupabase({ reservation: null });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "quota_exceeded" });
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("passes the daily limit to the quota function", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello" });
    expect(rpc).toHaveBeenCalledWith("reserve_quota", {
      daily_limit: DAILY_LIMIT,
      max_in_flight: MAX_IN_FLIGHT,
    });
  });

  it("does not call Claude when the quota check errors", async () => {
    const { client } = fakeSupabase({
      reservation: null,
      quotaError: { code: "x" },
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(requestEdits).not.toHaveBeenCalled();
  });

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
        edit_count: 1,
        locale: "fr",
      }),
    );
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
    expect(requestEdits).toHaveBeenCalledWith("Hello world", refs, undefined, {
      strength: "standard",
      voice: undefined,
    });
    const body = await response.json();
    expect(body.references).toEqual([{ author: "Jane Austen", title: "Emma" }]);
    // The excerpt itself stays on the server
    expect(JSON.stringify(body)).not.toContain('"body"');
  });

  it("rewrites without references when none are found", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect((await response.json()).references).toEqual([]);
  });

  it("rejects an oversized body before parsing it", async () => {
    const response = await call("x".repeat(41_000));
    expect(response.status).toBe(413);
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("looks up the quota and the references at the same time", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    const order: string[] = [];
    rpc.mockImplementation(async (name: string) => {
      order.push(`start:${name}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(`end:${name}`);
      return { data: name === "reserve_quota" ? "res-1" : true, error: null };
    });
    findReferences.mockImplementation(async () => {
      order.push("start:references");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("end:references");
      return [];
    });
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello" });
    // Both lookups start before either one ends
    expect(order.indexOf("start:references")).toBeLessThan(
      order.indexOf("end:reserve_quota"),
    );
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
      POST(
        new Request("http://localhost/api/rewrite", {
          method: "POST",
          body: JSON.stringify({ text: "Hello world" }),
        }),
      ),
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

  it("passes the intensity and the voice to the model", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([]);
    await call({ text: "hello", strength: "light", voice: "Short lines." });
    expect(requestEdits).toHaveBeenCalledWith("hello", [], undefined, {
      strength: "light",
      voice: "Short lines.",
    });
  });

  it("refuses an unknown intensity and an oversized voice", async () => {
    expect((await call({ text: "hi", strength: "extreme" })).status).toBe(400);
    expect((await call({ text: "hi", voice: "v".repeat(1501) })).status).toBe(
      400,
    );
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("streams when asked: events, then the same bookkeeping", async () => {
    const { client, insert, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    streamEdits.mockImplementation(async (_t, _r, onEdit) => {
      onEdit({ original: "world", replacement: "there", reason: "warmer" });
    });
    const response = await call({ text: "Hello world", stream: true });
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    await Promise.all(scheduled.splice(0));
    expect(response.headers.get("content-type")).toContain("ndjson");
    expect(lines.map((l) => l.type)).toEqual(["start", "edit", "done"]);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ edit_count: 1 }),
    );
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
    });
  });

  it("streams a failure as an event and gives the request back", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    streamEdits.mockRejectedValue(new RewriteError("busy", 503));
    const response = await call({ text: "hello", stream: true });
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    await Promise.all(scheduled.splice(0));
    expect(lines.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(rpc).toHaveBeenCalledWith("release_quota", { reservation: "res-1" });
  });

  it("still refuses before streaming starts when the quota is spent", async () => {
    const { client } = fakeSupabase({ reservation: null });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello", stream: true });
    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("json");
    expect(streamEdits).not.toHaveBeenCalled();
  });

  it("tells the user when a rewrite is already running", async () => {
    const { client, rpc } = fakeSupabase({
      reservation: null,
      quotaError: { code: "53400" },
    });
    createClient.mockResolvedValue(client);
    const response = await call({ text: "hello" });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too_many_requests" });
    expect(requestEdits).not.toHaveBeenCalled();
    // Nothing was reserved, so there is nothing to give back
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("frees the in-flight slot after a success without refunding the request", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    await call({ text: "Hello world" });
    expect(rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "res-1",
    });
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("does not turn a success into a refund when finishing fails", async () => {
    const { client, rpc } = fakeSupabase();
    rpc.mockImplementation(async (name: string) =>
      name === "reserve_quota"
        ? { data: "res-1", error: null }
        : name === "finish_rewrite"
          ? { data: null, error: { code: "XX000" } }
          : { data: null, error: null },
    );
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalledWith("release_quota", expect.anything());
  });

  it("frees the slot with a refund when Claude fails", async () => {
    const { client, rpc } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new RewriteError("busy", 503));
    await call({ text: "hello" });
    expect(rpc).toHaveBeenCalledWith("release_quota", { reservation: "res-1" });
    expect(rpc).not.toHaveBeenCalledWith("finish_rewrite", expect.anything());
  });

  it("still returns the result when saving the history fails", async () => {
    const { client } = fakeSupabase({ insertError: { code: "42501" } });
    createClient.mockResolvedValue(client);
    requestEdits.mockResolvedValue([EDIT]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
  });

  it("refunds the quota when Claude fails", async () => {
    const { client, rpc, insert } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new RewriteError("busy", 503));

    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "busy" });
    expect(rpc).toHaveBeenCalledWith("release_quota", { reservation: "res-1" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("hides unexpected errors behind a generic code", async () => {
    const { client } = fakeSupabase();
    createClient.mockResolvedValue(client);
    requestEdits.mockRejectedValue(new Error("secret details"));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });
});
