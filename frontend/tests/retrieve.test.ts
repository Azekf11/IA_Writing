import { format } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findReferences, MIN_SIMILARITY } from "@/lib/style/retrieve";
import { referencesEnabled } from "@/lib/style/switch";

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
const ACCOUNT = "account-1";
const TICKET = "ticket-1";

// `result` is what the search answers
function fakeSupabase(result: {
  data?: unknown;
  error?: { code: string; message?: string } | null;
}) {
  const answer = { data: null, error: null, ...result };
  const rpc = vi.fn<
    (name: string, args?: unknown) => { abortSignal: () => Promise<unknown> }
  >(() => ({ abortSignal: () => Promise.resolve(answer) }));
  return { client: { rpc } as never, rpc };
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
  it("drops excerpts that match too weakly", async () => {
    const { client } = fakeSupabase({
      data: [
        row("Weak", { similarity: MIN_SIMILARITY - 0.01 }),
        row("Edge", { similarity: MIN_SIMILARITY }),
        row("Strong", { similarity: 0.6 }),
      ],
    });
    const found = await findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    expect(found.map((r) => r.author)).toEqual(["Edge", "Strong"]);
  });

  it("returns no reference at all when every match is too weak", async () => {
    const { client } = fakeSupabase({
      data: [row("A", { similarity: 0.05 }), row("B", { similarity: 0.1 })],
    });
    expect(
      await findReferences(
        client,
        ACCOUNT,
        TICKET,
        ENGLISH,
        "en",
        () => embedder,
      ),
    ).toEqual([]);
  });

  it("searches in the language of the text, not of the interface", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(client, ACCOUNT, TICKET, FRENCH, "en", () => embedder);
    expect(rpc.mock.calls[0][1]).toMatchObject({ match_lang: "fr" });
  });

  it("falls back to the interface language when the text is ambiguous", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(
      client,
      ACCOUNT,
      TICKET,
      "Short.",
      "fr",
      () => embedder,
    );
    expect(rpc.mock.calls[0][1]).toMatchObject({ match_lang: "fr" });
  });

  it("sends the vector in pgvector text format", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    expect(rpc).toHaveBeenCalledWith(
      "search_style_passages",
      expect.objectContaining({
        query_embedding: "[0.600000,0.800000]",
      }),
    );
  });

  it("searches once, for the account and the ticket it was given", async () => {
    const { client, rpc } = fakeSupabase({ data: [] });
    await findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith("search_style_passages", {
      account: ACCOUNT,
      reservation: TICKET,
      query_embedding: "[0.600000,0.800000]",
      match_lang: "en",
      match_count: 10,
    });
  });

  it("gives up when the search stalls, so the model keeps its time", async () => {
    const stop = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(stop.signal);
    // What the real client does with the signal: the call ends with an error
    const stalled = (signal: AbortSignal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () =>
          resolve({ data: null, error: { code: "" } }),
        ),
      );
    const client = { rpc: vi.fn(() => ({ abortSignal: stalled })) } as never;
    const found = findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    await new Promise((resolve) => setTimeout(resolve));
    stop.abort();
    expect(await found).toEqual([]);
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
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
    const refs = await findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    expect(refs.map((r) => r.author)).toEqual(["Austen", "Eliot", "Hardy"]);
  });

  it("returns nothing when the text cannot be embedded", async () => {
    embedder.embed.mockReturnValue(null as never);
    const { client, rpc } = fakeSupabase({ data: [] });
    expect(
      await findReferences(
        client,
        ACCOUNT,
        TICKET,
        ENGLISH,
        "en",
        () => embedder,
      ),
    ).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws: a database error gives no references", async () => {
    const { client } = fakeSupabase({ error: { code: "42501" } });
    expect(
      await findReferences(
        client,
        ACCOUNT,
        TICKET,
        ENGLISH,
        "en",
        () => embedder,
      ),
    ).toEqual([]);
  });

  it("never throws: a broken embedder gives no references", async () => {
    const broken = () => {
      throw new Error("missing file");
    };
    const { client } = fakeSupabase({ data: [] });
    expect(
      await findReferences(client, ACCOUNT, TICKET, ENGLISH, "en", broken),
    ).toEqual([]);
  });

  it("logs what failed, never the text it failed on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = () => ({
      dim: 2,
      embed: (text: string) => {
        throw new Error(`cannot embed: ${text}`);
      },
    });
    const { client } = fakeSupabase({ data: [] });
    await findReferences(client, ACCOUNT, TICKET, ENGLISH, "en", broken);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Style references unavailable",
      "Error",
    );
    expect(format(...error.mock.calls.flat())).not.toContain("letter");
  });

  it("logs a failed search by its code, not by what it says", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeSupabase({
      error: { code: "42501", message: `no ticket for ${ENGLISH}` },
    });
    await findReferences(
      client,
      ACCOUNT,
      TICKET,
      ENGLISH,
      "en",
      () => embedder,
    );
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "Style search failed",
      "42501",
    );
  });

  it("can be switched off", async () => {
    vi.stubEnv("STYLE_REFERENCES", "off");
    const { client, rpc } = fakeSupabase({ data: [row("Austen")] });
    expect(
      await findReferences(
        client,
        ACCOUNT,
        TICKET,
        ENGLISH,
        "en",
        () => embedder,
      ),
    ).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the switch for the excerpts", () => {
  it.each(["off", "OFF", " Off ", "false", "0", "no"])(
    "turns them off with %j",
    (value) => {
      vi.stubEnv("STYLE_REFERENCES", value);
      expect(referencesEnabled()).toBe(false);
    },
  );

  it.each(["", "on", "true"])("leaves them on with %j", (value) => {
    vi.stubEnv("STYLE_REFERENCES", value);
    expect(referencesEnabled()).toBe(true);
  });
});
