import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteError } from "@/lib/rewrite/claude";
import { DAILY_LIMIT } from "@/lib/rewrite/limits";
import { MAX_CHARS } from "@/lib/text";

const requestEdits = vi.fn();
const createClient = vi.fn();

vi.mock("@/lib/rewrite/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rewrite/claude")>()),
  requestEdits: (...args: unknown[]) => requestEdits(...args),
}));
const findReferences = vi.fn();
vi.mock("@/lib/style/retrieve", () => ({
  findReferences: (...args: unknown[]) => findReferences(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { POST } = await import("@/app/api/rewrite/route");

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/rewrite", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

// Fake Supabase client: signed-in user, quota result and insert result
function fakeSupabase({
  userId = "user-1" as string | null,
  quota = 1 as number | null,
  quotaError = null as { code: string } | null,
  insertError = null as { code: string } | null,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const rpc = vi.fn(async (name: string) =>
    name === "consume_quota"
      ? { data: quota, error: quotaError }
      : { data: null, error: null },
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
    const { client } = fakeSupabase({ quota: -1 });
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
    expect(rpc).toHaveBeenCalledWith("consume_quota", {
      daily_limit: DAILY_LIMIT,
    });
  });

  it("does not call Claude when the quota check errors", async () => {
    const { client } = fakeSupabase({ quota: null, quotaError: { code: "x" } });
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
    expect(requestEdits).toHaveBeenCalledWith("Hello world", refs);
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
    expect(rpc).toHaveBeenCalledWith("refund_quota");
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
