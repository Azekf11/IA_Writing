import type { Edit, ErrorCode, ReferenceCredit } from "./types";

// What the route sends while a rewrite is running: one JSON object per line.
export type StreamEvent =
  | { type: "start"; references: ReferenceCredit[] }
  | { type: "edit"; edit: Edit }
  | { type: "done"; dropped: number; ms: { prep: number; model: number } }
  | { type: "error"; error: ErrorCode };

export const STREAM_TYPE = "application/x-ndjson";

export const encodeEvent = (event: StreamEvent): string =>
  `${JSON.stringify(event)}\n`;

const TYPES = new Set(["start", "edit", "done", "error"]);

// Cuts a stream of text pieces into events. A piece can end in the middle of a line, so the
// unfinished end is kept until the next piece completes it.
export class EventReader {
  private rest = "";

  push(chunk: string): StreamEvent[] {
    this.rest += chunk;
    const lines = this.rest.split("\n");
    this.rest = lines.pop() ?? "";
    return lines.flatMap((line) => {
      if (!line.trim()) return [];
      try {
        const event = JSON.parse(line);
        // A line that is not an event is ignored, so a proxy's noise cannot break the page
        return TYPES.has(event?.type) ? [event as StreamEvent] : [];
      } catch {
        return [];
      }
    });
  }
}
