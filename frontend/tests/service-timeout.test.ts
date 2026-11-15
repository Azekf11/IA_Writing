// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishRewrite,
  releaseQuota,
  reserveQuota,
  startRewrite,
} from "@/lib/rewrite/quota";
import { createServiceClient, DATABASE_MS } from "@/lib/supabase/service";

// The real client and its real query builder, over a connection that never answers: whether the
// installed supabase-js honours the limit is what these tests are about.
const neverAnswers = vi.fn(
  (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    }),
);

function server() {
  const client = createServiceClient();
  if (!client) throw new Error("the client should be configured");
  return client;
}

// What `pending` has come to `ms` from now
async function resultAfter<T>(pending: PromiseLike<T>, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  return Promise.race([pending, Promise.resolve("still waiting" as const)]);
}

const asked = () => String(neverAnswers.mock.calls[0][0]);

const REFUSED = { ok: false, code: "server_error", status: 500 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", neverAnswers);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  neverAnswers.mockClear();
});

describe("a database that stops answering", () => {
  it("is given until the limit", async () => {
    const pending = reserveQuota(server(), "account");
    expect(await resultAfter(pending, DATABASE_MS - 1)).toBe("still waiting");
  });

  it("ends the reservation at the limit, as a refusal", async () => {
    const pending = reserveQuota(server(), "account");
    expect(await resultAfter(pending, DATABASE_MS)).toEqual(REFUSED);
    expect(asked()).toContain("/rest/v1/rpc/reserve_quota");
    expect(console.error).toHaveBeenCalledWith(
      "reserve_quota failed",
      "unknown",
    );
  });

  it("ends the start at the limit, so the model is not called", async () => {
    const pending = startRewrite(server(), "account", "ticket");
    expect(await resultAfter(pending, DATABASE_MS)).toEqual(REFUSED);
    expect(asked()).toContain("/rest/v1/rpc/start_rewrite");
  });

  it.each([
    [
      "finish_rewrite",
      () => finishRewrite(server(), "account", "ticket", "failed"),
    ],
    ["release_quota", () => releaseQuota(server(), "account", "ticket")],
  ])("lets %s go at the limit, and expiry closes it", async (name, close) => {
    expect(await resultAfter(close(), DATABASE_MS)).toBeUndefined();
    expect(asked()).toContain(`/rest/v1/rpc/${name}`);
    expect(console.error).toHaveBeenCalledWith(`${name} failed`, "unknown");
  });

  it("ends the history's insert at the limit, as an error", async () => {
    const pending = server()
      .from("rewrites")
      .insert({})
      .then((result) => result);
    const result = await resultAfter(pending, DATABASE_MS);
    expect(result).toMatchObject({ data: null, error: expect.anything() });
    expect(asked()).toContain("/rest/v1/rewrites");
  });
});

describe("a call with a shorter limit of its own, as the style search has", () => {
  it("ends at that limit, not at the client's", async () => {
    const shorter = new AbortController();
    const pending = server()
      .rpc("search_style_passages", {})
      .abortSignal(shorter.signal)
      .then((result) => result);
    expect(await resultAfter(pending, 1_000)).toBe("still waiting");
    shorter.abort();
    expect(await resultAfter(pending, 0)).toMatchObject({
      data: null,
      error: expect.anything(),
    });
  });
});

describe("a database that answers", () => {
  it("is not cut off", async () => {
    neverAnswers.mockResolvedValueOnce(
      new Response(JSON.stringify("ticket-1"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const pending = reserveQuota(server(), "account");
    expect(await resultAfter(pending, 0)).toEqual({
      ok: true,
      ticket: "ticket-1",
    });
  });
});
