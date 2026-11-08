import { RewriteError, streamEdits } from "./claude";
import { EditCollector } from "./collect";
import type { AttemptReport } from "./diagnostics";
import type { MessageOptions } from "./prompt";
import { encodeEvent, STREAM_TYPE, type StreamEvent } from "./protocol";
import type { Outcome } from "./quota";
import type { Edit, ReferenceCredit } from "./types";
import type { Reference } from "@/lib/style/retrieve";

type Job = {
  text: string;
  references: Reference[];
  options: MessageOptions;
  // Fires when the client goes away
  signal: AbortSignal;
  // How long the request took before the model: session, quota and style search
  prepMs: number;
  // Filled in as the attempt goes, for the logs
  report?: AttemptReport;
  // Runs once, after the last byte is sent: how the attempt ended, and the edits to keep in the
  // history (null when there is nothing to keep)
  onSettled: (outcome: Outcome, history: Edit[] | null) => Promise<void>;
};

// A streamed answer: each edit is sent as soon as the model finishes writing it.
// `settled` resolves once the bookkeeping after the last byte is done; the route hands it to
// after() so the platform keeps the function alive until then.
//
// The attempt was started before this runs, so every ending counts:
//   complete answer                 -> done,          succeeded, history saved
//   stopped short after some edits  -> done (partial), failed,   the delivered edits saved
//   a refusal, or nothing usable    -> error,         failed,    nothing saved
//   the reader left                 -> -,             cancelled, the delivered edits saved, if any
export function streamResponse(job: Job): {
  response: Response;
  settled: Promise<void>;
} {
  const encoder = new TextEncoder();
  const collector = new EditCollector(job.text);
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => (settle = resolve));
  // False once the reader is gone or the stream is closed: nothing more is written
  let open = true;
  // The reader leaving aborts the model call, so nobody pays for more of an answer nobody reads.
  // The platform reports it through the request's signal, through the stream being cancelled, or
  // through both, depending on where it runs.
  const reader = new AbortController();
  const leave = () => {
    open = false;
    reader.abort();
  };
  if (job.signal.aborted) leave();
  else job.signal.addEventListener("abort", leave, { once: true });

  const body = new ReadableStream<Uint8Array>({
    cancel: leave,
    async start(controller) {
      // Writing to a stream the reader already dropped throws: that must never skip the
      // bookkeeping below, so a failed write just stops further writes
      const send = (event: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          open = false;
        }
      };
      let closed = false;
      const close = () => {
        open = false;
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // The reader cancelled the stream first
        }
      };

      const credits: ReferenceCredit[] = job.references.map(
        ({ author, title }) => ({ author, title }),
      );
      send({ type: "start", references: credits });

      const modelStarted = performance.now();
      const droppedSoFar = () =>
        Object.values(collector.dropped).reduce((sum, n) => sum + n, 0);
      // Ends the stream normally: the reader keeps every edit sent so far
      const done = (partial?: true) => {
        const dropped = droppedSoFar();
        send({
          type: "done",
          dropped,
          ms: {
            prep: Math.round(job.prepMs),
            model: Math.round(performance.now() - modelStarted),
          },
          partial,
        });
        close();
        if (dropped > 0) console.info("Edits dropped", collector.dropped);
      };
      // What the reader has already received, or null when that is nothing
      const delivered = () => {
        const edits = collector.result();
        return edits.length > 0 ? edits : null;
      };

      // Anything unforeseen still closes the ticket, as a failed attempt
      let outcome: Outcome = "failed";
      let history: Edit[] | null = null;
      try {
        await streamEdits(
          job.text,
          job.references,
          (raw) => {
            // Only what the reader received counts as delivered
            if (!open) return;
            const edit = collector.add(raw);
            if (edit) send({ type: "edit", edit });
          },
          job.options,
          undefined,
          reader.signal,
          job.prepMs,
          job.report,
        );
        if (reader.signal.aborted) {
          close();
          outcome = "cancelled";
          history = delivered();
        } else if (
          // Every proposal failed a check: that is not "nothing to change"
          !delivered() &&
          Object.keys(collector.dropped).some((why) => why !== "unchanged")
        ) {
          console.info("Edits dropped", collector.dropped);
          throw new RewriteError("upstream_error", 502);
        } else {
          done();
          outcome = "succeeded";
          history = collector.result();
        }
      } catch (error) {
        const code =
          error instanceof RewriteError ? error.code : "server_error";
        if (reader.signal.aborted) {
          // The abort is what ended the call: nobody is left to tell
          close();
          outcome = "cancelled";
          history = delivered();
        } else if (code !== "refused" && delivered()) {
          // Edits were already delivered: keep them rather than lose them
          console.error("Answer cut short", code);
          done(true);
          history = delivered();
        } else {
          // A refusal is not kept, even after edits: the model declined the text
          if (!(error instanceof RewriteError)) {
            console.error(
              "Unhandled rewrite error",
              error instanceof Error ? error.name : typeof error,
            );
          }
          send({ type: "error", error: code });
          close();
        }
      } finally {
        if (job.report) job.report.dropped = droppedSoFar();
        try {
          await job.onSettled(outcome, history);
        } finally {
          settle();
        }
      }
    },
  });

  const response = new Response(body, {
    headers: {
      "Content-Type": STREAM_TYPE,
      "Cache-Control": "no-store, no-transform",
      // Tells proxies not to hold the answer back until it is complete
      "X-Accel-Buffering": "no",
      // The model time is only known at the end, and travels in the final event
      "Server-Timing": `prep;dur=${Math.round(job.prepMs)}`,
    },
  });
  return { response, settled };
}
