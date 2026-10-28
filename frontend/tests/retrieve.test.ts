import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findReferences } from "@/lib/style/retrieve";

const FRENCH =
  "Il regardait la pluie tomber sur la ville et il pensait à sa mère dans la maison.";
const ENGLISH =
  "She walked along the road and thought about the letter that she had received.";

const row = (author: string, over = {}) => ({
  id: `${author}-1`,
  author,
  title: "T",
  kind: "fiction",
  body: "b",
  similarity: 0.5,
  ...over,
});

const embedder = { dim: 2, embed: vi.fn(() => [0.6, 0.8]) };

function fakeSupabase(result: {
  data?: unknown;
  error?: { code: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, ...result });
  return { client: { rpc }, rpc };
}

beforeEach(() => {
  embedder.embed.mockReset().mockReturnValue([0.6, 0.8]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("findReferences", () => {
  it("searches in the language of the text, not of the interface", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(client, FRENCH, "en", () => embedder);
    expect(rpc.mock.calls[0][1]).toMatchObject({ match_lang: "fr" });
  });

  it("falls back to the interface language when the text is ambiguous", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(client, "Short.", "fr", () => embedder);
    expect(rpc.mock.calls[0][1]).toMatchObject({ match_lang: "fr" });
  });

  it("sends the vector in pgvector text format", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(client, ENGLISH, "en", () => embedder);
    expect(rpc).toHaveBeenCalledWith(
      "match_style_passages",
      expect.objectContaining({
        query_embedding: "[0.600000,0.800000]",
      }),
    );
  });

  it("keeps at most one excerpt per author and three in total", async () => {
    const rows = [
      row("Austen"),
      row("Austen", { id: "a2" }),
      row("Eliot"),
      row("Hardy"),
      row("Woolf"),
    ];
    const { client } = fakeSupabase({ data: rows });
    const refs = await findReferences(client, ENGLISH, "en", () => embedder);
    expect(refs.map((r) => r.author)).toEqual(["Austen", "Eliot", "Hardy"]);
  });

  it("returns nothing when the text cannot be embedded", async () => {
    embedder.embed.mockReturnValue(null as never);
    const { client, rpc } = fakeSupabase({ data: [] });
    expect(await findReferences(client, ENGLISH, "en", () => embedder)).toEqual(
      [],
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws: a database error gives no references", async () => {
    const { client } = fakeSupabase({ error: { code: "42501" } });
    expect(await findReferences(client, ENGLISH, "en", () => embedder)).toEqual(
      [],
    );
  });

  it("never throws: a broken embedder gives no references", async () => {
    const broken = () => {
      throw new Error("missing file");
    };
    const { client } = fakeSupabase({ data: [] });
    expect(await findReferences(client, ENGLISH, "en", broken)).toEqual([]);
  });

  it("can be switched off", async () => {
    vi.stubEnv("STYLE_REFERENCES", "off");
    const { client, rpc } = fakeSupabase({ data: [row("Austen")] });
    expect(await findReferences(client, ENGLISH, "en", () => embedder)).toEqual(
      [],
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
