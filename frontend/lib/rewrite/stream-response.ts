import { RewriteError, streamEdits } from "./claude";
import { EditCollector } from "./collect";
import type { MessageOptions } from "./prompt";
import { encodeEvent, STREAM_TYPE, type StreamEvent } from "./protocol";
import type { Edit, ReferenceCredit } from "./types";
import type { Reference } from "@/lib/style/retrieve";

type Job = {
  text: string;
  references: Reference[];
  options: MessageOptions;
  // The client going away aborts the model call, so nobody pays for an answer nobody reads
  signal: AbortSignal;
  // How long the lookups before the model took
  prepMs: number;
  // Both run after the last byte is sent
  onSuccess: (edits: Edit[]) => Promise<void>;
  onFailure: () => Promise<void>;
};

// A streamed answer: each edit is sent as soon as the model finishes writing it.
// `settled` resolves once the bookkeeping after the last byte is done; the route hands it to
// after() so the platform keeps the function alive until then.
export function streamResponse(job: Job): {
  response: Response;
  settled: Promise<void>;
} {
  const encoder = new TextEncoder();
  const collector = new EditCollector(job.text);
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => (settle = resolve));

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: StreamEvent) => {
        if (open) controller.enqueue(encoder.encode(encodeEvent(event)));
      };
      const close = () => {
        if (open) controller.close();
        open = false;
      };
      job.signal.addEventListener("abort", () => (open = false), {
        once: true,
      });

      const credits: ReferenceCredit[] = job.references.map(
        ({ author, title }) => ({ author, title }),
      );
      send({ type: "start", references: credits });

      const modelStarted = performance.now();
      const finish = async () => {
        const dropped = Object.values(collector.dropped).reduce(
          (sum, n) => sum + n,
          0,
        );
        send({
          type: "done",
          dropped,
          ms: {
            prep: Math.round(job.prepMs),
            model: Math.round(performance.now() - modelStarted),
          },
        });
        close();
        if (dropped > 0) console.info("Edits dropped", collector.dropped);
        await job.onSuccess(collector.result());
      };

      try {
        await streamEdits(
          job.text,
          job.references,
          (raw) => {
            const edit = collector.add(raw);
            if (edit) send({ type: "edit", edit });
          },
          job.options,
          undefined,
          job.signal,
        );
        // Nobody is listening and nothing was delivered: the request goes back
        if (job.signal.aborted && collector.result().length === 0) {
          close();
          await job.onFailure();
        } else {
          await finish();
        }
      } catch (error) {
        const refused =
          error instanceof RewriteError && error.code === "refused";
        // Edits were already delivered, so the model did its job: keep them rather than lose them
        if (collector.result().length > 0 && !refused) {
          if (!job.signal.aborted) console.error("Answer cut short", error);
          await finish();
        } else {
          const code =
            error instanceof RewriteError ? error.code : "server_error";
          if (!(error instanceof RewriteError) && !job.signal.aborted) {
            console.error("Unhandled rewrite error", error);
          }
          send({ type: "error", error: code });
          close();
          // The user got nothing, so the request goes back
          await job.onFailure();
        }
      } finally {
        settle();
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
