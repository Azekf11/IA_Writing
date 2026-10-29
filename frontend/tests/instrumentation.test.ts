import { afterEach, describe, expect, it, vi } from "vitest";

const getEmbedder = vi.fn();
vi.mock("@/lib/style/embedder", () => ({ getEmbedder: () => getEmbedder() }));

const { register } = await import("@/instrumentation");

afterEach(() => {
  getEmbedder.mockReset();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("loads the embedder when the server starts", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await register();
    expect(getEmbedder).toHaveBeenCalledTimes(1);
  });

  it("does nothing on the edge runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await register();
    expect(getEmbedder).not.toHaveBeenCalled();
  });

  it("does not stop the server when the model cannot be loaded", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.spyOn(console, "error").mockImplementation(() => {});
    getEmbedder.mockImplementation(() => {
      throw new Error("bad checksum");
    });
    await expect(register()).resolves.toBeUndefined();
  });
});
