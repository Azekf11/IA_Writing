// A stand-in for the Anthropic Messages API, so the real route can run end to end for free.
// It answers like the real thing (a JSON message holding the structured output) and records
// what it received, so the audit can check what the route sent.
//
// Magic words in the user's text steer it:
//   SLOW       answers after 3 s (to hold a request in flight)
//   FAILAPI    answers 529 "overloaded"
//   REFUSE     declines: stop_reason "refusal"
//   TRUNCATE   runs out of tokens after the first edit: stop_reason "max_tokens"
//   TOOLONG    runs out of tokens before any edit is complete
//   CUTOFF     the connection dies after the first edit
//   MISSING    adds an edit whose quote is not in the text
//   ALLBAD     proposes only an edit whose quote is not in the text
//   REVERSE    writes its edits last to first
//   12%        adds an edit that changes the number
import http from "node:http";
import { fileURLToPath } from "node:url";

export function startMockAnthropic(port) {
  const received = [];
  // Mutable, so the audit can make the stand-in fast for volume tests
  const state = { delayMs: 400, gapMs: 350 };

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", async () => {
      const body = JSON.parse(raw);
      const content = body.messages?.[0]?.content ?? "";
      const text = /<text>\n([\s\S]*)\n<\/text>/.exec(content)?.[1] ?? "";
      received.push({
        content,
        text,
        hasReferences: content.includes("<style_references>"),
        referenceCount: (content.match(/<reference /g) ?? []).length,
        intensity: /<intensity>(\w+)<\/intensity>/.exec(content)?.[1] ?? null,
        voice:
          /<author_voice>\n([\s\S]*?)\n<\/author_voice>/.exec(content)?.[1] ??
          null,
        streamed: body.stream === true,
        system: String(body.system).length,
      });

      await new Promise((r) =>
        setTimeout(r, text.includes("SLOW") ? 3000 : state.delayMs),
      );

      if (text.includes("FAILAPI")) {
        res.writeHead(529, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "error",
            error: { type: "overloaded_error", message: "Overloaded" },
          }),
        );
        return;
      }

      const edits = editsFor(text);
      if (body.stream === true) {
        await sendStream(res, body.model, edits, state.gapMs, text);
        return;
      }

      const refused = text.includes("REFUSE");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: body.model,
          stop_reason: refused ? "refusal" : "end_turn",
          stop_sequence: null,
          content: refused
            ? []
            : [{ type: "text", text: JSON.stringify({ edits }) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });

  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        received,
        state,
        reset: () => (received.length = 0),
        close: () => new Promise((r) => server.close(r)),
      }),
    ),
  );
}

// `npm run stand-in`: on its own, for a local demo without an API key (see the root README)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = 4310;
  await startMockAnthropic(PORT);
  console.log(
    `Stand-in for the model on http://127.0.0.1:${PORT}. Not Claude.`,
  );
}

// Every other sentence is shortened to its last words: deterministic, and never touches numbers
function editsFor(text) {
  if (text.includes("ALLBAD")) {
    return [
      {
        original: "text that is not in the input",
        replacement: "x",
        reason: "Not there.",
      },
    ];
  }
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const edits = sentences
    .filter((_, index) => index % 2 === 0)
    .map((sentence) => {
      const words = sentence.split(" ");
      const tail = words.slice(-6).join(" ");
      return {
        original: sentence,
        replacement: tail.charAt(0).toUpperCase() + tail.slice(1),
        reason: "Shorter and plainer.",
      };
    })
    .filter((edit) => edit.original !== edit.replacement);

  if (text.includes("MISSING")) {
    edits.push({
      original: "text that is not in the input",
      replacement: "x",
      reason: "Not there.",
    });
  }
  if (text.includes("12%")) {
    edits.push({
      original: "12%",
      replacement: "15%",
      reason: "Rounder number.",
    });
  }
  return text.includes("REVERSE") ? edits.reverse() : edits;
}

// Speaks the real service's event stream: the answer arrives in small pieces, one edit at a time,
// with a pause between edits like a model that is still writing
async function sendStream(res, model, edits, gapMs, text) {
  const send = (event, data) =>
    res.write(
      `event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`,
    );
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  });
  send("message_start", {
    message: {
      id: "msg_mock",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  send("content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  });
  const piece = (text) =>
    send("content_block_delta", {
      index: 0,
      delta: { type: "text_delta", text },
    });

  const stop = (reason) => {
    send("content_block_stop", { index: 0 });
    send("message_delta", {
      delta: { stop_reason: reason, stop_sequence: null },
      usage: { output_tokens: 10 },
    });
    send("message_stop", {});
    res.end();
  };

  if (text.includes("REFUSE")) return stop("refusal");

  piece('{"edits":[');
  if (text.includes("TOOLONG")) {
    piece('{"original":"The answer stops her');
    return stop("max_tokens");
  }
  for (const [i, edit] of edits.entries()) {
    const json = JSON.stringify(edit);
    const middle = Math.floor(json.length / 2);
    piece((i ? "," : "") + json.slice(0, middle));
    await new Promise((r) => setTimeout(r, gapMs));
    piece(json.slice(middle));
    if (text.includes("TRUNCATE")) {
      piece(',{"original":"The answer stops her');
      return stop("max_tokens");
    }
    if (text.includes("CUTOFF")) {
      await new Promise((r) => setTimeout(r, 50));
      res.destroy();
      return;
    }
  }
  // The last edit is not the end of the answer: a model takes a moment to finish
  await new Promise((r) => setTimeout(r, gapMs));
  piece("]}");
  stop("end_turn");
}
