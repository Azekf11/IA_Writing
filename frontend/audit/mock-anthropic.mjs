// A stand-in for the Anthropic Messages API, so the real route can run end to end for free.
// It answers like the real thing (a JSON message holding the structured output) and records
// what it received, so the audit can check what the route sent.
//
// Magic words in the user's text steer it:
//   SLOW     answers after 3 s (to hold a request in flight)
//   FAILAPI  answers 529 "overloaded"
//   MISSING  adds an edit whose quote is not in the text
//   12%      adds an edit that changes the number
import http from "node:http";

export function startMockAnthropic(port) {
  const received = [];
  // Mutable, so the audit can make the stand-in fast for volume tests
  const state = { delayMs: 400 };

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

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_mock",
          type: "message",
          role: "assistant",
          model: body.model,
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [
            { type: "text", text: JSON.stringify({ edits: editsFor(text) }) },
          ],
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

// Every other sentence is shortened to its last words: deterministic, and never touches numbers
function editsFor(text) {
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
  return edits;
}
