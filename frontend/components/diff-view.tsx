"use client";

import { Check, PenLine, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { RewordField } from "@/components/reword-field";
import { useWordDiff } from "@/components/use-word-diff";
import { cn } from "@/lib/cn";
import { firstClick } from "@/lib/first-click";
import { toSegments, type Decision, type Overrides } from "@/lib/rewrite/apply";
import type { FactChange } from "@/lib/rewrite/guard";
import type { Edit } from "@/lib/rewrite/types";
import type { Run, wordDiff } from "@/lib/rewrite/word-diff";
import type { Lang } from "@/lib/style/language";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-2 max-sm:py-2.5";

type Rewording = {
  // The edits whose field is open
  open: string[];
  onStart: (id: string) => void;
  onSave: (
    edit: Edit,
    wording: string,
    fromKeyboard: boolean,
    concern?: FactChange | null,
  ) => void;
  onCancel: (id: string) => void;
};

type Props = {
  text: string;
  edits: Edit[];
  decisions: Record<string, Decision>;
  overrides: Overrides;
  onDecide: (id: string, decision: Decision) => void;
  rewording: Rewording;
  // The edit the keyboard shortcuts act on
  activeId?: string | null;
  // The text's language, where it is not the page's: the text and the words of each edit are in it
  textLang?: Lang;
  // The reasons', which are the text's when the model wrote them and the page's otherwise
  reasonLang?: Lang;
};

// One side of an edit: the words that change stand out and the others stay plain. Forced colours
// take the background away, so an underline is left to mark them.
function Marked({
  runs,
  leaveOut,
  className,
}: {
  runs: Run[];
  leaveOut: Run["kind"];
  className: string;
}) {
  return runs
    .filter((run) => run.kind !== leaveOut)
    .map((run, index) =>
      run.kind === "same" ? (
        run.text
      ) : (
        <span
          key={index}
          className={cn(
            "rounded-sm box-decoration-clone px-0.5 forced-colors:underline",
            className,
          )}
        >
          {run.text}
        </span>
      ),
    );
}

function EditCard({
  edit,
  decision,
  wording,
  overridden,
  active,
  diff,
  onDecide,
  rewording,
  textLang,
  reasonLang,
}: {
  edit: Edit;
  decision: Decision;
  // What the edit puts in the text: the writer's own wording, or else the suggestion
  wording: string;
  overridden: boolean;
  active: boolean;
  diff: typeof wordDiff | null;
  onDecide: Props["onDecide"];
  rewording: Rewording;
  textLang: Props["textLang"];
  reasonLang: Props["reasonLang"];
}) {
  const t = useTranslations("Review");
  const accepted = decision === "accepted";
  const rejected = decision === "rejected";
  const quote = `quote-${edit.id}`;
  const writingOwn = rewording.open.includes(edit.id);
  // Words are compared once per wording, since each decision draws every card again
  const runs = useMemo(
    () => (diff && wording.trim() ? diff(edit.original, wording) : null),
    [diff, edit.original, wording],
  );

  const rewordButton = (
    <button
      key="reword"
      type="button"
      aria-describedby={quote}
      // Takes the place of Cancel or Reject under the pointer
      onClick={firstClick(() => rewording.onStart(edit.id))}
      className={quiet}
    >
      <PenLine className="size-3.5" aria-hidden />
      {t("reword")}
    </button>
  );

  return (
    <span
      data-decision={decision}
      data-active={active || undefined}
      id={`review-${edit.id}`}
      // The shortcuts bring the focus here, so that a screen reader follows them
      tabIndex={-1}
      className={cn(
        "my-2 block scroll-mt-24 rounded-lg border bg-surface p-4 transition-colors",
        // Forced colours draw no ring, which is a shadow: an outline in their own highlight instead
        active &&
          "outline-none! ring-2 ring-accent-text forced-colors:[outline:2px_solid_Highlight]!",
        accepted && "border-add/50",
        rejected && "border-border",
        decision === "pending" && "border-border shadow-card",
      )}
    >
      {decision !== "pending" && (
        <span className="sr-only">
          {t(accepted ? "stateAccepted" : "stateRejected")}.{" "}
        </span>
      )}
      <span className="block text-sm">
        <span className="sr-only">{t("removed")} </span>
        <span
          id={quote}
          lang={textLang}
          className={cn(
            runs
              ? rejected && "text-foreground"
              : [
                  "rounded bg-remove-soft px-1 py-0.5 text-remove",
                  accepted && "line-through",
                  rejected && "bg-transparent text-foreground",
                ],
          )}
        >
          {runs ? (
            <Marked
              runs={runs}
              leaveOut="added"
              className={cn(
                "bg-remove-soft text-remove",
                // The underline would take the strike's place in forced colours
                accepted && "line-through forced-colors:line-through",
                rejected && "bg-transparent text-foreground",
              )}
            />
          ) : (
            edit.original
          )}
        </span>
      </span>
      {!writingOwn && (
        <span className="mt-2 block text-sm">
          <span className="sr-only">{t("added")} </span>
          <span
            lang={wording.trim() ? textLang : undefined}
            className={cn(
              runs
                ? rejected && "text-muted line-through"
                : [
                    "rounded bg-add-soft px-1 py-0.5 text-add",
                    rejected && "bg-transparent text-muted line-through",
                  ],
            )}
          >
            {runs ? (
              <Marked
                runs={runs}
                leaveOut="removed"
                className={cn(
                  "bg-add-soft text-add",
                  rejected && "bg-transparent text-muted",
                )}
              />
            ) : wording.trim() ? (
              wording
            ) : (
              t("emptyReplacement")
            )}
          </span>
        </span>
      )}
      <span lang={reasonLang} className="mt-2 block text-xs text-muted">
        {edit.reason}
      </span>
      {overridden && (
        <span className="mt-1 block text-xs text-muted">{t("reworded")}</span>
      )}
      {writingOwn ? (
        <RewordField
          id={`reword-${edit.id}`}
          original={edit.original}
          initial={wording}
          describedBy={quote}
          onSave={(written, fromKeyboard, concern) =>
            rewording.onSave(edit, written, fromKeyboard, concern)
          }
          onCancel={() => rewording.onCancel(edit.id)}
        />
      ) : (
        // Undo reuses the node of the button that was pressed, so the focus stays on it
        <span className="mt-3 flex flex-wrap gap-2">
          {decision === "pending" ? (
            <>
              <button
                key="accept"
                type="button"
                aria-describedby={quote}
                onClick={firstClick(() => onDecide(edit.id, "accepted"))}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground transition-all hover:bg-accent-hover active:scale-95 max-sm:py-2.5"
              >
                <Check className="size-3.5" aria-hidden />
                {t("accept")}
              </button>
              <button
                key="reject"
                type="button"
                aria-describedby={quote}
                // A review opened by the free check or the sample can land here under the pointer
                onClick={firstClick(() => onDecide(edit.id, "rejected"))}
                className={quiet}
              >
                <X className="size-3.5" aria-hidden />
                {t("reject")}
              </button>
              {rewordButton}
            </>
          ) : (
            <>
              <button
                key={accepted ? "accept" : "reject"}
                type="button"
                aria-describedby={quote}
                onClick={firstClick(() => onDecide(edit.id, "pending"))}
                className={quiet}
              >
                <RotateCcw className="size-3.5" aria-hidden />
                {t("undo")}
              </button>
              {rewordButton}
            </>
          )}
        </span>
      )}
    </span>
  );
}

// Original text with each suggested edit shown inline for review
export function DiffView({
  text,
  edits,
  decisions,
  overrides,
  onDecide,
  rewording,
  activeId = null,
  textLang,
  reasonLang,
}: Props) {
  const diff = useWordDiff();

  return (
    <div className="whitespace-pre-wrap leading-relaxed">
      {toSegments(text, edits).map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <span key={index} lang={textLang} className="text-muted">
              {segment.text}
            </span>
          );
        }

        const { edit } = segment;
        return (
          <EditCard
            key={edit.id}
            edit={edit}
            decision={decisions[edit.id] ?? "pending"}
            wording={overrides[edit.id] ?? edit.replacement}
            overridden={overrides[edit.id] !== undefined}
            active={edit.id === activeId}
            diff={diff}
            onDecide={onDecide}
            rewording={rewording}
            textLang={textLang}
            reasonLang={reasonLang}
          />
        );
      })}
    </div>
  );
}
