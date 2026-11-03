// @vitest-environment node
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EventReader, type StreamEvent } from "@/lib/rewrite/protocol";
import { streamResponse } from "@/lib/rewrite/stream-response";
import { closing, event, opening, piece, sse } from "./anthropic-sse";

// The real stream handler and the real SDK against a local stand-in for the service, over a real
// socket: how the SDK ends a call, and which errors it raises, is what these tests are about.
// Nothing leaves the machine.
const TEXT =
  "It is crucial to act now. We will delve into the matter at hand today.";
const edit = (original: string, replacement: string) =>
  JSON.stringify({ original, replacement, reason: "r" });
const FIRST = edit("crucial", "important");
const SECOND = edit("delve into", "look at");
const HEAD = `{"edits":[${FIRST},`;
const WHOLE = `{"edits":[${FIRST},${SECOND}]}`;

let server: Server;
let answer: (response: ServerResponse) => void = () => {};
let requests = 0;
let requestBodies: Record<string, unknown>[] = [];
let leftEarly: Promise<void> = Promise.resolve();

beforeAll(async () => {
  server = createServer((request, response) => {
    requests++;
    // afterEach closes every connection, so none may be kept for the next test
    response.setHeader("connection", "close");
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      requestBodies.push(JSON.parse(raw));
      leftEarly = new Promise((resolve) =>
        response.on("close", () => {
          if (!response.writableEnded) resolve();
        }),
      );
      answer(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  vi.stubEnv("ANTHROPIC_BASE_URL", `http://127.0.0.1:${port}`);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  requests = 0;
  requestBodies = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  server.closeAllConnections();
});

const streaming = (response: ServerResponse) =>
  response.writeHead(200, { "content-type": "text/event-stream" });

function run(signal = new AbortController().signal, prepMs = 0) {
  const onSettled = vi.fn().mockResolvedValue(undefined);
  const { response, settled } = streamResponse({
    text: TEXT,
    references: [],
    options: {},
    signal,
    prepMs,
    onSettled,
  });
  return { response, settled, onSettled };
}

async function eventsOf(response: Response): Promise<StreamEvent[]> {
  const reader = new EventReader();
  const out: StreamEvent[] = [];
  const decoder = new TextDecoder();
  const body = response.body!.getReader();
  for (;;) {
    const { done, value } = await body.read();
    if (done) break;
    out.push(...reader.push(decoder.decode(value, { stream: true })));
  }
  return out;
}

const typesOf = (events: StreamEvent[]) => events.map((e) => e.type);

const originals = (edits: { original: string }[]) =>
  edits.map((e) => e.original);

// Makes the 50 s deadline pass after `ms`, and checks how long was asked for
function shortenDeadline(ms: number, asks = 50_000) {
  const real = AbortSignal.timeout.bind(AbortSignal);
  return vi.spyOn(AbortSignal, "timeout").mockImplementation((asked) => {
    expect(asked).toBe(asks);
    return real(ms);
  });
}

describe("a streamed answer, through the real SDK", () => {
  it("delivers a complete answer as a success", async () => {
    answer = (response) => {
      streaming(response);
      response.end(sse([WHOLE], "end_turn"));
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(typesOf(sent)).toEqual(["start", "edit", "edit", "done"]);
    expect(sent.at(-1)).not.toHaveProperty("partial");
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("succeeded");
    expect(originals(history)).toEqual(["crucial", "delve into"]);
  });

  it("keeps the edit written before the tokens ran out, as an answer cut short", async () => {
    answer = (response) => {
      streaming(response);
      response.end(sse([HEAD], "max_tokens"));
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(typesOf(sent)).toEqual(["start", "edit", "done"]);
    expect(sent.at(-1)).toMatchObject({ partial: true });
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("failed");
    expect(originals(history)).toEqual(["crucial"]);
  });

  it("keeps nothing of a refusal, even after an edit", async () => {
    answer = (response) => {
      streaming(response);
      response.end(sse([HEAD], "refusal"));
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "refused" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });
});

describe("a call that does not end well, through the real SDK", () => {
  it("reports a connection lost before any edit as upstream_error", async () => {
    answer = (response) => {
      streaming(response);
      response.write(opening(), () => response.destroy());
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(typesOf(sent)).toEqual(["start", "error"]);
    expect(sent.at(-1)).toEqual({ type: "error", error: "upstream_error" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  it("keeps the edit delivered before a connection is lost", async () => {
    answer = (response) => {
      streaming(response);
      response.write(opening() + piece(HEAD), () => response.destroy());
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(typesOf(sent)).toEqual(["start", "edit", "done"]);
    expect(sent.at(-1)).toMatchObject({ partial: true });
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("failed");
    expect(originals(history)).toEqual(["crucial"]);
  });

  it("ends a stalled answer at the deadline, before any edit", async () => {
    shortenDeadline(150);
    answer = (response) => {
      streaming(response);
      response.write(opening());
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "upstream_error" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
    expect(console.error).toHaveBeenCalledWith(
      "Model call reached its deadline",
    );
    await leftEarly;
  });

  it("ends a stalled answer at the deadline, and keeps the edit delivered", async () => {
    shortenDeadline(150);
    answer = (response) => {
      streaming(response);
      response.write(opening() + piece(HEAD));
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(typesOf(sent)).toEqual(["start", "edit", "done"]);
    expect(sent.at(-1)).toMatchObject({ partial: true });
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("failed");
    expect(originals(history)).toEqual(["crucial"]);
    await leftEarly;
  });

  it("takes the time spent before the model off the deadline", async () => {
    shortenDeadline(150, 30_000);
    answer = (response) => {
      streaming(response);
      response.write(opening());
    };
    const { response, settled, onSettled } = run(undefined, 20_000);
    const sent = await eventsOf(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "upstream_error" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  it("reports an overload sent inside the stream as busy", async () => {
    answer = (response) => {
      streaming(response);
      response.end(
        opening() +
          event("error", {
            error: { type: "overloaded_error", message: "Overloaded" },
          }),
      );
    };
    const { response, settled, onSettled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(onSettled).toHaveBeenCalledWith("failed", null);
  });

  // The ceilings count attempts: one attempt must stay one paid call
  it("does not retry: one attempt is one call to the service", async () => {
    answer = (response) => {
      response.writeHead(529, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          type: "error",
          error: { type: "overloaded_error", message: "Overloaded" },
        }),
      );
    };
    const { response, settled } = run();
    const sent = await eventsOf(response);
    await settled;
    expect(sent.at(-1)).toEqual({ type: "error", error: "busy" });
    expect(requests).toBe(1);
  });
});

describe("the reader leaving, through the real SDK", () => {
  const holdAfterFirstEdit = (response: ServerResponse) => {
    streaming(response);
    response.write(opening() + piece(HEAD));
  };

  async function readUntilEdit(response: Response) {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let seen = "";
    while (!seen.includes('"type":"edit"')) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`the stream ended before any edit: ${seen}`);
      seen += decoder.decode(value);
    }
    return reader;
  }

  it("stops the model when only the stream is cancelled, and saves what was delivered", async () => {
    answer = holdAfterFirstEdit;
    const { response, settled, onSettled } = run();
    const reader = await readUntilEdit(response);
    await reader.cancel();
    await settled;
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(originals(history)).toEqual(["crucial"]);
    // The connection to the service closes without the answer having ended
    await leftEarly;
  });

  it("stops the model when the request's signal fires", async () => {
    answer = holdAfterFirstEdit;
    const controller = new AbortController();
    const { response, settled, onSettled } = run(controller.signal);
    await readUntilEdit(response);
    controller.abort();
    await settled;
    const [outcome, history] = onSettled.mock.calls[0];
    expect(outcome).toBe("cancelled");
    expect(originals(history)).toEqual(["crucial"]);
    await leftEarly;
  });

  it("never reaches the service when the reader left before the call", async () => {
    answer = (response) => response.end();
    const controller = new AbortController();
    controller.abort();
    const { response, settled, onSettled } = run(controller.signal);
    const sent = await eventsOf(response);
    await settled;
    expect(sent).toEqual([]);
    expect(requests).toBe(0);
    expect(onSettled).toHaveBeenCalledWith("cancelled", null);
  });
});

describe("the model asked for", () => {
  it("is the default one, unless ANTHROPIC_MODEL names another", async () => {
    answer = (response) => {
      streaming(response);
      response.end(opening() + piece(WHOLE) + closing("end_turn"));
    };
    vi.stubEnv("ANTHROPIC_MODEL", "");
    let flow = run();
    await eventsOf(flow.response);
    await flow.settled;
    expect(requestBodies[0].model).toBe("claude-sonnet-5-5");

    vi.stubEnv("ANTHROPIC_MODEL", "another-model");
    flow = run();
    await eventsOf(flow.response);
    await flow.settled;
    expect(requestBodies[1].model).toBe("another-model");
    vi.stubEnv("ANTHROPIC_MODEL", "");
  });
});
