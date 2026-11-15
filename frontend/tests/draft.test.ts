import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_LOG } from "@/lib/rewrite/decisions";
import {
  clearKeptDraft,
  keepDraftForSignIn,
  readDraft,
  readKeptDraft,
  saveDraft,
  type KeptReview,
} from "@/lib/rewrite/draft";

const KEY = "rewrity:sign-in-draft";
const HOUR = 60 * 60 * 1000;

const typed = (text: string) =>
  saveDraft({ text, options: { strength: "light", voice: "My own sample" } });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  saveDraft(null);
});

describe("the copy kept when a sign-in link is asked for", () => {
  it("holds the text and the strength", () => {
    typed("My text");
    keepDraftForSignIn();
    expect(readKeptDraft()).toEqual({ text: "My text", strength: "light" });
  });

  // The page says twice that the writing sample is not kept
  it("never holds the writing sample", () => {
    typed("My text");
    keepDraftForSignIn();
    expect(localStorage.getItem(KEY)).not.toContain("My own sample");
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!))).toEqual([
      "text",
      "strength",
      "at",
    ]);
  });

  describe("the choice not to keep the text", () => {
    const ticked = (text: string) =>
      saveDraft({
        text,
        options: { strength: "light", voice: "", keep: false },
      });

    it("goes with the copy when ticked", () => {
      ticked("My text");
      keepDraftForSignIn();
      expect(readKeptDraft()).toEqual({
        text: "My text",
        strength: "light",
        keep: false,
      });
    });

    it("is read as nothing else than false", () => {
      for (const keep of [true, "false", 0, null]) {
        localStorage.setItem(
          KEY,
          JSON.stringify({
            text: "x",
            strength: "light",
            keep,
            at: Date.now(),
          }),
        );
        expect(readKeptDraft()?.keep).toBeUndefined();
      }
    });

    it("still leaves the writing sample out", () => {
      saveDraft({
        text: "My text",
        options: { strength: "light", voice: "My own sample", keep: false },
      });
      keepDraftForSignIn();
      expect(localStorage.getItem(KEY)).not.toContain("My own sample");
    });
  });

  it.each([
    ["nothing was typed", null],
    ["the box is empty", ""],
    ["the box holds only spaces", " \n "],
  ])("is not made when %s", (_, text) => {
    if (text !== null) typed(text);
    keepDraftForSignIn();
    expect(localStorage.length).toBe(0);
  });

  it.each([
    ["the box is empty", ""],
    ["the box holds only spaces", " \n "],
  ])("removes the copy of an earlier request when %s now", (_, text) => {
    typed("First");
    keepDraftForSignIn();
    expect(readKeptDraft()?.text).toBe("First");
    typed(text);
    keepDraftForSignIn();
    expect(localStorage.length).toBe(0);
  });

  it("replaces the copy of an earlier request", () => {
    typed("First");
    keepDraftForSignIn();
    typed("Second");
    keepDraftForSignIn();
    expect(readKeptDraft()?.text).toBe("Second");
    expect(localStorage.length).toBe(1);
  });

  it("stays when it is read: only the editor that takes it removes it", () => {
    typed("My text");
    keepDraftForSignIn();
    expect(readKeptDraft()?.text).toBe("My text");
    expect(readKeptDraft()?.text).toBe("My text");
    clearKeptDraft();
    expect(readKeptDraft()).toBeNull();
  });

  it("lasts an hour, then is ignored and removed", () => {
    vi.useFakeTimers();
    typed("My text");
    keepDraftForSignIn();
    vi.advanceTimersByTime(HOUR);
    expect(readKeptDraft()?.text).toBe("My text");
    vi.advanceTimersByTime(1);
    expect(readKeptDraft()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ["not JSON", "{oops"],
    ["null", "null"],
    ["no text", JSON.stringify({ strength: "light", at: Date.now() })],
    [
      "an unknown strength",
      JSON.stringify({ text: "x", strength: "huge", at: Date.now() }),
    ],
    ["no date", JSON.stringify({ text: "x", strength: "light" })],
    [
      "a date in words",
      JSON.stringify({ text: "x", strength: "light", at: "today" }),
    ],
  ])("is thrown away when it holds %s", (_, raw) => {
    localStorage.setItem(KEY, raw);
    expect(readKeptDraft()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does nothing when storage is blocked", () => {
    typed("My text");
    for (const method of ["setItem", "getItem", "removeItem"] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("blocked");
      });
    }
    expect(() => keepDraftForSignIn()).not.toThrow();
    expect(readKeptDraft()).toBeNull();
    expect(() => clearKeptDraft()).not.toThrow();
  });
});

describe("the review kept beside the draft", () => {
  const review: KeptReview = {
    text: "My text",
    edits: [
      {
        id: "edit-0",
        original: "My",
        replacement: "Our",
        reason: "why",
        start: 0,
        end: 2,
      },
    ],
    credits: [],
    stopped: false,
    cutShort: false,
    log: NEW_LOG,
    activeId: null,
    open: true,
    reopened: false,
  };
  const draft = {
    text: "My text",
    options: { strength: "light", voice: "" },
    review,
  } as const;

  it("is there while the reader moves around", () => {
    saveDraft(draft);
    expect(readDraft()?.review).toBe(review);
  });

  // Text and edits stay out of the browser's storage: the page promises it
  it("never reaches the browser's storage, not even with a sign-in link", () => {
    sessionStorage.clear();
    saveDraft(draft);
    keepDraftForSignIn();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(KEY)).not.toContain("edit-0");
    expect(localStorage.getItem(KEY)).not.toContain("Our");
  });
});
