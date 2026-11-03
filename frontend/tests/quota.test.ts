import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  finishRewrite,
  releaseQuota,
  reserveQuota,
  startRewrite,
} from "@/lib/rewrite/quota";

type Answer = { data: unknown; error: { code: string } | null };

const answering = (answer: Answer) => ({
  rpc: vi.fn().mockResolvedValue(answer),
});
const down = () => ({
  rpc: vi.fn().mockRejectedValue(new TypeError("fetch failed: my secret text")),
});

let logged: ReturnType<typeof vi.spyOn>;

// Everything printed, as a log would show it: an Error comes out with its message
const printed = () => logged.mock.calls.flat().map(String).join(" ");

beforeEach(() => {
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
  logged.mockClear();
});

describe("reserveQuota", () => {
  it("returns the ticket", async () => {
    const supabase = answering({ data: "ticket-1", error: null });
    expect(await reserveQuota(supabase)).toEqual({
      ok: true,
      ticket: "ticket-1",
    });
    expect(supabase.rpc).toHaveBeenCalledWith("reserve_quota");
  });

  it.each([
    ["53400", "too_many_requests", 429],
    ["53401", "quota_exceeded", 429],
    ["53402", "global_quota_exceeded", 429],
    ["53403", "global_quota_exceeded", 429],
    ["28000", "unauthorized", 401],
    ["23503", "unauthorized", 401],
  ])(
    "turns %s into %s, without logging it as a failure",
    async (sql, code, status) => {
      const supabase = answering({ data: null, error: { code: sql } });
      expect(await reserveQuota(supabase)).toEqual({ ok: false, code, status });
      expect(logged).not.toHaveBeenCalled();
    },
  );

  it("fails closed on any other error, on no ticket, and when the call throws", async () => {
    for (const supabase of [
      answering({ data: null, error: { code: "PGRST000" } }),
      answering({ data: null, error: null }),
      answering({ data: "", error: null }),
      answering({ data: true, error: null }),
      down(),
    ]) {
      expect(await reserveQuota(supabase)).toEqual({
        ok: false,
        code: "server_error",
        status: 500,
      });
    }
    expect(logged.mock.calls).toEqual([
      ["reserve_quota failed", "PGRST000"],
      ["reserve_quota failed", "no ticket"],
      ["reserve_quota failed", "no ticket"],
      ["reserve_quota failed", "no ticket"],
      ["reserve_quota failed", "unknown"],
    ]);
    expect(printed()).not.toContain("secret");
  });
});

describe("startRewrite", () => {
  it("says go only when the database says true", async () => {
    const supabase = answering({ data: true, error: null });
    expect(await startRewrite(supabase, "ticket-1")).toEqual({ ok: true });
    expect(supabase.rpc).toHaveBeenCalledWith("start_rewrite", {
      reservation: "ticket-1",
    });
  });

  it("turns the app-wide ceilings into their code", async () => {
    for (const sql of ["53402", "53403"]) {
      expect(
        await startRewrite(
          answering({ data: null, error: { code: sql } }),
          "t",
        ),
      ).toEqual({ ok: false, code: "global_quota_exceeded", status: 429 });
    }
  });

  it("fails closed on false, on an error and when the call throws", async () => {
    for (const supabase of [
      answering({ data: false, error: null }),
      answering({ data: null, error: null }),
      answering({ data: null, error: { code: "XX000" } }),
      down(),
    ]) {
      expect(await startRewrite(supabase, "t")).toEqual({
        ok: false,
        code: "server_error",
        status: 500,
      });
    }
    expect(logged.mock.calls).toEqual([
      ["start_rewrite failed", "ticket not live"],
      ["start_rewrite failed", "ticket not live"],
      ["start_rewrite failed", "XX000"],
      ["start_rewrite failed", "unknown"],
    ]);
    expect(printed()).not.toContain("secret");
  });
});

describe("closing a ticket", () => {
  it("sends the outcome", async () => {
    const supabase = answering({ data: true, error: null });
    await finishRewrite(supabase, "t", "cancelled");
    expect(supabase.rpc).toHaveBeenCalledWith("finish_rewrite", {
      reservation: "t",
      outcome: "cancelled",
    });
  });

  it("never throws, whatever the database does, and logs codes only", async () => {
    for (const supabase of [
      answering({ data: null, error: { code: "XX000" } }),
      down(),
    ]) {
      await expect(
        finishRewrite(supabase, "t", "failed"),
      ).resolves.toBeUndefined();
      await expect(releaseQuota(supabase, "t")).resolves.toBeUndefined();
    }
    expect(logged.mock.calls).toEqual([
      ["finish_rewrite failed", "XX000"],
      ["release_quota failed", "XX000"],
      ["finish_rewrite failed", "unknown"],
      ["release_quota failed", "unknown"],
    ]);
    expect(printed()).not.toContain("secret");
  });
});
