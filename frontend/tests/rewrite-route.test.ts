import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteError } from "@/lib/rewrite/claude";
import { MAX_CHARS } from "@/lib/text";

const requestEdits = vi.fn();

vi.mock("@/lib/rewrite/claude", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rewrite/claude")>()),
  requestEdits: (...args: unknown[]) => requestEdits(...args),
}));

const { POST } = await import("@/app/api/rewrite/route");

const call = (body: unknown) =>
  POST(
    new Request("http://localhost/api/rewrite", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  requestEdits.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/rewrite", () => {
  it("rejects invalid JSON", async () => {
    const response = await call("not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it("rejects empty and oversized text", async () => {
    for (const text of ["", "   ", "a".repeat(MAX_CHARS + 1)]) {
      expect((await call({ text })).status).toBe(400);
    }
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("reports a missing API key without calling Claude", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(requestEdits).not.toHaveBeenCalled();
  });

  it("returns located edits", async () => {
    requestEdits.mockResolvedValue([
      { original: "world", replacement: "there", reason: "warmer" },
      { original: "missing", replacement: "x", reason: "not in text" },
    ]);
    const response = await call({ text: "Hello world" });
    expect(response.status).toBe(200);
    const { edits } = await response.json();
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({ id: "edit-0", start: 6, end: 11 });
  });

  it("forwards Claude failures with their status and code", async () => {
    requestEdits.mockRejectedValue(new RewriteError("busy", 503));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "busy" });
  });

  it("hides unexpected errors behind a generic code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    requestEdits.mockRejectedValue(new Error("secret details"));
    const response = await call({ text: "hello" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "server_error" });
  });
});
