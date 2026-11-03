// What the Anthropic API sends for a streamed answer, for tests that run the real SDK
export const event = (type: string, data: Record<string, unknown> = {}) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

// The events before the first piece of text
export const opening = () =>
  event("message_start", {
    message: {
      id: "m",
      type: "message",
      role: "assistant",
      model: "x",
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 },
    },
  }) +
  event("content_block_start", {
    index: 0,
    content_block: { type: "text", text: "" },
  });

export const piece = (text: string) =>
  event("content_block_delta", {
    index: 0,
    delta: { type: "text_delta", text },
  });

// The events after the last piece of text
export const closing = (stopReason: string) =>
  event("content_block_stop", { index: 0 }) +
  event("message_delta", {
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 1 },
  }) +
  event("message_stop");

// A whole answer made of `pieces`, ending with `stopReason`
export const sse = (pieces: string[], stopReason: string) =>
  opening() + pieces.map(piece).join("") + closing(stopReason);
