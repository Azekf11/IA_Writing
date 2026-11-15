"use client";

import { ArrowLeft, BookOpen, Square } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { DiffView } from "@/components/diff-view";
import { DEFAULT_OPTIONS, type Options } from "@/components/rewrite-options";
import { ResultPanel, type ResultPanelHandle } from "@/components/result-panel";
import { ReviewBar } from "@/components/review-bar";
import { TextEditor } from "@/components/text-editor";
import { useEnterOnce } from "@/components/use-enter-once";
import { useRewrite } from "@/components/use-rewrite";
import { loadWordDiff } from "@/components/use-word-diff";
import { useRouter } from "@/i18n/navigation";
import { firstClick } from "@/lib/first-click";
import { applyEdits, type Decision } from "@/lib/rewrite/apply";
import { changeList } from "@/lib/rewrite/change-list";
import {
  canUndo,
  decide,
  decideAll,
  firstChanged,
  NEW_LOG,
  pendingEdits,
  reword,
  undo,
  type ReviewLog,
} from "@/lib/rewrite/decisions";
import {
  clearKeptDraft,
  readDraft,
  readKeptDraft,
  saveDraft,
} from "@/lib/rewrite/draft";
import { clearReopen, readReopen, type Reopened } from "@/lib/rewrite/reopen";
import { sampleEdits, type SampleEdit } from "@/lib/rewrite/sample";
import {
  isTyping,
  markAfter,
  moveFocus,
  nextPending,
  reviewKey,
} from "@/lib/rewrite/keys";
import { guessLanguage } from "@/lib/style/language";
import { countWords } from "@/lib/text";
import type { FactChange } from "@/lib/rewrite/guard";
import type { Edit } from "@/lib/rewrite/types";
import type { Category } from "@/lib/check/scan";

const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold transition-all hover:bg-surface-2 active:scale-95";

const cardOf = (id: string) => document.getElementById(`review-${id}`);

const fullyInView = (card: HTMLElement) => {
  const { top, bottom } = card.getBoundingClientRect();
  const clear = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
  return top >= clear && bottom <= window.innerHeight;
};

const noChange = () => () => {};

// Coming from the history page: that rewrite is shown again, edits included. It is read as the
// workspace is first created, except on a full load: the page from the server has the editor, and a
// first render that read the browser's storage would not match it. There it is read once React has
// taken the page over, and the workspace starts again with it. It is removed only once React has
// kept a render that read it, since React can throw a render away and start again.
export function RewriteWorkspace() {
  // True while React takes over the page from the server, false in any later render
  const hydrating = useSyncExternalStore(
    noChange,
    () => false,
    () => true,
  );
  const [read, setRead] = useState<{ found: Reopened | null } | null>(() =>
    hydrating ? null : { found: readReopen() },
  );
  if (!hydrating && !read) setRead({ found: readReopen() });
  useEffect(() => {
    if (read) clearReopen();
  }, [read]);
  return (
    <Workspace
      key={read?.found ? "reopened" : "none"}
      reopened={read?.found ?? null}
    />
  );
}

function Workspace({ reopened }: { reopened: Reopened | null }) {
  const t = useTranslations("Review");
  const tErrors = useTranslations("Errors");
  const tEditor = useTranslations("Editor");
  const locale = useLocale();
  // The example, from the words of the page's language
  const sample = () => {
    const text = tEditor.raw("exampleText") as string;
    const written = tEditor.raw("exampleEdits") as SampleEdit[];
    return { text, edits: sampleEdits(text, written) };
  };
  const router = useRouter();
  const [draftBefore] = useState(readDraft);
  // The review the reader left for another page or language, unless a reopened rewrite takes its place.
  // A sample is the site's own text, so it comes back in the language of the page.
  const kept = reopened ? undefined : draftBefore?.review;
  const earlier = kept?.source === "sample" ? { ...kept, ...sample() } : kept;
  const rewrite = useRewrite(reopened ? { edits: reopened.edits } : earlier);
  const { view, credits } = rewrite;
  // What the check found is named by category: the words are the page's, whatever the language of the text
  const edits =
    rewrite.source === "check"
      ? rewrite.edits.map((edit) => ({
          ...edit,
          reason: t(`checkReason.${edit.reason as Category}`),
        }))
      : rewrite.edits;

  const [text, setText] = useState(
    () =>
      reopened?.text ??
      // A sample's text was never in the box
      (earlier?.open && earlier.source !== "sample"
        ? earlier.text
        : draftBefore?.text) ??
      "",
  );
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [options, setOptions] = useState<Options>(
    () => draftBefore?.options ?? DEFAULT_OPTIONS,
  );
  // The exact string the edits' offsets refer to
  const [reviewedText, setReviewedText] = useState(
    () => reopened?.text ?? earlier?.text ?? "",
  );
  const [log, setLog] = useState<ReviewLog>(() => earlier?.log ?? NEW_LOG);
  const { decisions, overrides } = log.now;
  const [activeId, setActiveId] = useState(() => earlier?.activeId ?? null);
  // The edits whose field for the writer's own wording is open
  const [rewording, setRewording] = useState<string[]>([]);
  // What the last decision did, in words, for as long as the answer stays as it was then
  const [change, setChange] = useState<{ words: string; phase: string } | null>(
    null,
  );
  // The status line, emptied for a frame: the same words said again are then a change too
  const [hushed, setHushed] = useState(false);
  const reviewRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stopOrBack = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<ResultPanelHandle>(null);
  // The card "Next to decide" last brought to the reader: from there it moves on, whatever the screen
  // shows. Ids start over with every review, so a new one forgets it.
  const [brought, setBrought] = useState<string | null>(null);

  // A reopened text is not what the reader typed: a draft of their own waits behind it. A finished
  // review goes along, on screen or behind the editor; an answer still being written does not,
  // since leaving the page cancels it.
  const notTyped =
    reopened?.text ?? (earlier?.reopened ? earlier.text : undefined);
  // After an earlier Reopen with nothing typed, the draft holds that rewrite's text, which the reader
  // did not type either
  const typedBefore =
    draftBefore?.review?.reopened &&
    draftBefore.text === draftBefore.review.text
      ? undefined
      : draftBefore?.text;
  const finished =
    !rewrite.loading &&
    view !== "writing" &&
    (view === "reviewing" || edits.length > 0);
  useEffect(() => {
    saveDraft({
      text: text === notTyped && typedBefore?.trim() ? typedBefore : text,
      options,
      review: finished
        ? {
            text: reviewedText,
            edits: rewrite.edits,
            credits,
            stopped: rewrite.stopped,
            cutShort: rewrite.cutShort,
            log,
            activeId,
            open: view === "reviewing",
            reopened: reviewedText === notTyped,
            source: rewrite.source ?? undefined,
            more: rewrite.more,
          }
        : undefined,
    });
  });

  // The text kept when a sign-in link was asked for. The editor asks from an effect, so nothing of it
  // is read in a first render: the server's page has an empty box, and a filled one would be a
  // hydration error. A box that holds something leaves the copy for the tab the link opens, and so
  // does a reopened rewrite still waiting to replace this editor on a full load.
  const restoreKept = (held: string) => {
    const kept = readKeptDraft();
    if (!kept || held.trim() || readReopen()) return;
    setText(kept.text);
    setOptions((current) => ({
      ...current,
      strength: kept.strength,
      keep: kept.keep ?? current.keep,
    }));
    clearKeptDraft();
  };

  // A held Enter counts once: a bulk decision would reach the edits the first one left alone, Undo
  // would walk back every step, and a press that leads to the box would type into it
  useEnterOnce();

  // The session ended elsewhere: the account panel has to follow. The text stays.
  const signedOut = rewrite.errorCode === "unauthorized";
  useEffect(() => {
    if (signedOut) router.refresh();
  }, [signedOut, router]);

  // The review opens below the page header: bring it into view, unless motion is reduced, and move
  // the focus into it, since what held the focus is gone and the shortcuts live there. Only when it
  // first opens, not on every edit that arrives. Brought back by the browser's Back or Forward, it
  // opens before the browser puts the page where the reader left it: the scroll waits for the next
  // frame, which comes after that and before anything is drawn.
  const inReview = view !== "editing";
  useEffect(() => {
    if (!inReview) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const frame = requestAnimationFrame(() =>
      reviewRef.current?.scrollIntoView?.({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      }),
    );
    headingRef.current?.focus({ preventScroll: true });
    return () => cancelAnimationFrame(frame);
  }, [inReview]);
  const [reviewed, setReviewed] = useState(inReview);
  if (inReview && !reviewed) setReviewed(true);

  // A click on nothing drops the focus to the page, and the letters with it while their legend stays
  // on screen: it goes back to the review. A click on a control leaves the focus where it went.
  useEffect(() => {
    if (!inReview) return;
    const onPointerUp = (event: PointerEvent) => {
      const control = (event.target as Element | null)?.closest?.(
        "a, button, input, select, textarea, label, summary",
      );
      if (document.activeElement === document.body && !control)
        reviewRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [inReview]);

  const reviewing = view === "reviewing";
  const undecided = pendingEdits(edits, decisions);
  // What the shortcuts act on: never a decided edit, unless the reader moved there
  const active = activeId ?? undecided[0]?.id ?? null;
  const phase = `${view}/${edits.length}`;
  const left = (next: ReviewLog) =>
    pendingEdits(edits, next.now.decisions).length;

  function record(next: ReviewLog, words: string) {
    if (next === log) return;
    setLog(next);
    setChange({ words, phase });
  }

  // Returns the edit marked next, which the shortcuts bring into view. A click does not move the page.
  function decideEdit(id: string, decision: Decision) {
    const next = decide(log, id, decision);
    record(
      next,
      t(`status.${decision === "pending" ? "undone" : decision}`, {
        left: left(next),
      }),
    );
    if (!reviewing) return null;
    const to =
      decision === "pending" ? id : markAfter(edits, next.now.decisions, id);
    setActiveId(to);
    return to;
  }

  function decideEvery(decision: "accepted" | "rejected") {
    const count = undecided.length || edits.length;
    record(
      decideAll(log, edits, decision),
      t(decision === "accepted" ? "status.allAccepted" : "status.allRejected", {
        count,
      }),
    );
    setActiveId(null);
  }

  function undoLast() {
    const next = undo(log);
    record(next, t("status.undone", { left: left(next) }));
    const to = firstChanged(edits, log.now, next.now);
    if (reviewing && to) setActiveId(to);
    return to;
  }

  const showCard = (id: string) => {
    const card = cardOf(id);
    card?.scrollIntoView?.({ block: "nearest" });
    card?.focus({ preventScroll: true });
  };

  // A decision made with the mouse marks the next edit without moving the page. So a card marked
  // but out of sight comes first; one the reader can see, they have chosen to pass over.
  function goToNext() {
    if (!active || undecided.length === 0) return;
    const card = cardOf(active);
    const comesFirst =
      undecided.some((edit) => edit.id === active) &&
      active !== brought &&
      card !== null &&
      !fullyInView(card);
    const to = comesFirst ? active : nextPending(edits, decisions, active);
    setBrought(to);
    setActiveId(to);
    showCard(to);
  }

  function openField(id: string) {
    setRewording((open) => (open.includes(id) ? open : [...open, id]));
    // Already open, it takes the focus back. A new field takes it as it appears.
    document.getElementById(`reword-${id}`)?.focus();
  }

  function closeField(id: string) {
    setRewording((open) => open.filter((other) => other !== id));
  }

  function cancelField(id: string) {
    closeField(id);
    cardOf(id)?.focus({ preventScroll: true });
  }

  // Changes the review and nothing else: the edit keeps its words, and nothing is sent
  function saveWording(
    edit: Edit,
    wording: string,
    fromKeyboard: boolean,
    concern?: FactChange | null,
  ) {
    const next = reword(log, edit, wording);
    const said = t(
      next.now.overrides[edit.id] === undefined
        ? "status.accepted"
        : "status.reworded",
      { left: left(next) },
    );
    // Accepted from the field, the warning was never read out with the button that carries it
    record(next, concern ? `${said} ${t(`rewordWarning.${concern}`)}` : said);
    closeField(edit.id);
    const to = reviewing ? markAfter(edits, next.now.decisions, edit.id) : null;
    if (reviewing) setActiveId(to);
    if (fromKeyboard) showCard(to ?? edit.id);
    else cardOf(edit.id)?.focus({ preventScroll: true });
  }

  // A, R, E, U, J and K work once the answer is complete, inside the review only, and never while
  // typing in a field. Single letters must not be live on the whole page (WCAG 2.1.4).
  function onReviewKey(event: KeyboardEvent) {
    const key = reviewKey(event);
    if (!key || isTyping(event.target)) return;
    event.preventDefault();
    // A card reached with Tab can be far from the marked one: the letters act where the focus is,
    // while that card waits for a decision. Once decided, its button keeps the focus, and they go
    // on to the marked edit.
    const card = (event.target as Element).closest("[data-decision]");
    const on =
      undecided.find((edit) => card?.id === `review-${edit.id}`)?.id ?? active;

    if (key === "undo") {
      const to = undoLast();
      if (to) showCard(to);
    } else if (key === "next" || key === "previous") {
      const to = moveFocus(edits, on, key);
      setActiveId(to);
      if (to) showCard(to);
    } else if (key === "reword") {
      if (on) openField(on);
    } else if (on) {
      const decision = key === "accept" ? "accepted" : "rejected";
      showCard(decideEdit(on, decision) ?? on);
    }
  }

  function forgetDecisions() {
    setBrought(null);
    setLog(NEW_LOG);
    setActiveId(null);
    setRewording([]);
    setChange(null);
  }

  function submit() {
    // A rewrite that brings nothing in place of the review behind the editor gives it back, with
    // its decisions and the way back to it
    const before = { log, activeId, reviewedText };
    forgetDecisions();
    setCheckFailed(false);
    void loadWordDiff();
    // One form for accented letters: pasted text can carry an accent as a separate character, and
    // the edits' offsets will be read against what is sent here
    const clean = text.normalize("NFC");
    setText(clean);
    setReviewedText(clean);
    rewrite.start(
      {
        text: clean,
        locale,
        strength: options.strength,
        voice: options.voice,
        keep: options.keep,
      },
      () => {
        setLog(before.log);
        setActiveId(before.activeId);
        setReviewedText(before.reviewedText);
        // A field opened on the withdrawn answer: its ids are this review's too
        setRewording([]);
      },
    );
  }

  function showSample() {
    const { text: words, edits: written } = sample();
    forgetDecisions();
    setCheckFailed(false);
    setReviewedText(words);
    rewrite.show(written, "sample");
  }

  // That text was never the writer's: nothing of it stays in the box or behind it
  function leaveSample() {
    forgetDecisions();
    setText("");
    setReviewedText("");
    rewrite.clear();
  }

  // The rules come with the first check: most readers never ask for one
  async function check() {
    // The offsets will be read against this form of the text, as for a rewrite
    const clean = text.normalize("NFC");
    setCheckFailed(false);
    setChecking(true);
    try {
      const { scanText } = await import("@/lib/check/scan");
      const found = scanText(clean, locale === "fr" ? "fr" : "en");
      forgetDecisions();
      setText(clean);
      setReviewedText(clean);
      rewrite.show(found.edits, "check", found.more);
    } catch {
      setCheckFailed(true);
    } finally {
      setChecking(false);
    }
  }

  const writing = view === "writing";
  // Stop turns into the way back to the editor where it stands, and an Enter meant for Stop would
  // leave the review: the focus on it goes to the heading instead
  useEffect(() => {
    if (!writing && stopOrBack.current === document.activeElement)
      headingRef.current?.focus({ preventScroll: true });
  }, [writing]);
  const isSample = rewrite.source === "sample";
  const result = applyEdits(reviewedText, edits, decisions, overrides);
  // The text's language where it is not the page's, so that a screen reader takes its voice. A short
  // text stays in the page's: a wrong guess reads worse than none.
  const textLang = useMemo(() => {
    const guessed =
      countWords(reviewedText) >= 30 ? guessLanguage(reviewedText) : null;
    return guessed && guessed !== locale ? guessed : undefined;
  }, [reviewedText, locale]);

  function statusWords() {
    if (view === "editing") return rewrite.loading ? t("status.waiting") : "";
    if (change?.phase === phase) return change.words;
    const count = undecided.length;
    if (writing) return t("status.writing", { count: edits.length });
    if (edits.length === 0) return t("status.none");
    if (rewrite.stopped) return t("status.stopped", { count });
    if (rewrite.cutShort) return t("status.cutShort", { count });
    return t("status.ready", { count });
  }

  // A copy's button turns to "Copied", which screen readers do not announce: the status line says
  // it. A second copy in a row would leave the line as it was, and say nothing, so the line empties
  // until the next frame first.
  function sayCopied(what: "text" | "list") {
    setChange({
      words: t(what === "list" ? "status.listCopied" : "status.copied"),
      phase,
    });
    setHushed(true);
  }
  useEffect(() => {
    if (!hushed) return;
    const frame = requestAnimationFrame(() => setHushed(false));
    return () => cancelAnimationFrame(frame);
  }, [hushed]);

  const accepted = edits.filter((e) => decisions[e.id] === "accepted").length;
  const authors = [...new Set(credits.map((c) => c.author))].join(", ");
  const changes =
    accepted === 0
      ? null
      : changeList(edits, decisions, overrides, {
          title: t("list.title", { count: accepted }),
          before: t("list.before"),
          after: t("list.after"),
          why: t("list.why"),
          removed: t("emptyReplacement"),
        });

  return (
    // The editor and the review take each other's place inside this box, which stays on the page.
    // The browser's scroll anchoring then holds on to it, and not to what follows the workspace,
    // which the much taller review would push down, and the page with it.
    <div>
      {/* The one live region of the workspace, on the page before it has anything to say: many
          screen readers do not announce a line that arrives together with its text. */}
      <p role="status" className="sr-only">
        {hushed ? "" : statusWords()}
      </p>
      {view === "editing" ? (
        <TextEditor
          value={text}
          onChange={setText}
          onReady={restoreKept}
          onSubmit={submit}
          onExample={showSample}
          // It would take the place of a review by the model that waits for this very text, which
          // cost an attempt
          onCheck={
            !rewrite.source && edits.length > 0 && text === reviewedText
              ? undefined
              : check
          }
          options={options}
          onOptionsChange={setOptions}
          status={rewrite.loading ? "loading" : checking ? "checking" : "idle"}
          // A check on its way takes the last message away, as a request does: a check that fails
          // can bring the same words, which must be read out again and give the focus back
          error={
            checking
              ? null
              : checkFailed
                ? tErrors("network")
                : rewrite.errorCode && tErrors(rewrite.errorCode)
          }
          // Offsets are only valid against that exact string. A check on its way will replace that
          // review, decisions and all.
          onResume={
            !checking && edits.length > 0 && text === reviewedText
              ? () => {
                  setCheckFailed(false);
                  rewrite.backToReview();
                }
              : undefined
          }
          // Coming back from a review, not on arriving at the page
          focusOnOpen={reviewed}
        />
      ) : (
        <section
          ref={reviewRef}
          // A click inside keeps the focus here, and with it the shortcuts
          tabIndex={-1}
          onKeyDown={reviewing ? onReviewKey : undefined}
          // Reached with the keyboard, a control must not end up under the sticky row
          className="flex scroll-mt-6 flex-col gap-6 outline-none! motion-safe:animate-review-in [&_button]:scroll-mt-24 [&_textarea]:scroll-mt-24"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="font-serif text-2xl font-medium outline-none!"
            >
              {t("title")}
            </h2>
            {writing ? (
              <button
                ref={stopOrBack}
                type="button"
                onClick={rewrite.stop}
                className={quiet}
              >
                <Square className="size-3.5" aria-hidden />
                {tEditor("stop")}
              </button>
            ) : (
              <button
                ref={stopOrBack}
                type="button"
                onClick={firstClick(() => {
                  if (isSample) return leaveSample();
                  setChange(null);
                  setRewording([]);
                  rewrite.backToEditor();
                })}
                className={quiet}
              >
                <ArrowLeft className="size-4" aria-hidden />
                {t(isSample ? "leaveSample" : "backToEditor")}
              </button>
            )}
          </div>

          {rewrite.source && (
            <p className="text-sm text-muted">
              {t(`sourceNotice.${rewrite.source}`)}
            </p>
          )}

          {authors && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <BookOpen className="size-3.5 shrink-0" aria-hidden />
              {t("inspiredBy", { authors })}
            </p>
          )}

          {rewrite.stopped && (
            <p className="text-sm text-muted">{t("stopped")}</p>
          )}

          {rewrite.cutShort && (
            <p className="text-sm text-muted">{t("cutShort")}</p>
          )}

          {rewrite.more > 0 && (
            <p className="text-sm text-muted">
              {t("checkMore", { more: rewrite.more })}
            </p>
          )}

          {edits.length === 0 && !writing ? (
            <p className="rounded-xl border border-border bg-surface p-5 shadow-card">
              {t(rewrite.source === "check" ? "checkNoEdits" : "noEdits")}
            </p>
          ) : (
            <>
              <ReviewBar
                writing={writing}
                total={edits.length}
                accepted={accepted}
                pending={undecided.length}
                canUndo={canUndo(log)}
                onAcceptAll={() => decideEvery("accepted")}
                onRejectAll={() => decideEvery("rejected")}
                onUndo={undoLast}
                onNext={goToNext}
                onCopy={async () => (await panelRef.current?.copy()) ?? false}
              />
              <DiffView
                text={reviewedText}
                edits={edits}
                textLang={textLang}
                // The model writes its reasons in the text's language, the site in the page's
                reasonLang={rewrite.source ? undefined : textLang}
                activeId={reviewing ? active : null}
                decisions={decisions}
                overrides={overrides}
                onDecide={decideEdit}
                rewording={{
                  open: rewording,
                  onStart: openField,
                  onSave: saveWording,
                  onCancel: cancelField,
                }}
              />
              <ResultPanel
                ref={panelRef}
                result={result}
                original={reviewedText}
                changes={changes}
                onCopied={sayCopied}
                onEdit={
                  reviewing && result !== reviewedText && !isSample
                    ? () => {
                        setText(result);
                        forgetDecisions();
                        rewrite.clear();
                      }
                    : undefined
                }
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}
