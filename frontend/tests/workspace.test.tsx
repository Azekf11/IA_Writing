import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllowanceLine } from "@/components/allowance-line";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { keepDraftForSignIn, readDraft, saveDraft } from "@/lib/rewrite/draft";
import { MAX_EDITS } from "@/lib/rewrite/guard";
import { stashReopen } from "@/lib/rewrite/reopen";
import {
  encodeEvent,
  STREAM_TYPE,
  type StreamEvent,
} from "@/lib/rewrite/protocol";
import { announceSignedIn } from "@/lib/signed-in";
import { MAX_CHARS } from "@/lib/text";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import { hydrateAfter, renderWithIntl } from "./render";

const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Fails on demand, to stand for code that could not be fetched. Registered again, it is fetched
// again, and arrives when the test says.
const scanning = vi.hoisted(() => ({
  fails: false,
  arrives: Promise.resolve(),
  release: () => {},
}));
const fakeScan = vi.hoisted(
  () =>
    async (
      importOriginal: () => Promise<typeof import("@/lib/check/scan")>,
    ) => {
      await scanning.arrives;
      const real = await importOriginal();
      return {
        ...real,
        scanText: (...args: Parameters<typeof real.scanText>) => {
          if (scanning.fails) throw new Error("could not be fetched");
          return real.scanText(...args);
        },
      };
    },
);
vi.mock("@/lib/check/scan", fakeScan);

const TEXT = "It is crucial to act now.";
const EDIT = {
  id: "edit-0",
  original: "crucial",
  replacement: "important",
  reason: "Plainer word",
  start: 6,
  end: 13,
};

function mockApi(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// A streamed answer: the events, then the connection closes
function mockStream(events: StreamEvent[]) {
  const encoder = new TextEncoder();
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (const event of events)
              controller.enqueue(encoder.encode(encodeEvent(event)));
            controller.close();
          },
        }),
        { headers: { "Content-Type": STREAM_TYPE } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const START: StreamEvent = { type: "start", references: [] };
const DONE: StreamEvent = {
  type: "done",
  dropped: 0,
  ms: { prep: 1, model: 2 },
};
const answer = (edits: (typeof EDIT)[]): StreamEvent[] => [
  START,
  ...edits.map((edit) => ({ type: "edit" as const, edit })),
  DONE,
];

async function submit(text = TEXT) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your text|votre texte/i), text);
  await user.click(screen.getByRole("button", { name: /rewrite|réécrire/i }));
  return user;
}

beforeEach(() => refresh.mockReset());

afterEach(() => {
  // The clipboard outlives a test, and so would a spy that answers in its place
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
  saveDraft(null);
  scanning.fails = false;
  // Whatever a test held back arrives, so that the next check does not wait for it
  scanning.release();
  scanning.release = () => {};
  scanning.arrives = Promise.resolve();
});

describe("RewriteWorkspace", () => {
  it("sends the text and shows the suggested edit", async () => {
    const fetchMock = mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    await submit();

    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rewrite",
      expect.objectContaining({
        body: JSON.stringify({
          text: TEXT,
          locale: "en",
          strength: "standard",
          voice: "",
          stream: true,
        }),
      }),
    );
    // Nothing is applied until the user accepts
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  it("fades the review in, except for readers who have asked for less motion", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    const heading = await screen.findByRole("heading", {
      name: "Suggested edits",
    });
    expect(heading.closest("section")).toHaveClass(
      "motion-safe:animate-review-in",
    );
  });

  it("shows the wording of a cut-short answer in French", async () => {
    mockStream([START, { type: "edit", edit: EDIT }]);
    renderWithIntl(<RewriteWorkspace />, "fr");
    await submit();
    expect(
      await screen.findByText(/Voici les suggestions reçues jusque-là/),
    ).toBeInTheDocument();
  });

  it("applies an edit once accepted and can undo it", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(await screen.findByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("result")).toHaveTextContent(
      "It is important to act now.",
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  it("keeps the original when an edit is rejected", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(await screen.findByRole("button", { name: "Reject" }));
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  it("accepts all edits at once", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(await screen.findByRole("button", { name: "Accept all" }));
    expect(
      screen.getByText("1 accepted, 0 rejected, 0 to decide"),
    ).toBeInTheDocument();
  });

  it("copies the final text", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();

    await user.click(await screen.findByRole("button", { name: "Accept" }));
    await user.click(screen.getByRole("button", { name: "Copy text" }));
    expect(writeText).toHaveBeenCalledWith("It is important to act now.");
  });

  it("says so when there is nothing to change", async () => {
    mockStream(answer([]));
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(
      await screen.findByText(/already reads naturally/),
    ).toBeInTheDocument();
  });

  it("shows a translated error and keeps the text", async () => {
    mockApi(503, { error: "busy" });
    renderWithIntl(<RewriteWorkspace />);
    await submit();

    expect(await screen.findByRole("alert")).toHaveTextContent("busy");
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  it("shows the error in French", async () => {
    mockApi(503, { error: "busy" });
    renderWithIntl(<RewriteWorkspace />, "fr");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("occupé");
  });

  it("reports a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });

  it("falls back to a generic error on an unreadable response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })),
    );
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Something went wrong",
      ),
    );
  });

  it.each([
    ["en", "won't help"],
    ["fr", "Inutile de r\u00e9essayer"],
  ] as const)(
    "says that trying again is no use, in %s",
    async (locale, expected) => {
      mockApi(503, { error: "provider_unavailable" });
      renderWithIntl(<RewriteWorkspace />, locale);
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    },
  );

  it.each([
    ["en", "passed our checks"],
    ["fr", "nos contr\u00f4les"],
  ] as const)(
    "says that no suggestion passed the checks, in %s",
    async (locale, expected) => {
      mockApi(502, { error: "no_usable_edit" });
      renderWithIntl(<RewriteWorkspace />, locale);
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    },
  );

  it("returns to the editor from the review", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(
      await screen.findByRole("button", { name: "Back to the original text" }),
    );
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  it("sends the chosen intensity and the author's own writing", async () => {
    const fetchMock = mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Your text"), TEXT);
    await user.click(screen.getByText("Options"));
    await user.click(screen.getByRole("radio", { name: "Thorough" }));
    await user.type(screen.getByLabelText(/Your own writing/), "Short lines.");
    await user.click(screen.getByRole("button", { name: "Rewrite" }));

    await screen.findByText("Plainer word");
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent).toMatchObject({ strength: "thorough", voice: "Short lines." });
  });

  it("keeps the edits that arrived when the connection drops afterwards, and says it stopped short", async () => {
    mockStream([START, { type: "edit", edit: EDIT }]);
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/cut short/)).toBeInTheDocument();
  });

  // The edits' offsets are read against the text the server received
  it("sends accented letters in one form, and keeps that form on screen", async () => {
    const fetchMock = mockStream(answer([]));
    renderWithIntl(<RewriteWorkspace />);
    await submit("Un re\u0301sume\u0301 de la re\u0301union.");
    await screen.findByText(/Nothing to change/);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.text).toBe("Un résumé de la réunion.");
    await userEvent.click(
      screen.getByRole("button", { name: /Back to the original text/ }),
    );
    expect(screen.getByLabelText("Your text")).toHaveValue(
      "Un résumé de la réunion.",
    );
  });

  it("says so when the server reports an answer that stopped short", async () => {
    mockStream([
      START,
      { type: "edit", edit: EDIT },
      { ...DONE, partial: true } as StreamEvent,
    ]);
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByText(/cut short/)).toBeInTheDocument();
    expect(screen.getByText("Plainer word")).toBeInTheDocument();
  });

  it("does not call a complete answer cut short", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.queryByText(/cut short/)).toBeNull();
  });

  it("shows a refusal that follows some edits, and keeps none of them", async () => {
    mockStream([
      START,
      { type: "edit", edit: EDIT },
      { type: "error", error: "refused" },
    ]);
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/declined/);
    expect(screen.queryByText("Plainer word")).toBeNull();
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  // The model can write a later edit first: the result must stay right at every step
  describe("edits that arrive out of reading order", () => {
    const PLAIN =
      "Alpha one is here. Beta two is there. Gamma three is everywhere.";
    const at = (id: string, original: string, replacement: string) => ({
      id,
      original,
      replacement,
      reason: `why ${id}`,
      start: PLAIN.indexOf(original),
      end: PLAIN.indexOf(original) + original.length,
    });
    const LATER = at("edit-0", "Gamma three", "Third");
    const EARLIER = at("edit-1", "Alpha one", "First");

    // The answer stays open after these events, as it does while the model writes
    function holdStream(events: StreamEvent[]) {
      const encoder = new TextEncoder();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  for (const event of events) {
                    controller.enqueue(encoder.encode(encodeEvent(event)));
                  }
                },
              }),
              { headers: { "Content-Type": STREAM_TYPE } },
            ),
        ),
      );
    }
    const arrivals: StreamEvent[] = [
      START,
      { type: "edit", edit: LATER },
      { type: "edit", edit: EARLIER },
    ];

    it("keeps the text whole while the model writes", async () => {
      holdStream(arrivals);
      renderWithIntl(<RewriteWorkspace />);
      await submit(PLAIN);
      expect(await screen.findByText("2 edits so far")).toBeInTheDocument();
      expect(screen.getByTestId("result").textContent).toBe(PLAIN);
    });

    it("keeps the text whole after Stop, and applies the edits in place", async () => {
      holdStream(arrivals);
      renderWithIntl(<RewriteWorkspace />);
      const user = await submit(PLAIN);
      await screen.findByText("2 edits so far");
      await user.click(screen.getByRole("button", { name: "Stop" }));
      expect(screen.getByTestId("result").textContent).toBe(PLAIN);

      await user.click(screen.getByRole("button", { name: "Accept all" }));
      expect(screen.getByTestId("result").textContent).toBe(
        "First is here. Beta two is there. Third is everywhere.",
      );
    });

    it("keeps the text whole when the connection drops afterwards", async () => {
      mockStream(arrivals);
      renderWithIntl(<RewriteWorkspace />);
      await submit(PLAIN);
      await screen.findByText(/cut short/);
      expect(screen.getByTestId("result").textContent).toBe(PLAIN);
    });
  });

  it("shows the error and the text when the answer fails before any edit", async () => {
    mockStream([START, { type: "error", error: "busy" }]);
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("busy");
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  it("shows edits while the model is still writing, and can stop", async () => {
    // The answer stays open after the first edit
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(encoder.encode(encodeEvent(START)));
                controller.enqueue(
                  encoder.encode(encodeEvent({ type: "edit", edit: EDIT })),
                );
              },
            }),
            { headers: { "Content-Type": STREAM_TYPE } },
          ),
      ),
    );
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.getByText("1 edit so far")).toBeInTheDocument();
    // Bulk actions wait for the full answer
    expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByText(/Stopped/)).toBeInTheDocument();
    expect(screen.getByText("Plainer word")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept all" })).toBeEnabled();
  });

  it("decides edits with the keyboard once the answer is complete", async () => {
    const second = {
      ...EDIT,
      id: "edit-1",
      original: "act",
      replacement: "move",
      reason: "Shorter",
      start: 17,
      end: 20,
    };
    mockStream(answer([EDIT, second]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    await screen.findByText("Shorter");
    await screen.findByText(/A accept, R reject/);

    await user.keyboard("a");
    expect(screen.getByTestId("result")).toHaveTextContent(
      "It is important to act now.",
    );
    // The shortcut moved on to the next edit, which "r" now rejects
    await user.keyboard("r");
    expect(screen.getByTestId("result")).toHaveTextContent(
      "It is important to act now.",
    );
    expect(
      screen.getByText("1 accepted, 1 rejected, 0 to decide"),
    ).toBeInTheDocument();
  });

  it("does not treat typing in a field as a shortcut", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    await screen.findByText("Plainer word");
    await user.click(
      screen.getByRole("button", { name: "Back to the original text" }),
    );
    await user.type(screen.getByLabelText("Your text"), " and a");
    expect(screen.getByLabelText("Your text")).toHaveValue(`${TEXT} and a`);
  });

  it("leaves browser shortcuts alone", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    await screen.findByText("Plainer word");
    await user.keyboard("{Meta>}r{/Meta}");
    expect(
      screen.getByText("0 accepted, 0 rejected, 1 to decide"),
    ).toBeInTheDocument();
  });

  it("opens a rewrite reopened from the history, without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    stashReopen(TEXT, [EDIT]);
    renderWithIntl(<RewriteWorkspace />);

    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
    expect(fetchMock).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(screen.getByTestId("result")).toHaveTextContent(
      "It is important to act now.",
    );
    // Back to the editor, the original text is there to edit
    await user.click(
      screen.getByRole("button", { name: "Back to the original text" }),
    );
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  // Brought back by the browser's Back, the review opens while the browser handles that, and the
  // browser then puts the page where the reader left it, before the next frame
  it("brings a review that comes back into view once the browser has placed the page", async () => {
    const order: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      order.push(`scroll ${this.tagName.toLowerCase()}`);
    };
    try {
      stashReopen(TEXT, [EDIT]);
      renderWithIntl(<RewriteWorkspace />);
      expect(
        screen.getByRole("heading", { name: "Suggested edits" }),
      ).toHaveFocus();
      order.push("placed by the browser");
      await act(
        () => new Promise<void>((done) => requestAnimationFrame(() => done())),
      );
      expect(order).toEqual(["placed by the browser", "scroll section"]);
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });

  it("ignores a stashed rewrite that does not fit its text", async () => {
    stashReopen(TEXT, [{ ...EDIT, start: 1, end: 4 }]);
    renderWithIntl(<RewriteWorkspace />);
    expect(screen.getByLabelText("Your text")).toHaveValue("");
  });

  it("takes the stash away once the rewrite is on screen", async () => {
    stashReopen(TEXT, [EDIT]);
    renderWithIntl(<RewriteWorkspace />);
    await screen.findByText("Plainer word");
    expect(sessionStorage.getItem("rewrity:reopen")).toBeNull();
  });

  // The server's page has the editor: a first render that read the stash would not match it
  it("opens a rewrite reopened on a full load once the page from the server is taken over", async () => {
    const KEPT = "rewrity:sign-in-draft";
    localStorage.setItem(
      KEPT,
      JSON.stringify({
        text: "Something else",
        strength: "thorough",
        at: Date.now(),
      }),
    );
    const errors = vi.spyOn(console, "error");
    const thrown: string[] = [];
    const onError = (event: ErrorEvent) => thrown.push(event.message);
    window.addEventListener("error", onError);
    hydrateAfter(() => stashReopen(TEXT, [EDIT]), <RewriteWorkspace />);
    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    window.removeEventListener("error", onError);
    expect(thrown).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("rewrity:reopen")).toBeNull();
    // The sign-in copy gives way to the reopened rewrite, as it does on a move around the site
    expect(localStorage.getItem(KEPT)).not.toBeNull();
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  // A sibling that suspends discards the workspace's first render, and React starts it again
  it("still shows a reopened rewrite when React throws its first render away", async () => {
    stashReopen(TEXT, [EDIT]);
    let ready = false;
    let resume = () => {};
    const gate = new Promise<void>((resolve) => {
      resume = () => {
        ready = true;
        resolve();
      };
    });
    const Gate = () => {
      if (!ready) throw gate;
      return null;
    };
    renderWithIntl(
      <Suspense fallback="waiting">
        <RewriteWorkspace />
        <Gate />
      </Suspense>,
    );
    expect(screen.getByText("waiting")).toBeInTheDocument();
    await act(async () => resume());
    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  describe("moving around the site", () => {
    it("keeps the text and the options when the editor is recreated", async () => {
      const first = renderWithIntl(<RewriteWorkspace />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText("Your text"), TEXT);
      await user.click(screen.getByText("Options"));
      await user.click(screen.getByRole("radio", { name: "Thorough" }));
      await user.type(
        screen.getByLabelText(/Your own writing/),
        "Short lines.",
      );
      first.unmount();

      renderWithIntl(<RewriteWorkspace />);
      expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
      await user.click(screen.getByText("Options"));
      expect(screen.getByRole("radio", { name: "Thorough" })).toBeChecked();
      expect(screen.getByLabelText(/Your own writing/)).toHaveValue(
        "Short lines.",
      );
    });

    it("keeps it out of the browser's storage", async () => {
      const first = renderWithIntl(<RewriteWorkspace />);
      await userEvent.type(screen.getByLabelText("Your text"), TEXT);
      first.unmount();
      expect(sessionStorage.length).toBe(0);
      expect(localStorage.length).toBe(0);
    });

    it("keeps the typed text for later when a past rewrite is reopened", async () => {
      const first = renderWithIntl(<RewriteWorkspace />);
      await userEvent.type(
        screen.getByLabelText("Your text"),
        "Something else",
      );
      first.unmount();

      stashReopen(TEXT, [EDIT]);
      const second = renderWithIntl(<RewriteWorkspace />);
      expect(await screen.findByText("Plainer word")).toBeInTheDocument();
      second.unmount();

      // The review is what the reader left: the typed text waits behind it
      const third = renderWithIntl(<RewriteWorkspace />);
      await userEvent.click(
        screen.getByRole("button", { name: "Back to the original text" }),
      );
      third.unmount();

      renderWithIntl(<RewriteWorkspace />);
      expect(screen.getByLabelText("Your text")).toHaveValue("Something else");
    });

    describe("after reopening a rewrite and going back to its text", () => {
      const reopenAndEdit = async () => {
        stashReopen(TEXT, [EDIT]);
        const page = renderWithIntl(<RewriteWorkspace />);
        await userEvent.click(
          await screen.findByRole("button", {
            name: "Back to the original text",
          }),
        );
        return page;
      };
      const typeDraft = async () => {
        const first = renderWithIntl(<RewriteWorkspace />);
        await userEvent.type(
          screen.getByLabelText("Your text"),
          "Something else",
        );
        first.unmount();
      };
      const back = () => {
        renderWithIntl(<RewriteWorkspace />);
        return screen.getByLabelText("Your text");
      };

      it("gives back the draft when nothing changed", async () => {
        await typeDraft();
        const page = await reopenAndEdit();
        page.unmount();
        expect(back()).toHaveValue("Something else");
      });

      it("gives back the draft when a change was undone", async () => {
        await typeDraft();
        const page = await reopenAndEdit();
        const box = screen.getByLabelText("Your text");
        await userEvent.type(box, "x{Backspace}");
        expect(box).toHaveValue(TEXT);
        page.unmount();
        expect(back()).toHaveValue("Something else");
      });

      it("keeps the reopened text and its way back when no draft waited", async () => {
        const page = await reopenAndEdit();
        const box = screen.getByLabelText("Your text");
        await userEvent.type(box, "x{Backspace}");
        page.unmount();
        expect(back()).toHaveValue(TEXT);
        expect(
          screen.getByRole("button", { name: "Back to the review" }),
        ).toBeInTheDocument();
      });

      // The text of the first one went into the draft, and is not something the reader typed
      describe("after a second Reopen", () => {
        const reopenTwice = async () => {
          stashReopen("Another text to read.", [
            { ...EDIT, original: "Another", reason: "Other", start: 0, end: 7 },
          ]);
          const first = renderWithIntl(<RewriteWorkspace />);
          await screen.findByText("Other");
          first.unmount();
          const page = await reopenAndEdit();
          page.unmount();
        };

        it("keeps the last reopened text and its way back", async () => {
          await reopenTwice();
          expect(back()).toHaveValue(TEXT);
          expect(
            screen.getByRole("button", { name: "Back to the review" }),
          ).toBeInTheDocument();
        });

        it("still gives back a draft the reader typed before", async () => {
          await typeDraft();
          await reopenTwice();
          expect(back()).toHaveValue("Something else");
        });
      });

      it("keeps a change that stayed", async () => {
        await typeDraft();
        const page = await reopenAndEdit();
        await userEvent.type(screen.getByLabelText("Your text"), "x");
        page.unmount();
        expect(back()).toHaveValue(`${TEXT}x`);
      });

      it("keeps the options set on the unchanged text, with the draft's own text", async () => {
        await typeDraft();
        const page = await reopenAndEdit();
        const user = userEvent.setup();
        await user.click(screen.getByText("Options"));
        await user.click(screen.getByRole("radio", { name: "Thorough" }));
        await user.type(
          screen.getByLabelText(/Your own writing/),
          "Short lines.",
        );
        page.unmount();
        expect(back()).toHaveValue("Something else");
        await user.click(screen.getByText("Options"));
        expect(screen.getByRole("radio", { name: "Thorough" })).toBeChecked();
        expect(screen.getByLabelText(/Your own writing/)).toHaveValue(
          "Short lines.",
        );
      });
    });

    it("says removed for a space written in place of a dash", async () => {
      vi.stubGlobal("fetch", vi.fn());
      stashReopen("It works\u2014and fast.", [
        {
          id: "edit-0",
          original: "\u2014",
          replacement: " ",
          reason: "A plain space",
          start: 8,
          end: 9,
        },
      ]);
      renderWithIntl(<RewriteWorkspace />);
      expect(await screen.findByText("(removed)")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Accept" }));
      expect(screen.getByTestId("result")).toHaveTextContent(
        "It works and fast.",
      );
    });

    it("shows a reopened rewrite rather than the text typed before", async () => {
      const first = renderWithIntl(<RewriteWorkspace />);
      await userEvent.type(
        screen.getByLabelText("Your text"),
        "Something else",
      );
      first.unmount();

      stashReopen(TEXT, [EDIT]);
      renderWithIntl(<RewriteWorkspace />);
      expect(await screen.findByText("Plainer word")).toBeInTheDocument();
      expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
    });
  });

  it("cancels the request when the reader leaves the page", async () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const page = renderWithIntl(<RewriteWorkspace />);
    await submit();
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { signal: AbortSignal },
    ];
    expect(init.signal.aborted).toBe(false);
    page.unmount();
    expect(init.signal.aborted).toBe(true);
  });

  it("lets the account panel follow a session that ended elsewhere, and keeps the text", async () => {
    mockApi(401, { error: "unauthorized" });
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(/sign in/i);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });

  describe("a session that arrives after the page said to sign in", () => {
    const refused = async () => {
      mockApi(401, { error: "unauthorized" });
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      await screen.findByRole("alert");
    };

    it("takes that message back, and keeps the text", async () => {
      await refused();
      act(() => announceSignedIn());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
    });

    it("leaves any other error alone", async () => {
      mockApi(503, { error: "busy" });
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      await screen.findByRole("alert");
      act(() => announceSignedIn());
      expect(screen.getByRole("alert")).toHaveTextContent("busy");
    });

    it("does not count a session that came before the refusal", async () => {
      mockApi(401, { error: "unauthorized" });
      renderWithIntl(<RewriteWorkspace />);
      act(() => announceSignedIn());
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent(/sign in/i);
    });
  });

  describe("the text kept when a sign-in link was asked for", () => {
    const KEY = "rewrity:sign-in-draft";
    const keep = (changes: object = {}) =>
      localStorage.setItem(
        KEY,
        JSON.stringify({
          text: TEXT,
          strength: "thorough",
          at: Date.now(),
          ...changes,
        }),
      );
    const box = () => screen.getByLabelText("Your text");
    const strengthIs = async (name: string) => {
      await userEvent.click(screen.getByText("Options"));
      expect(screen.getByRole("radio", { name })).toBeChecked();
    };

    it("comes back in an empty editor with its strength, and is removed", async () => {
      keep();
      renderWithIntl(<RewriteWorkspace />);
      await waitFor(() => expect(box()).toHaveValue(TEXT));
      await strengthIs("Thorough");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("stays in the draft for a move around the site", async () => {
      keep();
      const first = renderWithIntl(<RewriteWorkspace />);
      await waitFor(() => expect(box()).toHaveValue(TEXT));
      first.unmount();
      renderWithIntl(<RewriteWorkspace />);
      expect(box()).toHaveValue(TEXT);
    });

    // The page from the server has an empty box: a first render that read the copy would not match
    it("is not in the first render, so a full load has nothing to mismatch", async () => {
      keep();
      const errors = vi.spyOn(console, "error");
      let served: string | undefined;
      hydrateAfter(
        (page) => {
          served = page.querySelector("textarea")!.value;
        },
        <RewriteWorkspace />,
      );
      expect(served).toBe("");
      await waitFor(() => expect(box()).toHaveValue(TEXT));
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it("gives way to what was typed before the scripts arrived, and waits", async () => {
      keep();
      hydrateAfter(
        (page) => {
          page.querySelector("textarea")!.value = "Typed early";
        },
        <RewriteWorkspace />,
      );
      await waitFor(() =>
        expect(screen.getByText(/2 words/)).toBeInTheDocument(),
      );
      expect(box()).toHaveValue("Typed early");
      await strengthIs("Standard");
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    // A trip to the history or a language switch, in the tab that asked for the link
    it("gives way to the draft on screen, and waits for the tab the link opens", async () => {
      keep();
      saveDraft({
        text: "Something else",
        options: { strength: "light", voice: "" },
      });
      renderWithIntl(<RewriteWorkspace />);
      await strengthIs("Light");
      expect(box()).toHaveValue("Something else");
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    it("gives way to a reopened rewrite, and waits", async () => {
      keep({ text: "Something else" });
      stashReopen(TEXT, [EDIT]);
      renderWithIntl(<RewriteWorkspace />);
      await userEvent.click(
        await screen.findByRole("button", {
          name: "Back to the original text",
        }),
      );
      expect(box()).toHaveValue(TEXT);
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    it("leaves the writing sample of this tab as it is", async () => {
      keep();
      saveDraft({ text: "", options: { strength: "light", voice: "Mine." } });
      renderWithIntl(<RewriteWorkspace />);
      await waitFor(() => expect(box()).toHaveValue(TEXT));
      await strengthIs("Thorough");
      expect(screen.getByLabelText(/Your own writing/)).toHaveValue("Mine.");
    });

    it("is ignored and removed after an hour, even with a text on screen", async () => {
      keep({ at: Date.now() - 60 * 60 * 1000 - 1 });
      saveDraft({
        text: "Something else",
        options: { strength: "light", voice: "" },
      });
      renderWithIntl(<RewriteWorkspace />);
      expect(box()).toHaveValue("Something else");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("is ignored after an hour in an empty editor too", async () => {
      keep({ at: Date.now() - 60 * 60 * 1000 - 1 });
      renderWithIntl(<RewriteWorkspace />);
      expect(box()).toHaveValue("");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("is sent to no one until the reader asks for a rewrite", async () => {
      const fetchMock = mockStream(answer([EDIT]));
      keep();
      renderWithIntl(<RewriteWorkspace />);
      await waitFor(() => expect(box()).toHaveValue(TEXT));
      expect(fetchMock).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
      await screen.findByText("Plainer word");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        text: TEXT,
        strength: "thorough",
      });
    });
  });

  describe("the choice not to keep the text", () => {
    const NAME = "Do not keep this text in my history";
    const open = () => userEvent.click(screen.getByText("Options"));
    const tick = () => screen.getByRole("checkbox", { name: NAME });
    const sent = (fetchMock: ReturnType<typeof mockStream>) =>
      JSON.parse(fetchMock.mock.calls[0][1].body);

    it("is sent once ticked", async () => {
      const fetchMock = mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await open();
      await userEvent.click(tick());
      await submit();
      await screen.findByText("Plainer word");
      expect(sent(fetchMock)).toEqual({
        text: TEXT,
        locale: "en",
        strength: "standard",
        voice: "",
        stream: true,
        keep: false,
      });
    });

    it("sends the request as before once unticked", async () => {
      const fetchMock = mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await open();
      await userEvent.click(tick());
      await userEvent.click(tick());
      await submit();
      await screen.findByText("Plainer word");
      expect(sent(fetchMock)).not.toHaveProperty("keep");
    });

    it("stays ticked on a move around the site", async () => {
      const first = renderWithIntl(<RewriteWorkspace />);
      await open();
      await userEvent.click(tick());
      first.unmount();
      renderWithIntl(<RewriteWorkspace />);
      await open();
      expect(tick()).toBeChecked();
    });

    describe("in the copy kept when a sign-in link was asked for", () => {
      const KEY = "rewrity:sign-in-draft";
      const kept = (changes: object = {}) =>
        localStorage.setItem(
          KEY,
          JSON.stringify({
            text: TEXT,
            strength: "standard",
            at: Date.now(),
            ...changes,
          }),
        );

      it("goes through the sign-in and is sent", async () => {
        saveDraft({
          text: TEXT,
          options: { strength: "standard", voice: "", keep: false },
        });
        keepDraftForSignIn();
        saveDraft(null);
        const fetchMock = mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />);
        await waitFor(() =>
          expect(screen.getByLabelText("Your text")).toHaveValue(TEXT),
        );
        await open();
        expect(tick()).toBeChecked();
        await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
        await screen.findByText("Plainer word");
        expect(sent(fetchMock).keep).toBe(false);
      });

      it("leaves the box alone when it was not ticked", async () => {
        kept();
        renderWithIntl(<RewriteWorkspace />);
        await waitFor(() =>
          expect(screen.getByLabelText("Your text")).toHaveValue(TEXT),
        );
        await open();
        expect(tick()).not.toBeChecked();
      });

      it("does not untick what this tab has ticked", async () => {
        kept();
        saveDraft({
          text: "",
          options: { strength: "standard", voice: "", keep: false },
        });
        renderWithIntl(<RewriteWorkspace />);
        await waitFor(() =>
          expect(screen.getByLabelText("Your text")).toHaveValue(TEXT),
        );
        await open();
        expect(tick()).toBeChecked();
      });
    });
  });

  describe("the line about the limits", () => {
    const VISITOR = { allowance: { limit: 5, used: null, open: true } };
    const gets = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(([, init]) => init.method !== "POST");
    const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.filter(([, init]) => init.method === "POST");

    // Answers the page's two questions on the one address
    function mockBoth(rewrite: () => Response) {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "POST" ? rewrite() : Response.json(VISITOR),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const streamed = () =>
      new Response(answer([EDIT]).map(encodeEvent).join(""), {
        headers: { "Content-Type": STREAM_TYPE },
      });

    it("is asked again when an attempt ends", async () => {
      const fetchMock = mockBoth(streamed);
      renderWithIntl(
        <>
          <AllowanceLine />
          <RewriteWorkspace />
        </>,
      );
      await waitFor(() => expect(gets(fetchMock)).toHaveLength(1));
      await submit();
      await screen.findByText("Plainer word");
      await waitFor(() => expect(gets(fetchMock)).toHaveLength(2));
      expect(posts(fetchMock)).toHaveLength(1);
    });

    // The failures count too, which is the reason for showing the number at all
    it("is asked again when an attempt fails", async () => {
      const fetchMock = mockBoth(() =>
        Response.json({ error: "busy" }, { status: 503 }),
      );
      renderWithIntl(
        <>
          <AllowanceLine />
          <RewriteWorkspace />
        </>,
      );
      await waitFor(() => expect(gets(fetchMock)).toHaveLength(1));
      await submit();
      await screen.findByRole("alert");
      await waitFor(() => expect(gets(fetchMock)).toHaveLength(2));
    });

    it("asks nothing when it is not on the page", async () => {
      const fetchMock = mockBoth(streamed);
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      await screen.findByText("Plainer word");
      await act(async () => {});
      expect(gets(fetchMock)).toHaveLength(0);
    });

    it("never stops the writer from asking, whatever it says", async () => {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
        init.method === "POST"
          ? streamed()
          : Response.json({
              allowance: { limit: 5, used: 5, open: false },
            }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderWithIntl(
        <>
          <AllowanceLine />
          <RewriteWorkspace />
        </>,
      );
      await screen.findByText("Rewriting is paused for now.");
      await submit();
      await screen.findByText("Plainer word");
      expect(posts(fetchMock)).toHaveLength(1);
    });
  });

  it("does not refresh the page for any other error", async () => {
    mockApi(500, { error: "server_error" });
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  describe("a double click", () => {
    it("on Accept does not undo it", async () => {
      mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      fireEvent.click(await screen.findByRole("button", { name: "Accept" }), {
        detail: 1,
      });
      fireEvent.click(screen.getByRole("button", { name: "Undo" }), {
        detail: 2,
      });
      expect(screen.getByTestId("result")).toHaveTextContent(
        "It is important to act now.",
      );
    });

    it("on Undo does not accept again", async () => {
      mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      fireEvent.click(await screen.findByRole("button", { name: "Accept" }), {
        detail: 1,
      });
      fireEvent.click(screen.getByRole("button", { name: "Undo" }), {
        detail: 1,
      });
      fireEvent.click(screen.getByRole("button", { name: "Accept" }), {
        detail: 2,
      });
      expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
    });

    it("on Stop does not leave the review for the button that takes its place", async () => {
      const encoder = new TextEncoder();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(
          async () =>
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(encoder.encode(encodeEvent(START)));
                  controller.enqueue(
                    encoder.encode(encodeEvent({ type: "edit", edit: EDIT })),
                  );
                },
              }),
              { headers: { "Content-Type": STREAM_TYPE } },
            ),
        ),
      );
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      fireEvent.click(await screen.findByRole("button", { name: "Stop" }), {
        detail: 1,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Back to the original text" }),
        {
          detail: 2,
        },
      );
      expect(screen.getByText("Plainer word")).toBeInTheDocument();
    });

    it("leaves the keyboard alone, which reports no clicks at all", async () => {
      mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      fireEvent.click(await screen.findByRole("button", { name: "Accept" }), {
        detail: 0,
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Back to the original text" }),
        {
          detail: 0,
        },
      );
      expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
    });
  });
  describe("a review of several edits", () => {
    const SECOND = {
      ...EDIT,
      id: "edit-1",
      original: "act",
      replacement: "move",
      reason: "Shorter",
      start: 17,
      end: 20,
    };
    const THIRD = {
      ...EDIT,
      id: "edit-2",
      original: "now",
      replacement: "today",
      reason: "More exact",
      start: 21,
      end: 24,
    };
    const ALL = [EDIT, SECOND, THIRD];
    const NONE = ["pending", "pending", "pending"];
    type User = ReturnType<typeof userEvent.setup>;

    const card = (id: string) => document.getElementById(`review-${id}`)!;
    const inCard = (n: number, name: string) =>
      within(card(`edit-${n}`)).getByRole("button", { name });
    const decisions = () => ALL.map((e) => card(e.id).dataset.decision);
    const result = () => screen.getByTestId("result").textContent;
    const button = (name: string) => screen.getByRole("button", { name });
    const box = () => screen.getByLabelText("Your text");
    const heading = () =>
      screen.getByRole("heading", { name: "Suggested edits" });
    const wayBack = () =>
      screen.queryByRole("button", { name: "Back to the review" });
    const toEditor = (user: User) =>
      user.click(button("Back to the original text"));
    const editResult = () =>
      screen.queryByRole("button", { name: "Edit this result" });
    const line = () => screen.getByRole("status");
    const press = (key: string, repeat = false) =>
      fireEvent.keyDown(document.activeElement!, { key, repeat });

    const review = async () => {
      const fetchMock = mockStream(answer(ALL));
      const page = renderWithIntl(<RewriteWorkspace />);
      const user = await submit();
      await screen.findByText(/A accept, R reject/);
      return { user, fetchMock, page };
    };

    // An answer that stays open until the test has sent what it needs
    function openStream() {
      const encoder = new TextEncoder();
      let sink!: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          sink = controller;
        },
      });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(body, { headers: { "Content-Type": STREAM_TYPE } }),
          ),
      );
      return {
        send: (event: StreamEvent) =>
          sink.enqueue(encoder.encode(encodeEvent(event))),
        close: () => sink.close(),
      };
    }

    // The first edit is on screen and the model is still writing
    const writing = async () => {
      const stream = openStream();
      const page = renderWithIntl(<RewriteWorkspace />);
      const user = await submit();
      stream.send(START);
      stream.send({ type: "edit", edit: EDIT });
      await screen.findByText("Plainer word");
      return { stream, page, user };
    };

    describe("the bulk buttons", () => {
      it("leave a rejected edit rejected when the rest is accepted", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await user.click(button("Accept the rest"));
        expect(decisions()).toEqual(["rejected", "accepted", "accepted"]);
        expect(result()).toBe("It is crucial to move today.");
      });

      it("leave an accepted edit accepted when the rest is rejected", async () => {
        const { user } = await review();
        await user.click(inCard(1, "Accept"));
        await user.click(button("Reject the rest"));
        expect(decisions()).toEqual(["rejected", "accepted", "rejected"]);
        expect(result()).toBe("It is crucial to move now.");
      });

      it("say all, then the rest, then all again", async () => {
        const { user } = await review();
        expect(button("Accept all")).toBeEnabled();
        expect(button("Reject all")).toBeEnabled();
        await user.click(inCard(0, "Reject"));
        expect(button("Accept the rest")).toBeEnabled();
        expect(button("Reject the rest")).toBeEnabled();
        await user.click(button("Accept the rest"));
        expect(button("Accept all")).toBeEnabled();
        expect(button("Reject all")).toBeEnabled();
      });

      it("reach every edit once none is undecided", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await user.click(button("Accept the rest"));
        await user.click(button("Accept all"));
        expect(decisions()).toEqual(["accepted", "accepted", "accepted"]);
      });

      // Between the two clicks the label goes from "the rest" to "all"
      it("do not reach the settled edit with the second click of a double click", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        const rest = button("Accept the rest");
        fireEvent.click(rest, { detail: 1 });
        fireEvent.click(rest, { detail: 2 });
        expect(decisions()).toEqual(["rejected", "accepted", "accepted"]);
      });
    });

    describe("taking a decision back", () => {
      it("works with U after a single decision", async () => {
        const { user } = await review();
        await user.keyboard("a");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        await user.keyboard("u");
        expect(decisions()).toEqual(NONE);
        expect(result()).toBe(TEXT);
      });

      it("takes a bulk decision back in one step, with the button", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await user.click(button("Accept the rest"));
        await user.click(button("Undo last decision"));
        expect(decisions()).toEqual(["rejected", "pending", "pending"]);
      });

      it("brings back what a bulk decision replaced", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await user.click(button("Accept the rest"));
        await user.click(button("Accept all"));
        expect(decisions()).toEqual(["accepted", "accepted", "accepted"]);
        await user.keyboard("u");
        expect(decisions()).toEqual(["rejected", "accepted", "accepted"]);
      });

      it("counts the Undo of a card as a step of its own", async () => {
        const { user } = await review();
        await user.click(inCard(1, "Accept"));
        await user.click(inCard(1, "Undo"));
        expect(decisions()).toEqual(NONE);
        await user.click(button("Undo last decision"));
        expect(decisions()).toEqual(["pending", "accepted", "pending"]);
      });

      it("goes back one step per press, down to the start", async () => {
        const { user } = await review();
        await user.keyboard("ar");
        await user.keyboard("u");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        await user.keyboard("u");
        expect(decisions()).toEqual(NONE);
        await user.keyboard("u");
        expect(decisions()).toEqual(NONE);
        expect(line()).toHaveTextContent("Decision undone. 3 edits left");
      });

      it("takes one step for a held key", async () => {
        const { user } = await review();
        await user.keyboard("aa");
        press("u");
        press("u", true);
        press("u", true);
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("offers the button only once there is a step to take back", async () => {
        const { user } = await review();
        expect(button("Undo last decision")).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        await user.keyboard("a");
        expect(button("Undo last decision")).toHaveAttribute(
          "aria-disabled",
          "false",
        );
      });

      it("marks the edit that came back", async () => {
        const { user } = await review();
        await user.keyboard("aa");
        expect(card("edit-2")).toHaveAttribute("data-active", "true");
        await user.keyboard("u");
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
      });

      it("marks the edit whose Undo was pressed", async () => {
        const { user } = await review();
        await user.click(inCard(1, "Accept"));
        expect(card("edit-2")).toHaveAttribute("data-active", "true");
        await user.click(inCard(1, "Undo"));
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
      });

      it("leaves Ctrl+U to the browser", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.keyboard("{Control>}u{/Control}");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("works on a decision made while the model writes", async () => {
        const { user } = await writing();
        await user.click(screen.getByRole("button", { name: "Accept" }));
        expect(card("edit-0")).toHaveAttribute("data-decision", "accepted");
        await user.click(button("Undo last decision"));
        expect(card("edit-0")).toHaveAttribute("data-decision", "pending");
      });
    });

    describe("the letters", () => {
      // The mark used to stay on the edit the mouse had just decided, and flip it
      it("act on the next edit after a decision made with the mouse", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Accept"));
        await user.keyboard("r");
        expect(decisions()).toEqual(["accepted", "rejected", "pending"]);
      });

      it("take one decision for a held key", async () => {
        await review();
        press("a");
        press("a", true);
        press("a", true);
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("go on moving for a held key", async () => {
        await review();
        press("j");
        press("j", true);
        expect(card("edit-2")).toHaveAttribute("data-active", "true");
      });

      // The ring is a shadow, and forced colours draw none
      it("mark their edit with an outline in forced colours", async () => {
        await review();
        press("j");
        const outlined = (id: string) =>
          card(id).className.includes("forced-colors:[outline:");
        expect(outlined("edit-1")).toBe(true);
        expect(outlined("edit-0")).toBe(false);
      });

      it("leave every decision alone once all are made", async () => {
        const { user } = await review();
        await user.keyboard("ara");
        const made = ["accepted", "rejected", "accepted"];
        expect(decisions()).toEqual(made);
        expect(document.querySelector("[data-active]")).toBeNull();
        await user.keyboard("rar");
        expect(decisions()).toEqual(made);
        // Nothing was recorded either: one step back is the last real decision
        await user.keyboard("u");
        expect(decisions()).toEqual(["accepted", "rejected", "pending"]);
      });

      it("have nothing to act on after a bulk button has decided the rest", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.click(button("Reject the rest"));
        const made = ["accepted", "rejected", "rejected"];
        expect(decisions()).toEqual(made);
        await user.keyboard("a");
        expect(decisions()).toEqual(made);
      });

      it("can change a decided edit the reader moved back to", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.keyboard("k");
        await user.keyboard("r");
        expect(decisions()).toEqual(["rejected", "pending", "pending"]);
      });

      it("wait for the full answer", async () => {
        const { user } = await writing();
        await user.keyboard("a");
        expect(card("edit-0")).toHaveAttribute("data-decision", "pending");
      });

      it("have no mark to act on while the model writes", async () => {
        const { user } = await writing();
        expect(document.querySelector("[data-active]")).toBeNull();
        await user.click(button("Stop"));
        expect(card("edit-0")).toHaveAttribute("data-active", "true");
      });

      it("do nothing while the focus is outside the review", async () => {
        const { user } = await review();
        await user.keyboard("a");
        const made = ["accepted", "pending", "pending"];
        act(() => (document.activeElement as HTMLElement).blur());
        expect(document.body).toHaveFocus();
        for (const key of ["a", "r", "u"]) {
          await user.keyboard(key);
          expect(decisions()).toEqual(made);
        }
        await user.keyboard("j");
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
      });

      // The focus would fall to the page, and the letters with it, with nothing to say why
      it("go on working after a click on nothing outside the review", async () => {
        const { user } = await review();
        await user.click(document.body);
        expect(heading().closest("section")).toHaveFocus();
        await user.keyboard("a");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("do nothing after a click on a control outside the review", async () => {
        const { user } = await review();
        const elsewhere = document.createElement("button");
        elsewhere.textContent = "Elsewhere";
        document.body.append(elsewhere);
        await user.click(elsewhere);
        expect(elsewhere).toHaveFocus();
        await user.keyboard("a");
        expect(decisions()).toEqual(NONE);
        // Safari does not give the focus to a button that is clicked
        act(() => elsewhere.blur());
        fireEvent.pointerUp(elsewhere);
        expect(document.body).toHaveFocus();
        elsewhere.remove();
      });

      it("leave the focus alone after a click on nothing in the editor", async () => {
        const { user } = await review();
        await toEditor(user);
        await user.click(document.body);
        expect(document.body).toHaveFocus();
      });

      it("go on working after a click on the words of a card", async () => {
        const { user } = await review();
        await user.click(screen.getByText("Plainer word"));
        expect(card("edit-0")).toHaveFocus();
        await user.keyboard("a");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("go on working after a click elsewhere in the review", async () => {
        const { user } = await review();
        await user.click(screen.getByText("Result"));
        expect(heading().closest("section")).toHaveFocus();
        await user.keyboard("a");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("go on working after a button of the review was used", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await user.keyboard("a");
        expect(decisions()).toEqual(["rejected", "accepted", "pending"]);
      });

      // Reached with Tab, the card the reader is on can be far from the marked one
      describe("on a card that holds the focus and waits for a decision", () => {
        it("decide that card", async () => {
          const { user } = await review();
          inCard(2, "Accept").focus();
          await user.keyboard("a");
          expect(decisions()).toEqual(["pending", "pending", "accepted"]);
          expect(card("edit-0")).toHaveAttribute("data-active", "true");
        });

        it("open its field", async () => {
          const { user } = await review();
          inCard(1, "Reject").focus();
          await user.keyboard("e");
          expect(document.activeElement).toBe(
            within(card("edit-1")).getByRole("textbox"),
          );
        });

        it("move on from it", async () => {
          const { user } = await review();
          inCard(1, "Accept").focus();
          await user.keyboard("j");
          expect(card("edit-2")).toHaveFocus();
        });
      });
    });

    // A held key repeats, and each repeat of Enter on a button is another click
    describe("a held Enter", () => {
      // One press and one repeat
      const hold = async (user: User, target: HTMLElement) => {
        target.focus();
        await user.keyboard("{Enter>2/}");
      };

      it("takes one bulk decision, which leaves a rejected edit rejected", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Reject"));
        await hold(user, button("Accept the rest"));
        expect(decisions()).toEqual(["rejected", "accepted", "accepted"]);
      });

      it("takes one step back", async () => {
        const { user } = await review();
        await user.keyboard("ar");
        await hold(user, button("Undo last decision"));
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("decides a card once", async () => {
        const { user } = await review();
        await hold(user, inCard(1, "Accept"));
        expect(decisions()).toEqual(["pending", "accepted", "pending"]);
      });

      it("types nothing into the box it leads to, which keeps the way back", async () => {
        const { user } = await review();
        await hold(user, button("Back to the original text"));
        expect(box()).toHaveFocus();
        expect(box()).toHaveValue(TEXT);
        expect(wayBack()).toBeInTheDocument();
      });

      it("goes on typing when it was pressed in a field", async () => {
        const { user } = await review();
        await toEditor(user);
        await user.click(box());
        await user.keyboard("{Enter>3/}");
        expect(box()).toHaveValue(`${TEXT}\n\n\n`);
      });

      it("sends one request with Ctrl", async () => {
        const fetchMock = mockApi(503, { error: "busy" });
        renderWithIntl(<RewriteWorkspace />);
        await userEvent.type(box(), TEXT);
        fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true });
        // Refused at once, so that nothing else holds the next request back
        expect(await screen.findByRole("alert")).toHaveTextContent("busy");
        fireEvent.keyDown(box(), { key: "Enter", ctrlKey: true, repeat: true });
        await act(async () => {});
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    describe("the focus", () => {
      it("goes to the heading when the review opens, and leaves the scrolling alone", async () => {
        const focus = vi.spyOn(HTMLElement.prototype, "focus");
        await review();
        expect(heading()).toHaveFocus();
        expect(focus).toHaveBeenCalledWith({ preventScroll: true });
        focus.mockRestore();
      });

      it("does not go back to the heading as more edits arrive", async () => {
        const { stream, user } = await writing();
        await user.tab();
        expect(button("Stop")).toHaveFocus();
        stream.send({ type: "edit", edit: SECOND });
        await screen.findByText("Shorter");
        expect(button("Stop")).toHaveFocus();
      });

      // Stop turns into the way back to the editor, and an Enter meant for Stop would leave
      describe("on Stop when the answer ends", () => {
        it("goes to the heading", async () => {
          const { stream, user } = await writing();
          await user.tab();
          expect(button("Stop")).toHaveFocus();
          stream.send(DONE);
          stream.close();
          await screen.findByText(/A accept, R reject/);
          expect(heading()).toHaveFocus();
        });

        it("goes to the heading after Stop itself", async () => {
          const { user } = await writing();
          await user.tab();
          await user.keyboard("{Enter}");
          expect(screen.getByText(/^Stopped/)).toBeInTheDocument();
          expect(heading()).toHaveFocus();
        });

        it("is not moved from anywhere else", async () => {
          const { stream } = await writing();
          inCard(0, "Reword").focus();
          stream.send(DONE);
          stream.close();
          await screen.findByText(/A accept, R reject/);
          expect(inCard(0, "Reword")).toHaveFocus();
        });
      });

      it("follows the marked edit", async () => {
        const { user } = await review();
        await user.keyboard("j");
        expect(card("edit-1")).toHaveFocus();
        await user.keyboard("k");
        expect(card("edit-0")).toHaveFocus();
        await user.keyboard("a");
        expect(card("edit-1")).toHaveFocus();
        await user.keyboard("r");
        expect(card("edit-2")).toHaveFocus();
      });

      it("stays on the card of the last decision", async () => {
        const { user } = await review();
        await user.keyboard("aaa");
        expect(card("edit-2")).toHaveFocus();
      });

      it("goes to the edit that came back after U", async () => {
        const { user } = await review();
        await user.keyboard("aa");
        await user.keyboard("u");
        expect(card("edit-1")).toHaveFocus();
      });

      it.each([
        ["Accept", "accepted"],
        ["Reject", "rejected"],
      ])("stays on %s as it turns into Undo and back", async (name) => {
        const { user } = await review();
        await user.click(inCard(0, name));
        expect(inCard(0, "Undo")).toHaveFocus();
        await user.click(inCard(0, "Undo"));
        expect(inCard(0, name)).toHaveFocus();
      });

      it("goes to the box on the way back to the editor", async () => {
        const { user } = await review();
        await toEditor(user);
        expect(box()).toHaveFocus();
      });

      it("goes to the box when the result becomes the new text", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.click(editResult()!);
        expect(box()).toHaveFocus();
      });

      it("comes back to the heading with the way back to the review", async () => {
        const { user } = await review();
        await toEditor(user);
        await user.click(wayBack()!);
        expect(heading()).toHaveFocus();
        await user.keyboard("a");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("stays out of the box when the page first appears", () => {
        renderWithIntl(<RewriteWorkspace />);
        expect(box()).not.toHaveFocus();
      });
    });

    describe("what is said aloud", () => {
      it("goes through one line, there from the start and empty", async () => {
        const { container } = renderWithIntl(<RewriteWorkspace />);
        expect(line()).toBeEmptyDOMElement();
        expect(line()).toHaveClass("sr-only");
        expect(container.querySelector("[aria-live]")).toBeNull();
      });

      it("keeps that line through the whole review", async () => {
        const stream = openStream();
        const { container } = renderWithIntl(<RewriteWorkspace />);
        const first = line();
        const user = await submit();
        expect(line()).toBe(first);
        stream.send(START);
        stream.send({ type: "edit", edit: EDIT });
        await screen.findByText("Plainer word");
        expect(line()).toBe(first);
        stream.close();
        await screen.findByText(/cut short/);
        expect(line()).toBe(first);
        await toEditor(user);
        expect(line()).toBe(first);
        expect(container.querySelector("[aria-live]")).toBeNull();
      });

      it("says the rewrite has started", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(() => new Promise(() => {})),
        );
        renderWithIntl(<RewriteWorkspace />);
        await submit();
        expect(line()).toHaveTextContent("Rewriting your text.");
      });

      it("counts the edits as they arrive, and those to review after", async () => {
        const stream = openStream();
        renderWithIntl(<RewriteWorkspace />);
        await submit();
        stream.send(START);
        stream.send({ type: "edit", edit: EDIT });
        await waitFor(() =>
          expect(line()).toHaveTextContent("1 edit received."),
        );
        stream.send({ type: "edit", edit: SECOND });
        await waitFor(() =>
          expect(line()).toHaveTextContent("2 edits received."),
        );
        stream.send(DONE);
        stream.close();
        await waitFor(() =>
          expect(line()).toHaveTextContent("2 edits to review."),
        );
      });

      it("says there is nothing to change", async () => {
        mockStream(answer([]));
        renderWithIntl(<RewriteWorkspace />);
        await submit();
        await screen.findByText(/already reads naturally/);
        expect(line()).toHaveTextContent("No edits to suggest.");
      });

      it("says the reader stopped it, and what is left", async () => {
        const { user } = await writing();
        await user.click(button("Stop"));
        expect(line()).toHaveTextContent(
          "Rewriting stopped. 1 edit to review.",
        );
      });

      it("says the answer ended early, and what is left", async () => {
        mockStream([START, { type: "edit", edit: EDIT }]);
        renderWithIntl(<RewriteWorkspace />);
        await submit();
        await screen.findByText(/cut short/);
        expect(line()).toHaveTextContent(
          "The answer ended early. 1 edit to review.",
        );
      });

      it("says what each decision did and what is left", async () => {
        const { user } = await review();
        expect(line()).toHaveTextContent("3 edits to review.");
        await user.keyboard("a");
        expect(line()).toHaveTextContent("Accepted. 2 edits left to decide.");
        await user.keyboard("r");
        expect(line()).toHaveTextContent("Rejected. 1 edit left to decide.");
        await user.keyboard("u");
        expect(line()).toHaveTextContent(
          "Decision undone. 2 edits left to decide.",
        );
        await user.click(inCard(0, "Undo"));
        expect(line()).toHaveTextContent(
          "Decision undone. 3 edits left to decide.",
        );
      });

      it("says how many a bulk button decided, not how many exist", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.click(button("Reject the rest"));
        expect(line()).toHaveTextContent(
          "2 edits rejected. Nothing left to decide.",
        );
        await user.click(button("Accept all"));
        expect(line()).toHaveTextContent(
          "3 edits accepted. Nothing left to decide.",
        );
      });

      it("drops the words of a decision when new edits arrive", async () => {
        const { stream, user } = await writing();
        await user.click(screen.getByRole("button", { name: "Accept" }));
        expect(line()).toHaveTextContent("Accepted.");
        stream.send({ type: "edit", edit: SECOND });
        await waitFor(() =>
          expect(line()).toHaveTextContent("2 edits received."),
        );
      });

      it("has nothing to say back on the editor", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await toEditor(user);
        expect(line()).toBeEmptyDOMElement();
      });

      it("says the count of the review again on the way back to it", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await toEditor(user);
        await user.click(wayBack()!);
        expect(line()).toHaveTextContent("2 edits to review.");
      });

      it("speaks the page's language", async () => {
        mockStream(answer(ALL));
        renderWithIntl(<RewriteWorkspace />, "fr");
        const user = await submit();
        await screen.findByText(/A accepter, R refuser/);
        expect(line()).toHaveTextContent("3 modifications à examiner.");
        await user.keyboard("a");
        expect(line()).toHaveTextContent(
          "Acceptée. Il reste 2 modifications à décider.",
        );
      });

      it("tells in each card what was decided", async () => {
        const { user } = await review();
        await user.keyboard("ar");
        expect(card("edit-0")).toHaveTextContent(/^Accepted\./);
        expect(card("edit-1")).toHaveTextContent(/^Rejected\./);
        expect(card("edit-2")).not.toHaveTextContent(/^(Accepted|Rejected)/);
      });

      it("ties each button to the words it acts on", async () => {
        const { user } = await review();
        expect(inCard(1, "Accept")).toHaveAccessibleDescription("act");
        expect(inCard(1, "Reject")).toHaveAccessibleDescription("act");
        await user.click(inCard(1, "Reject"));
        expect(inCard(1, "Undo")).toHaveAccessibleDescription("act");
      });
    });

    describe("the way back from the editor", () => {
      it("brings the decisions back without asking the model again", async () => {
        const { user, fetchMock } = await review();
        await user.keyboard("ar");
        await toEditor(user);
        await user.click(wayBack()!);
        expect(decisions()).toEqual(["accepted", "rejected", "pending"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("brings the steps of Undo back too", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await toEditor(user);
        await user.click(wayBack()!);
        await user.keyboard("u");
        expect(decisions()).toEqual(NONE);
      });

      // The offsets are valid against that exact string, and no other
      it("is there only while the box holds the reviewed text", async () => {
        const { user } = await review();
        await toEditor(user);
        expect(box()).toHaveValue(TEXT);
        expect(wayBack()).toBeInTheDocument();
        await user.type(box(), "x");
        expect(wayBack()).toBeNull();
        await user.type(box(), "{Backspace}");
        expect(wayBack()).toBeInTheDocument();
      });

      it("asks nothing, even with accepted edits", async () => {
        const confirm = vi.spyOn(window, "confirm");
        const { user } = await review();
        await user.keyboard("a");
        await toEditor(user);
        expect(box()).toHaveValue(TEXT);
        expect(confirm).not.toHaveBeenCalled();
        confirm.mockRestore();
      });

      it("is not there before a first review", () => {
        renderWithIntl(<RewriteWorkspace />);
        expect(wayBack()).toBeNull();
      });

      it("is not there for a review without any edit", async () => {
        mockStream(answer([]));
        renderWithIntl(<RewriteWorkspace />);
        const user = await submit();
        await screen.findByText(/already reads naturally/);
        await toEditor(user);
        expect(box()).toHaveValue(TEXT);
        expect(wayBack()).toBeNull();
      });

      it("is gone while the next rewrite runs", async () => {
        const { user } = await review();
        await toEditor(user);
        vi.stubGlobal(
          "fetch",
          vi.fn(() => new Promise(() => {})),
        );
        await user.click(button("Rewrite"));
        expect(wayBack()).toBeNull();
      });

      it("starts the next review from no decision at all", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await toEditor(user);
        await user.click(button("Rewrite"));
        await screen.findByText(/A accept, R reject/);
        expect(decisions()).toEqual(NONE);
        expect(button("Undo last decision")).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });

      describe("after a next rewrite that brings nothing in its place", () => {
        const NEW = { ...SECOND, reason: "A new reason" };
        const again = async (user: User) => {
          await toEditor(user);
          await user.click(button("Rewrite"));
        };

        it("comes back with its decisions alongside the error of the daily limit", async () => {
          const { user } = await review();
          await user.keyboard("ar");
          mockApi(429, { error: "quota_exceeded" });
          await again(user);
          expect(await screen.findByRole("alert")).toHaveTextContent(
            /today's limit/,
          );
          expect(box()).toHaveValue(TEXT);
          expect(wayBack()).toBeInTheDocument();
          await user.click(wayBack()!);
          expect(decisions()).toEqual(["accepted", "rejected", "pending"]);
          expect(result()).toBe("It is important to act now.");
          await user.keyboard("u");
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        });

        it("comes back after a refusal, even one that follows edits of the new answer", async () => {
          const { user } = await review();
          await user.keyboard("a");
          mockStream([
            START,
            { type: "edit", edit: NEW },
            { type: "error", error: "refused" },
          ]);
          await again(user);
          expect(await screen.findByRole("alert")).toHaveTextContent(
            /declined/,
          );
          expect(wayBack()).toBeInTheDocument();
          await user.click(wayBack()!);
          expect(screen.queryByText("A new reason")).toBeNull();
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        });

        // Ids start over with every answer: the declined answer's edit-0 is not this review's
        it("comes back without a field opened on the answer it withdrew", async () => {
          const { user } = await review();
          await user.keyboard("a");
          const stream = openStream();
          await again(user);
          stream.send(START);
          stream.send({
            type: "edit",
            edit: { ...EDIT, reason: "A new reason" },
          });
          await screen.findByText("A new reason");
          await user.click(inCard(0, "Reword"));
          expect(
            screen.getByRole("textbox", { name: "Your wording" }),
          ).toBeInTheDocument();
          stream.send({ type: "error", error: "refused" });
          stream.close();
          expect(await screen.findByRole("alert")).toHaveTextContent(
            /declined/,
          );
          await user.click(wayBack()!);
          expect(
            screen.queryByRole("textbox", { name: "Your wording" }),
          ).toBeNull();
          expect(inCard(0, "Undo")).toBeInTheDocument();
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        });

        // A busy service or a lost connection may well be over by the time the reader comes back
        it("takes its message away once the reader goes back to the review", async () => {
          const { user } = await review();
          await user.keyboard("a");
          mockApi(503, { error: "busy" });
          await again(user);
          expect(await screen.findByRole("alert")).toHaveTextContent(/busy/);
          await user.click(wayBack()!);
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
          await toEditor(user);
          expect(box()).toHaveValue(TEXT);
          expect(screen.queryByRole("alert")).toBeNull();
          expect(wayBack()).toBeInTheDocument();
        });

        // Still true until a session arrives, which takes it away
        it("keeps saying to sign in after a trip to the review", async () => {
          const { user } = await review();
          mockApi(401, { error: "unauthorized" });
          await again(user);
          expect(await screen.findByRole("alert")).toHaveTextContent(
            /sign in/i,
          );
          await user.click(wayBack()!);
          await toEditor(user);
          expect(screen.getByRole("alert")).toHaveTextContent(/sign in/i);
          act(() => announceSignedIn());
          expect(screen.queryByRole("alert")).toBeNull();
        });

        it("waits for the box to hold its text again", async () => {
          const { user } = await review();
          await user.keyboard("a");
          await toEditor(user);
          await user.type(box(), " Then rest.");
          mockApi(429, { error: "quota_exceeded" });
          await user.click(button("Rewrite"));
          await screen.findByRole("alert");
          expect(wayBack()).toBeNull();
          await user.clear(box());
          await user.type(box(), TEXT);
          expect(wayBack()).toBeInTheDocument();
          await user.click(wayBack()!);
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        });

        it("gives way to edits of the new answer that came before it failed", async () => {
          const { user } = await review();
          await user.keyboard("a");
          mockStream([START, { type: "edit", edit: NEW }]);
          await again(user);
          await screen.findByText(/cut short/);
          expect(screen.getByText("A new reason")).toBeInTheDocument();
          expect(screen.queryByText("Plainer word")).toBeNull();
          expect(screen.queryByRole("alert")).toBeNull();
        });

        it("gives way to a new answer stopped on the way", async () => {
          const { user } = await review();
          await user.keyboard("a");
          // The answer ends as a browser ends it when the request is cancelled
          const encoder = new TextEncoder();
          vi.stubGlobal(
            "fetch",
            vi.fn(
              async (_url: string, init: RequestInit) =>
                new Response(
                  new ReadableStream({
                    start(controller) {
                      for (const event of [START, { type: "edit", edit: NEW }])
                        controller.enqueue(
                          encoder.encode(encodeEvent(event as StreamEvent)),
                        );
                      init.signal?.addEventListener("abort", () =>
                        controller.error(
                          new DOMException("Cancelled", "AbortError"),
                        ),
                      );
                    },
                  }),
                  { headers: { "Content-Type": STREAM_TYPE } },
                ),
            ),
          );
          await again(user);
          await user.click(await screen.findByRole("button", { name: "Stop" }));
          await screen.findByText(/what was found so far/);
          expect(screen.getByText("A new reason")).toBeInTheDocument();
          expect(screen.queryByText("Plainer word")).toBeNull();
          expect(screen.queryByRole("alert")).toBeNull();
        });

        it("is not there after a first rewrite that fails", async () => {
          mockApi(429, { error: "quota_exceeded" });
          renderWithIntl(<RewriteWorkspace />);
          await submit();
          await screen.findByRole("alert");
          expect(wayBack()).toBeNull();
        });
      });
    });

    describe("the result as a new text", () => {
      it("is not offered while it is still the text", async () => {
        const { user } = await review();
        expect(editResult()).toBeNull();
        await user.keyboard("r");
        expect(editResult()).toBeNull();
      });

      it("is offered once an edit is accepted, and no more when it is undone", async () => {
        const { user } = await review();
        await user.keyboard("a");
        expect(editResult()).toBeInTheDocument();
        await user.keyboard("u");
        expect(editResult()).toBeNull();
      });

      it("is not offered while the model writes", async () => {
        const { user } = await writing();
        await user.click(screen.getByRole("button", { name: "Accept" }));
        expect(result()).not.toBe(TEXT);
        expect(editResult()).toBeNull();
      });

      it("goes into the box and ends the review", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.click(editResult()!);
        expect(box()).toHaveValue("It is important to act now.");
        expect(screen.queryByText("Plainer word")).toBeNull();
        expect(wayBack()).toBeNull();
      });

      it("leaves nothing to go back to, even with the original text put back", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        await user.click(editResult()!);
        await user.clear(box());
        await user.type(box(), TEXT);
        expect(wayBack()).toBeNull();
        page.unmount();
        renderWithIntl(<RewriteWorkspace />);
        expect(box()).toHaveValue(TEXT);
        expect(wayBack()).toBeNull();
      });

      it("is what the next rewrite sends", async () => {
        const { user } = await review();
        await user.keyboard("a");
        await user.click(editResult()!);
        const next = vi.fn<(url: string, init: RequestInit) => Promise<never>>(
          () => new Promise(() => {}),
        );
        vi.stubGlobal("fetch", next);
        await user.click(button("Rewrite"));
        expect(JSON.parse(next.mock.calls[0][1].body as string)).toMatchObject({
          text: "It is important to act now.",
        });
      });

      it("does not count the second click of a double click", async () => {
        const { user } = await review();
        await user.keyboard("a");
        fireEvent.click(editResult()!, { detail: 2 });
        expect(screen.getByText("Plainer word")).toBeInTheDocument();
      });
    });

    describe("leaving the page and coming back", () => {
      const comeBack = (page: { unmount: () => void }) => {
        page.unmount();
        return renderWithIntl(<RewriteWorkspace />);
      };

      it("brings the review back with its decisions, without the model", async () => {
        const { user, page, fetchMock } = await review();
        await user.keyboard("a");
        comeBack(page);
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        expect(result()).toBe("It is important to act now.");
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("brings it back in the language the reader switched to", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        page.unmount();
        renderWithIntl(<RewriteWorkspace />, "fr");
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        expect(
          screen.getByText("1 acceptée, 0 refusée, 2 à décider"),
        ).toBeInTheDocument();
      });

      it("brings the steps of Undo back", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        comeBack(page);
        expect(heading()).toHaveFocus();
        await userEvent.keyboard("u");
        expect(decisions()).toEqual(NONE);
      });

      it("brings the edit the reader had moved to back", async () => {
        const { user, page } = await review();
        await user.keyboard("jj");
        comeBack(page);
        expect(card("edit-2")).toHaveAttribute("data-active", "true");
      });

      it("keeps it out of the browser's storage", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        comeBack(page);
        expect(sessionStorage.length).toBe(0);
        expect(localStorage.length).toBe(0);
      });

      it("gives back the editor with its way back, if that is where the reader was", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        await toEditor(user);
        comeBack(page);
        expect(box()).toHaveValue(TEXT);
        expect(box()).not.toHaveFocus();
        await userEvent.click(wayBack()!);
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("keeps a text that changed, and the way back for when it is the same again", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        await toEditor(user);
        await user.type(box(), "x");
        comeBack(page);
        expect(box()).toHaveValue(`${TEXT}x`);
        expect(wayBack()).toBeNull();
        await userEvent.type(box(), "{Backspace}");
        await userEvent.click(wayBack()!);
        expect(decisions()).toEqual(["accepted", "pending", "pending"]);
      });

      it("keeps the style references it was made with", async () => {
        mockStream([
          {
            type: "start",
            references: [{ author: "Montaigne", title: "Essais" }],
          },
          { type: "edit", edit: EDIT },
          DONE,
        ]);
        const page = renderWithIntl(<RewriteWorkspace />);
        await submit();
        await screen.findByText("Style references: Montaigne");
        comeBack(page);
        expect(
          screen.getByText("Style references: Montaigne"),
        ).toBeInTheDocument();
      });

      it("keeps saying that the answer was cut short", async () => {
        mockStream([START, { type: "edit", edit: EDIT }]);
        const page = renderWithIntl(<RewriteWorkspace />);
        await submit();
        await screen.findByText(/cut short/);
        comeBack(page);
        expect(screen.getByText(/cut short/)).toBeInTheDocument();
      });

      it("keeps saying that the reader stopped it", async () => {
        const { user, page } = await writing();
        await user.click(button("Stop"));
        comeBack(page);
        expect(screen.getByText(/^Stopped/)).toBeInTheDocument();
      });

      it("keeps a review that found nothing", async () => {
        mockStream(answer([]));
        const page = renderWithIntl(<RewriteWorkspace />);
        await submit();
        await screen.findByText(/already reads naturally/);
        comeBack(page);
        expect(screen.getByText(/already reads naturally/)).toBeInTheDocument();
      });

      it("gives way to a rewrite reopened from the history", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        page.unmount();
        stashReopen("Another text to read.", [
          { ...EDIT, original: "Another", reason: "Other", start: 0, end: 7 },
        ]);
        renderWithIntl(<RewriteWorkspace />);
        expect(await screen.findByText("Other")).toBeInTheDocument();
        expect(screen.queryByText("Plainer word")).toBeNull();
        expect(
          screen.getByText("0 accepted, 0 rejected, 1 to decide"),
        ).toBeInTheDocument();
      });

      it("keeps the decisions on a reopened rewrite too", async () => {
        stashReopen(TEXT, [EDIT]);
        const page = renderWithIntl(<RewriteWorkspace />);
        await userEvent.click(
          await screen.findByRole("button", { name: "Accept" }),
        );
        comeBack(page);
        expect(
          screen.getByText("1 accepted, 0 rejected, 0 to decide"),
        ).toBeInTheDocument();
      });

      it("does not keep an answer still being written", async () => {
        const { page } = await writing();
        comeBack(page);
        expect(box()).toHaveValue(TEXT);
        expect(screen.queryByText("Plainer word")).toBeNull();
        expect(wayBack()).toBeNull();
      });

      it("is over once another rewrite has started", async () => {
        const { user, page } = await review();
        await user.keyboard("a");
        await toEditor(user);
        await user.type(box(), " Again.");
        vi.stubGlobal(
          "fetch",
          vi.fn(() => new Promise(() => {})),
        );
        await user.click(button("Rewrite"));
        comeBack(page);
        expect(box()).toHaveValue(`${TEXT} Again.`);
        expect(wayBack()).toBeNull();
      });

      it("sends no decision to the server", async () => {
        const { user, page, fetchMock } = await review();
        await user.keyboard("a");
        comeBack(page);
        await userEvent.click(
          screen.getByRole("button", { name: "Back to the original text" }),
        );
        await userEvent.click(button("Rewrite"));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1][1].body).not.toContain("accepted");
        expect(fetchMock.mock.calls[1][1].body).not.toContain("edit-0");
      });
    });

    describe("a wording of the writer's own", () => {
      const field = () => screen.getByRole("textbox", { name: "Your wording" });
      const noField = () =>
        screen.queryByRole("textbox", { name: "Your wording" });
      const acceptIt = () => button("Accept this wording");
      const cancel = () => button("Cancel");
      const write = async (user: User, words: string) => {
        await user.clear(field());
        await user.type(field(), words);
      };
      const label = (id: string) =>
        within(card(id)).queryByText("Your wording", { selector: "span" });
      // Their own words on the first edit, with the mouse
      const reworded = async (words = "vital") => {
        const opened = await review();
        await opened.user.click(inCard(0, "Reword"));
        await write(opened.user, words);
        await opened.user.click(acceptIt());
        return opened;
      };
      const comeBack = (page: { unmount: () => void }) => {
        page.unmount();
        return renderWithIntl(<RewriteWorkspace />);
      };

      describe("opening", () => {
        it("has a button on each edit, and starts from the suggestion", async () => {
          const { user } = await review();
          await user.click(inCard(1, "Reword"));
          expect(field()).toHaveValue("move");
          expect(field()).toHaveFocus();
          expect(field()).toHaveProperty("selectionStart", 4);
          expect(decisions()).toEqual(NONE);
        });

        it("names the words it is about on its buttons", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          expect(acceptIt()).toHaveAccessibleDescription("crucial");
          expect(cancel()).toHaveAccessibleDescription("crucial");
        });

        it("opens with E on the marked edit, without typing the letter", async () => {
          const { user } = await review();
          await user.keyboard("e");
          expect(within(card("edit-0")).getByRole("textbox")).toBe(field());
          expect(field()).toHaveValue("important");
          expect(field()).toHaveFocus();
        });

        it("opens with a capital E as well", async () => {
          const { user } = await review();
          await user.keyboard("E");
          expect(field()).toHaveFocus();
        });

        // The field takes the focus while the key is still down, and its repeats land there
        it("does not type a held E into the field it opens", async () => {
          const { user } = await review();
          await user.keyboard("{e>4/}");
          expect(field()).toHaveFocus();
          expect(field()).toHaveValue("important");
          await user.keyboard("e");
          expect(field()).toHaveValue("importante");
        });

        it("takes the focus back on E when it is already open", async () => {
          const { user } = await review();
          await user.keyboard("e");
          heading().focus();
          press("e");
          expect(screen.getAllByRole("textbox")).toHaveLength(1);
          expect(field()).toHaveFocus();
        });

        // Typed in, then left for its card: the E that gives the focus back can still be held down
        it("does not type a held E into the field it takes the focus back to", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await user.keyboard("x");
          card("edit-0").focus();
          await user.keyboard("{e>4/}");
          expect(field()).toHaveFocus();
          expect(field()).toHaveValue("importantx");
          await user.keyboard("e");
          expect(field()).toHaveValue("importantxe");
        });

        it("does not open on a browser shortcut", async () => {
          await review();
          fireEvent.keyDown(heading(), { key: "e", ctrlKey: true });
          fireEvent.keyDown(heading(), { key: "e", metaKey: true });
          expect(noField()).toBeNull();
        });

        it("waits for the end of the answer before the letter works", async () => {
          await writing();
          press("e");
          expect(noField()).toBeNull();
        });

        it("says so in French", async () => {
          mockStream(answer([EDIT]));
          renderWithIntl(<RewriteWorkspace />, "fr");
          const user = await submit();
          await user.click(
            await screen.findByRole("button", { name: "Reformuler" }),
          );
          expect(
            screen.getByRole("textbox", { name: "Votre formulation" }),
          ).toHaveValue("important");
          expect(
            screen.getByRole("button", { name: "Accepter cette formulation" }),
          ).toBeEnabled();
          expect(
            screen.getByRole("button", { name: "Annuler" }),
          ).toBeInTheDocument();
        });
      });

      describe("typing", () => {
        it("leaves every letter to the field", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await user.keyboard("arujke");
          expect(field()).toHaveValue("importantarujke");
          expect(decisions()).toEqual(NONE);
          expect(card("edit-0")).toHaveAttribute("data-active", "true");
        });

        it("keeps a field apart from another one", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await user.click(inCard(1, "Reword"));
          const boxes = screen.getAllByRole("textbox", {
            name: "Your wording",
          });
          expect(boxes).toHaveLength(2);
          await user.type(boxes[0], "A");
          await user.type(boxes[1], "B");
          expect(boxes[0]).toHaveValue("importantA");
          expect(boxes[1]).toHaveValue("moveB");
          await user.click(
            screen.getAllByRole("button", { name: "Accept this wording" })[0],
          );
          expect(result()).toBe("It is importantA to act now.");
          expect(field()).toHaveValue("moveB");
        });

        it("is not closed by an edit that arrives", async () => {
          const { stream, user } = await writing();
          await user.click(inCard(0, "Reword"));
          await write(user, "vital");
          stream.send({ type: "edit", edit: SECOND });
          await screen.findByText("Shorter");
          expect(field()).toHaveValue("vital");
          expect(field()).toHaveFocus();
        });
      });

      describe("giving up", () => {
        it("with Escape closes it and changes nothing", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await user.keyboard("typed");
          await user.keyboard("{Escape}");
          expect(noField()).toBeNull();
          expect(decisions()).toEqual(NONE);
          expect(result()).toBe(TEXT);
          expect(card("edit-0")).toHaveFocus();
        });

        it("leaves the shortcuts working", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await user.keyboard("{Escape}");
          await user.keyboard("a");
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
        });

        it("with the button does the same", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await write(user, "typed");
          await user.click(cancel());
          expect(noField()).toBeNull();
          expect(result()).toBe(TEXT);
          expect(card("edit-0")).toHaveFocus();
        });

        it("puts back what was there, a wording included", async () => {
          const { user } = await reworded();
          await user.click(inCard(0, "Reword"));
          expect(field()).toHaveValue("vital");
          await write(user, "other");
          await user.keyboard("{Escape}");
          expect(result()).toBe("It is vital to act now.");
          expect(decisions()[0]).toBe("accepted");
        });

        it("does not take an Escape meant for a choice of accents", async () => {
          const { user } = await review();
          await user.keyboard("e");
          fireEvent.keyDown(field(), { key: "Escape", isComposing: true });
          expect(field()).toBeInTheDocument();
        });
      });

      describe("accepting it", () => {
        it("puts it in the result and accepts the edit", async () => {
          await reworded();
          expect(noField()).toBeNull();
          expect(result()).toBe("It is vital to act now.");
          expect(decisions()).toEqual(["accepted", "pending", "pending"]);
          expect(label("edit-0")).toBeVisible();
          expect(within(card("edit-0")).getByText("vital")).toBeVisible();
        });

        it("marks the next edit and keeps the focus on the card, with the mouse", async () => {
          await reworded();
          expect(card("edit-1")).toHaveAttribute("data-active", "true");
          expect(card("edit-0")).toHaveFocus();
        });

        it("goes to the next edit with Ctrl+Enter, as a shortcut does", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await write(user, "vital");
          await user.keyboard("{Control>}{Enter}{/Control}");
          expect(result()).toBe("It is vital to act now.");
          expect(card("edit-1")).toHaveFocus();
        });

        it("takes Cmd+Enter as well, and leaves Enter to the field", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await user.keyboard("{Enter}");
          expect(noField()).not.toBeNull();
          expect(field()).toHaveValue("important\n");
          await user.keyboard("{Meta>}{Enter}{/Meta}");
          expect(noField()).toBeNull();
        });

        it("says so on the status line", async () => {
          await reworded();
          expect(line()).toHaveTextContent(
            "Accepted with your wording. 2 edits left to decide.",
          );
        });

        it("is a plain Accept when the suggestion was left as it is", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await user.click(acceptIt());
          expect(result()).toBe("It is important to act now.");
          expect(label("edit-0")).toBeNull();
          expect(line()).toHaveTextContent("Accepted. 2 edits left to decide.");
        });

        it("does not go to the server", async () => {
          const { fetchMock } = await reworded();
          expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("can be changed again", async () => {
          const { user } = await reworded();
          await user.click(inCard(0, "Reword"));
          expect(field()).toHaveValue("vital");
          await write(user, "key");
          await user.click(acceptIt());
          expect(result()).toBe("It is key to act now.");
        });

        it("takes an edit that had been rejected", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reject"));
          await user.click(inCard(0, "Reword"));
          await write(user, "vital");
          await user.click(acceptIt());
          expect(decisions()[0]).toBe("accepted");
          expect(result()).toBe("It is vital to act now.");
        });

        it("works on a rewrite reopened from the history", async () => {
          const fetchMock = vi.fn();
          vi.stubGlobal("fetch", fetchMock);
          stashReopen(TEXT, [EDIT]);
          renderWithIntl(<RewriteWorkspace />);
          const user = userEvent.setup();
          await user.click(button("Reword"));
          await write(user, "vital");
          await user.click(acceptIt());
          expect(result()).toBe("It is vital to act now.");
          expect(fetchMock).not.toHaveBeenCalled();
        });
      });

      describe("blank", () => {
        it("cannot be accepted, and says what to do", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await user.clear(field());
          expect(acceptIt()).toBeDisabled();
          expect(screen.getByText(/Write something here/)).toBeVisible();
          expect(field()).toBeInvalid();
          await user.keyboard("{Control>}{Enter}{/Control}");
          expect(field()).toBeInTheDocument();
          expect(decisions()).toEqual(NONE);
        });

        it("counts spaces and new lines as blank", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await write(user, "  {Enter} ");
          expect(acceptIt()).toBeDisabled();
        });

        it("comes back to life with the first word", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await user.clear(field());
          await user.type(field(), "x");
          expect(acceptIt()).toBeEnabled();
          expect(screen.queryByText(/Write something here/)).toBeNull();
        });

        it("ties what to do to the field", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await user.clear(field());
          expect(field()).toHaveAccessibleDescription(/Write something here/);
        });
      });

      describe("a wording that changes a fact", () => {
        const PRICED = "It costs 10 euros a day.";
        const PRICE = {
          ...EDIT,
          original: "costs 10 euros",
          replacement: "is 10 euros",
          start: 3,
          end: 17,
        };
        const WARNING = /The numbers are not the same as in the original text/;

        const priced = async () => {
          const fetchMock = mockStream(answer([PRICE]));
          renderWithIntl(<RewriteWorkspace />);
          const user = await submit(PRICED);
          await user.click(
            await screen.findByRole("button", { name: "Reword" }),
          );
          return { user, fetchMock };
        };

        it("is warned about, and can still be accepted", async () => {
          const { user, fetchMock } = await priced();
          await write(user, "is 12 euros");
          expect(await screen.findByText(WARNING)).toBeVisible();
          expect(acceptIt()).toBeEnabled();
          await user.click(acceptIt());
          expect(result()).toBe("It is 12 euros a day.");
          expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("is tied to the field and the button, and not read out on its own", async () => {
          const { user } = await priced();
          await write(user, "is 12 euros");
          const warning = await screen.findByText(WARNING);
          expect(field()).toHaveAccessibleDescription(WARNING);
          expect(acceptIt()).toHaveAccessibleDescription(WARNING);
          expect(
            warning.closest("[aria-live], [role=status], [role=alert]"),
          ).toBeNull();
          expect(screen.getAllByRole("status")).toHaveLength(1);
          expect(screen.queryByRole("alert")).toBeNull();
        });

        // Accepted from the field, it never passes the button that carries the warning
        it("is said with the decision when the field's shortcut accepts it", async () => {
          const { user } = await priced();
          await write(user, "is 12 euros");
          await screen.findByText(WARNING);
          await user.keyboard("{Control>}{Enter}{/Control}");
          expect(result()).toBe("It is 12 euros a day.");
          expect(line()).toHaveTextContent(/^Accepted with your wording\./);
          expect(line()).toHaveTextContent(WARNING);
        });

        it("is not said when the number stayed", async () => {
          const { user } = await priced();
          await write(user, "comes to 10 euros");
          await user.keyboard("{Control>}{Enter}{/Control}");
          expect(line()).toHaveTextContent(
            "Accepted with your wording. Nothing left to decide.",
          );
          expect(line()).not.toHaveTextContent(WARNING);
        });

        it("goes away when the number is put back", async () => {
          const { user } = await priced();
          await write(user, "is 12 euros");
          await screen.findByText(WARNING);
          await write(user, "comes to 10 euros");
          expect(screen.queryByText(WARNING)).toBeNull();
          expect(field()).not.toHaveAccessibleDescription();
        });

        it("reads the same in French, with the words of the page", async () => {
          mockStream(answer([PRICE]));
          renderWithIntl(<RewriteWorkspace />, "fr");
          const user = await submit(PRICED);
          await user.click(
            await screen.findByRole("button", { name: "Reformuler" }),
          );
          const box = screen.getByRole("textbox", {
            name: "Votre formulation",
          });
          await user.clear(box);
          await user.type(box, "is 12 euros");
          expect(
            await screen.findByText(/Les nombres ne sont plus ceux/),
          ).toBeVisible();
        });
      });

      describe("taking it back", () => {
        it("with U returns the edit to its suggestion", async () => {
          const { user } = await review();
          await user.keyboard("e");
          await write(user, "vital");
          await user.keyboard("{Control>}{Enter}{/Control}");
          await user.keyboard("u");
          expect(decisions()).toEqual(NONE);
          expect(result()).toBe(TEXT);
          await user.keyboard("a");
          expect(result()).toBe("It is important to act now.");
        });

        it("with the bar's button, after an Accept, keeps the Accept", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Accept"));
          await user.click(inCard(0, "Reword"));
          await write(user, "vital");
          await user.click(acceptIt());
          await user.click(button("Undo last decision"));
          expect(decisions()[0]).toBe("accepted");
          expect(result()).toBe("It is important to act now.");
          expect(label("edit-0")).toBeNull();
        });

        it("with the card's Undo drops the wording", async () => {
          const { user } = await reworded();
          await user.click(inCard(0, "Undo"));
          expect(decisions()).toEqual(NONE);
          expect(label("edit-0")).toBeNull();
          await user.click(inCard(0, "Accept"));
          expect(result()).toBe("It is important to act now.");
        });

        it("brings an Undo's wording back when that Undo is undone", async () => {
          const { user } = await reworded();
          await user.click(inCard(0, "Undo"));
          await user.click(button("Undo last decision"));
          expect(result()).toBe("It is vital to act now.");
          expect(label("edit-0")).toBeVisible();
        });

        it("with Reject all drops the wording", async () => {
          const { user } = await reworded();
          await user.click(button("Accept the rest"));
          await user.click(button("Reject all"));
          expect(decisions()).toEqual(["rejected", "rejected", "rejected"]);
          expect(result()).toBe(TEXT);
          await user.click(button("Accept all"));
          expect(result()).toBe("It is important to move today.");
        });
      });

      describe("a double click", () => {
        // Accept this wording and Cancel come under the pointer of the button that opens the field
        it("on Reword does not accept the wording", async () => {
          await review();
          fireEvent.click(inCard(0, "Reword"), { detail: 1 });
          fireEvent.click(acceptIt(), { detail: 2 });
          expect(field()).toBeInTheDocument();
          expect(decisions()).toEqual(NONE);
        });

        it("on Reword does not cancel", async () => {
          await review();
          fireEvent.click(inCard(0, "Reword"), { detail: 1 });
          fireEvent.click(cancel(), { detail: 2 });
          expect(field()).toBeInTheDocument();
        });

        it("on Cancel does not open the field again", async () => {
          await review();
          fireEvent.click(inCard(0, "Reword"), { detail: 1 });
          fireEvent.click(cancel(), { detail: 1 });
          fireEvent.click(inCard(0, "Reword"), { detail: 2 });
          expect(noField()).toBeNull();
        });
      });

      describe("away from the review", () => {
        it("comes back with the page, from memory alone", async () => {
          const { page, user } = await reworded();
          comeBack(page);
          expect(sessionStorage).toHaveLength(0);
          expect(localStorage).toHaveLength(0);
          expect(result()).toBe("It is vital to act now.");
          expect(label("edit-0")).toBeVisible();
          await user.keyboard("u");
          expect(result()).toBe(TEXT);
        });

        it("comes back from the editor", async () => {
          const { user } = await reworded();
          await toEditor(user);
          await user.click(wayBack()!);
          expect(result()).toBe("It is vital to act now.");
        });

        it("closes a field that is left open, with what was typed in it", async () => {
          const { user } = await review();
          await user.click(inCard(0, "Reword"));
          await write(user, "half a tho");
          await toEditor(user);
          await user.click(wayBack()!);
          expect(noField()).toBeNull();
          expect(result()).toBe(TEXT);
        });

        it("is gone with a new rewrite", async () => {
          const { user } = await reworded();
          await user.click(inCard(1, "Reword"));
          await toEditor(user);
          await user.click(button("Rewrite"));
          await screen.findByText(/A accept, R reject/);
          expect(result()).toBe(TEXT);
          expect(label("edit-0")).toBeNull();
          expect(noField()).toBeNull();
          expect(decisions()).toEqual(NONE);
        });

        it("is closed when the result is carried into the editor", async () => {
          const { user } = await reworded();
          await user.click(inCard(1, "Reword"));
          await user.click(editResult()!);
          // Numbered from the start again, so the same ids come back
          mockStream(
            answer([
              {
                ...EDIT,
                id: "edit-1",
                original: "vital",
                replacement: "key",
                start: 6,
                end: 11,
              },
            ]),
          );
          await user.click(button("Rewrite"));
          await screen.findByText(/A accept, R reject/);
          expect(noField()).toBeNull();
        });

        it("goes with the edits into a new text as words of the reader's", async () => {
          const { user, fetchMock } = await reworded();
          await user.click(editResult()!);
          expect(box()).toHaveValue("It is vital to act now.");
          expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("is never part of what is sent", async () => {
          const { user, fetchMock } = await reworded("my-own-words");
          await toEditor(user);
          await user.click(button("Rewrite"));
          await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
          expect(fetchMock.mock.calls[1][1].body).not.toContain("my-own-words");
        });
      });
    });

    describe("the words that change inside an edit", () => {
      const PHRASE = {
        ...EDIT,
        original: "crucial to act",
        replacement: "vital to act",
        start: 6,
        end: 20,
      };
      const quote = (id: string) => document.getElementById(`quote-${id}`)!;
      const marks = (id: string) =>
        [
          ...card(id).querySelectorAll(
            ".box-decoration-clone.bg-remove-soft, .box-decoration-clone.bg-add-soft",
          ),
        ].map((mark) => mark.textContent);

      const marked = async () => {
        const fetchMock = mockStream(answer([PHRASE, { ...THIRD }]));
        renderWithIntl(<RewriteWorkspace />);
        const user = await submit();
        await waitFor(() =>
          expect(marks("edit-0")).toEqual(["crucial", "vital"]),
        );
        return { user, fetchMock };
      };

      it("marks only the word that changes, on both sides", async () => {
        await marked();
        expect(quote("edit-0")).toHaveTextContent(/^crucial to act$/);
        expect(card("edit-0")).toHaveTextContent("vital to act");
      });

      it("does not colour the whole line then", async () => {
        await marked();
        expect(quote("edit-0")).not.toHaveClass("bg-remove-soft");
      });

      it("keeps the whole line when the two sides share nothing", async () => {
        await marked();
        expect(marks("edit-2")).toEqual([]);
        expect(quote("edit-2")).toHaveClass("bg-remove-soft");
        expect(quote("edit-2")).toHaveTextContent(/^now$/);
      });

      it("keeps the spoken labels, and Before ahead of After", async () => {
        await marked();
        expect(card("edit-0").textContent).toMatch(
          /^Before: crucial to actAfter: vital to act/,
        );
        expect(
          within(card("edit-0")).getByText("Before:", { exact: false }),
        ).toHaveClass("sr-only");
        expect(
          within(card("edit-0")).getByText("After:", { exact: false }),
        ).toHaveClass("sr-only");
      });

      // French spaces the colon off from its word, with a space a line cannot break at
      it("keeps the spoken labels in French, spaced as French has them", async () => {
        mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />, "fr");
        await submit();
        await screen.findByText(/A accepter, R refuser/);
        expect(card("edit-0").textContent).toMatch(
          /^Avant : crucialAprès : important/,
        );
      });

      it("strikes through only what an accepted edit takes out", async () => {
        const { user } = await marked();
        await user.click(inCard(0, "Accept"));
        expect(within(card("edit-0")).getByText("crucial")).toHaveClass(
          "line-through",
        );
        expect(quote("edit-0")).not.toHaveClass("line-through");
      });

      // Forced colours take the background away and underline the words that change instead
      it("keeps that strike in forced colours, where an underline would replace it", async () => {
        const { user } = await marked();
        await user.click(inCard(0, "Accept"));
        const removed = within(card("edit-0")).getByText("crucial");
        expect(removed).toHaveClass("forced-colors:line-through");
        expect(removed).not.toHaveClass("forced-colors:underline");
        expect(within(card("edit-0")).getByText("vital")).toHaveClass(
          "forced-colors:underline",
        );
      });

      it("shows a rejected edit's new words struck through, and takes off the colour", async () => {
        const { user } = await marked();
        await user.click(inCard(0, "Reject"));
        const added = within(card("edit-0")).getByText("vital");
        expect(added).toHaveClass("bg-transparent");
        expect(added.parentElement).toHaveClass("line-through");
        expect(within(card("edit-0")).getByText("crucial")).toHaveClass(
          "bg-transparent",
        );
      });

      it("follows the writer's own wording", async () => {
        const { user } = await marked();
        await user.click(inCard(0, "Reword"));
        const box = screen.getByRole("textbox", { name: "Your wording" });
        await user.clear(box);
        await user.type(box, "essential to act");
        await user.click(button("Accept this wording"));
        expect(marks("edit-0")).toEqual(["crucial", "essential"]);
        expect(result()).toBe("It is essential to act now.");
      });

      it("works on edits reopened from the history", async () => {
        vi.stubGlobal("fetch", vi.fn());
        stashReopen(TEXT, [PHRASE]);
        renderWithIntl(<RewriteWorkspace />);
        await waitFor(() =>
          expect(marks("edit-0")).toEqual(["crucial", "vital"]),
        );
        expect(fetch).not.toHaveBeenCalled();
      });

      it("works on an edit that is still arriving", async () => {
        const stream = openStream();
        renderWithIntl(<RewriteWorkspace />);
        await submit();
        stream.send(START);
        stream.send({ type: "edit", edit: PHRASE });
        await waitFor(() =>
          expect(marks("edit-0")).toEqual(["crucial", "vital"]),
        );
      });
    });

    // A screen reader reads a text in another language than the page's with that language's voice
    describe("the language of the text", () => {
      const ENGLISH = `${TEXT} The team has been working on this plan for many weeks, and we think that it will help the people who need it most when winter comes.`;
      const reviewIn = async (locale: "en" | "fr", text: string) => {
        mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />, locale);
        await submit(text);
        await within(card("edit-0")).findByText("Plainer word");
      };
      const tagged = () =>
        [...card("edit-0").parentElement!.querySelectorAll("[lang]")].map(
          (element) => element.getAttribute("lang"),
        );

      it("is told for the text, the quote, the wording and the model's reason", async () => {
        await reviewIn("fr", ENGLISH);
        const lang = (element: Element | null) => element?.getAttribute("lang");
        const review = card("edit-0").parentElement!;
        expect(
          lang(within(review).getByText(/The team has been working/)),
        ).toBe("en");
        expect(lang(document.getElementById("quote-edit-0"))).toBe("en");
        expect(
          lang(
            within(card("edit-0"))
              .getByText("important")
              .closest("#review-edit-0 [lang]"),
          ),
        ).toBe("en");
        expect(lang(within(card("edit-0")).getByText("Plainer word"))).toBe(
          "en",
        );
      });

      it("is left to the page when it is the page's", async () => {
        await reviewIn("en", ENGLISH);
        expect(tagged()).toEqual([]);
      });

      // A few words are not enough to tell, and a wrong guess reads worse than none
      it("is left to the page when the text is too short to tell", async () => {
        await reviewIn(
          "fr",
          `${TEXT} The team has been working on this plan for many weeks.`,
        );
        expect(tagged()).toEqual([]);
      });
    });

    describe("what the result panel says", () => {
      const length = () => screen.getByTestId("result-length").textContent;
      const copyList = () =>
        screen.queryByRole("button", { name: "Copy the list" });
      const writeOwn = async (user: User, n: number, words: string) => {
        await user.click(inCard(n, "Reword"));
        const box = screen.getByRole("textbox", { name: "Your wording" });
        await user.clear(box);
        await user.type(box, words);
        await user.click(button("Accept this wording"));
      };

      it("follows each decision and each undo", async () => {
        const { user } = await review();
        expect(length()).toBe("6 words · 25 characters");
        await user.click(inCard(0, "Accept"));
        expect(length()).toBe("6 words · 27 characters (+2)");
        await user.click(inCard(1, "Accept"));
        expect(length()).toBe("6 words · 28 characters (+3)");
        await user.click(button("Undo last decision"));
        expect(length()).toBe("6 words · 27 characters (+2)");
        await user.click(button("Undo last decision"));
        expect(length()).toBe("6 words · 25 characters");
      });

      it("says less than before when a wording is shorter", async () => {
        const { user } = await review();
        await writeOwn(user, 0, "key");
        expect(length()).toBe("6 words · 21 characters (-4)");
      });

      it("counts the words of a longer wording", async () => {
        const { user } = await review();
        await writeOwn(user, 0, "of great weight");
        expect(length()).toBe("8 words (+2) · 33 characters (+8)");
      });

      it("starts again from the new text after another rewrite", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Accept"));
        await toEditor(user);
        await user.type(box(), " More.");
        expect(wayBack()).toBeNull();
        await user.click(button("Rewrite"));
        await screen.findByText(/A accept, R reject/);
        expect(length()).toBe("7 words · 31 characters");
      });

      it("offers the list once an edit is accepted, and takes it back with it", async () => {
        const { user } = await review();
        expect(copyList()).toBeNull();
        await user.click(inCard(0, "Reject"));
        expect(copyList()).toBeNull();
        await user.click(inCard(1, "Accept"));
        expect(copyList()).not.toBeNull();
        await user.click(button("Undo last decision"));
        expect(copyList()).toBeNull();
      });

      it("copies the list of accepted edits in reading order, without the server", async () => {
        const { user, fetchMock } = await review();
        await user.click(inCard(2, "Accept"));
        await writeOwn(user, 0, "vital");
        await user.click(inCard(1, "Reject"));
        const clipboard = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(copyList()!);
        expect(clipboard).toHaveBeenCalledExactlyOnceWith(
          [
            "List of accepted edits: 2",
            "1. Before: crucial\nAfter: vital\nWhy: Plainer word",
            "2. Before: now\nAfter: today\nWhy: More exact\n",
          ].join("\n\n"),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("keeps a list of the reader's language", async () => {
        mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />, "fr");
        const user = await submit();
        await user.click(
          await screen.findByRole("button", { name: "Accepter" }),
        );
        const clipboard = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(
          screen.getByRole("button", { name: "Copier la liste" }),
        );
        expect(clipboard).toHaveBeenCalledExactlyOnceWith(
          "Liste des modifications acceptées\u00a0: 1\n\n1. Avant\u00a0: crucial\nAprès\u00a0: important\nPourquoi\u00a0: Plainer word\n",
        );
      });

      // Its button's own name changes, which a screen reader does not say
      it("says a copy of the list on the status line", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Accept"));
        await user.click(copyList()!);
        await waitFor(() => expect(line()).toHaveTextContent("List copied."));
      });

      it("says a copy of the list in French", async () => {
        mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />, "fr");
        const user = await submit();
        await user.click(
          await screen.findByRole("button", { name: "Accepter" }),
        );
        await user.click(
          screen.getByRole("button", { name: "Copier la liste" }),
        );
        await waitFor(() => expect(line()).toHaveTextContent("Liste copiée."));
      });

      it("says nothing of a copy of the list that failed, which the panel shows", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Accept"));
        vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
          new Error("no"),
        );
        await user.click(copyList()!);
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Could not copy the list",
        );
        expect(line()).toHaveTextContent("Accepted.");
      });

      it("works on edits reopened from the history", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        stashReopen(TEXT, [EDIT]);
        renderWithIntl(<RewriteWorkspace />);
        const user = userEvent.setup();
        await user.click(button("Accept"));
        expect(length()).toBe("6 words · 27 characters (+2)");
        const clipboard = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(copyList()!);
        expect(clipboard.mock.calls[0][0]).toContain("After: important");
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe("the row that stays at the top", () => {
      const next = () => button("Next to decide");
      const copy = () => button("Copy");
      // jsdom lays nothing out: every card reads as in view until a test says otherwise
      const outOfSight = (id: string) =>
        vi.spyOn(card(id), "getBoundingClientRect").mockReturnValue({
          top: 3000,
          bottom: 3100,
        } as DOMRect);
      afterEach(() => {
        delete (Element.prototype as Partial<Element>).scrollIntoView;
      });
      // The review comes into view on the frame after it opens
      const nextFrame = () =>
        act(
          () =>
            new Promise<void>((done) => requestAnimationFrame(() => done())),
        );

      it("moves on to the next edit to decide, focus and all", async () => {
        const { user } = await review();
        await user.click(next());
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
        expect(card("edit-1")).toHaveFocus();
      });

      it("passes over what is decided", async () => {
        const { user } = await review();
        await user.click(inCard(1, "Accept"));
        await user.click(next());
        expect(card("edit-0")).toHaveFocus();
        await user.click(next());
        expect(card("edit-2")).toHaveFocus();
      });

      it("goes round to an edit left behind", async () => {
        const { user } = await review();
        await user.click(next());
        await user.click(next());
        await user.click(next());
        expect(card("edit-0")).toHaveFocus();
      });

      it("first brings up a marked card that a click left out of sight", async () => {
        const { user } = await review();
        await user.click(inCard(0, "Accept"));
        expect(card("edit-1")).toHaveAttribute("data-active", "true");
        outOfSight("edit-1");
        await user.click(next());
        expect(card("edit-1")).toHaveFocus();
      });

      it("then moves on, even from a card too tall to fit", async () => {
        const { user } = await review();
        outOfSight("edit-0");
        await user.click(next());
        expect(card("edit-0")).toHaveFocus();
        await user.click(next());
        expect(card("edit-1")).toHaveFocus();
      });

      // Ids start over with every review: the card brought last time is not this one
      it("first brings up the marked card of the next review too", async () => {
        const { user } = await review();
        outOfSight("edit-0");
        await user.click(next());
        expect(card("edit-0")).toHaveFocus();
        await toEditor(user);
        await user.click(button("Rewrite"));
        await screen.findByText(/A accept, R reject/);
        outOfSight("edit-0");
        await user.click(next());
        expect(card("edit-0")).toHaveFocus();
      });

      it("scrolls only as far as it has to", async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        const { user } = await review();
        await nextFrame();
        scroll.mockClear();
        await user.click(next());
        expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "nearest" });
        expect(scroll.mock.contexts[0]).toBe(card("edit-1"));
      });

      it("does nothing with nothing left to decide", async () => {
        const { user } = await review();
        await user.click(button("Accept all"));
        await user.click(next());
        expect(next()).toHaveAttribute("aria-disabled", "true");
        expect(next()).toHaveFocus();
        expect(document.querySelector("[data-active]")).toBeNull();
      });

      it("waits for the end of the answer", async () => {
        const { user } = await writing();
        expect(next()).toHaveAttribute("aria-disabled", "true");
        await user.click(next());
        expect(card("edit-0")).not.toHaveFocus();
      });

      it("copies the result as it stands, wordings included", async () => {
        const { user, fetchMock } = await review();
        await user.click(inCard(0, "Reword"));
        const words = screen.getByRole("textbox", { name: "Your wording" });
        await user.clear(words);
        await user.type(words, "vital");
        await user.click(button("Accept this wording"));
        const clipboard = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(copy());
        expect(clipboard).toHaveBeenCalledExactlyOnceWith(
          "It is vital to act now.",
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The row's button and the panel's, which did the copying
        expect(
          await screen.findAllByRole("button", { name: "Copied" }),
        ).toHaveLength(2);
      });

      // The button's own name changes, which a screen reader does not say
      it("says a copy on the status line, from the panel and from the row", async () => {
        const { user } = await review();
        await user.click(button("Copy text"));
        await waitFor(() => expect(line()).toHaveTextContent("Text copied."));
        await user.click(inCard(0, "Accept"));
        expect(line()).toHaveTextContent("Accepted.");
        await user.click(copy());
        await waitFor(() => expect(line()).toHaveTextContent("Text copied."));
      });

      // The same words again would leave the line as it was, and a screen reader may say nothing
      it("says a second copy in a row again", async () => {
        const { user } = await review();
        const said: string[] = [];
        const watch = new MutationObserver(() =>
          said.push(line().textContent!),
        );
        watch.observe(line(), {
          childList: true,
          characterData: true,
          subtree: true,
        });
        await user.click(button("Copy text"));
        await waitFor(() => expect(said.at(-1)).toBe("Text copied."));
        await user.click(copy());
        await waitFor(() =>
          expect(said.slice(-3)).toEqual(["Text copied.", "", "Text copied."]),
        );
        watch.disconnect();
      });

      it("says it in French", async () => {
        mockStream(answer(ALL));
        renderWithIntl(<RewriteWorkspace />, "fr");
        const user = await submit();
        await screen.findByText(/A accepter, R refuser/);
        await user.click(screen.getByRole("button", { name: "Copier" }));
        await waitFor(() => expect(line()).toHaveTextContent("Texte copié."));
      });

      it("says nothing of a copy that failed, which the panel shows", async () => {
        const { user } = await review();
        vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
          new Error("no"),
        );
        await user.click(copy());
        await screen.findByRole("alert");
        expect(line()).toHaveTextContent("3 edits to review.");
      });

      it("copies while the answer is still arriving", async () => {
        const { user } = await writing();
        const clipboard = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(copy());
        expect(clipboard).toHaveBeenCalledExactlyOnceWith(TEXT);
      });

      it("leaves the failure to the panel, which brings itself into view", async () => {
        const scroll = vi.fn();
        Element.prototype.scrollIntoView = scroll;
        const { user } = await review();
        vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
          new Error("no"),
        );
        await nextFrame();
        scroll.mockClear();
        await user.click(copy());
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Could not copy the text",
        );
        expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start" });
        expect(within(copy()).queryByText("Copied")).toBeNull();
      });

      it("does not add a voice of its own", async () => {
        const { container } = (await review()).page;
        expect(screen.getAllByRole("status")).toHaveLength(1);
        expect(container.querySelector("[aria-live]")).toBeNull();
      });

      it("leaves the bulk buttons out of it, in the flow of the page", async () => {
        await review();
        const stuck = next().closest(".sticky");
        expect(stuck).not.toBeNull();
        expect(stuck).not.toContainElement(button("Accept all"));
        expect(stuck).not.toContainElement(button("Undo last decision"));
      });
    });
  });

  describe("a review with nothing asked of the server", () => {
    const button = (name: string) => screen.getByRole("button", { name });
    const box = () => screen.getByLabelText("Your text");
    const cards = () => [...document.querySelectorAll("[data-decision]")];
    const decisionsNow = () =>
      cards().map((card) => (card as HTMLElement).dataset.decision);
    const heading = () =>
      screen.getByRole("heading", { name: "Suggested edits" });
    const result = () => screen.getByTestId("result").textContent;
    const wayBack = () =>
      screen.queryByRole("button", { name: "Back to the review" });
    const editResult = () =>
      screen.queryByRole("button", { name: "Edit this result" });
    const inCard = (n: number, name: string) =>
      within(cards()[n] as HTMLElement).getByRole("button", { name });
    const noRequests = () => {
      const fetchMock = vi.fn(() => new Promise(() => {}));
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    describe("the example", () => {
      const SAMPLE = /A sample, with edits prepared in advance/;
      const SAMPLE_FR = /Un exemple, avec des modifications préparées/;
      const leave = () => button("Use your own text");
      const open = async () => {
        const fetchMock = noRequests();
        const user = userEvent.setup();
        const page = renderWithIntl(<RewriteWorkspace />);
        await user.click(button("Try an example"));
        return { user, fetchMock, page };
      };

      it("opens a review at once and asks nobody for it", async () => {
        const { fetchMock } = await open();
        expect(heading()).toBeInTheDocument();
        expect(screen.getByText(SAMPLE)).toBeInTheDocument();
        expect(cards()).toHaveLength(en.Editor.exampleEdits.length);
        expect(result()).toBe(en.Editor.exampleText);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("says so with no word on who wrote the text", async () => {
        await open();
        const notice = screen.getByText(SAMPLE).textContent!;
        expect(notice).toMatch(/Nothing was sent, no attempt was used/);
        expect(notice).not.toMatch(/\bAI\b|human|person|written by/i);
      });

      it("moves the focus to the review's heading, like any review", async () => {
        await open();
        expect(heading()).toHaveFocus();
      });

      it("changes the result as edits are accepted, and never asks", async () => {
        const { user, fetchMock } = await open();
        await user.click(inCard(0, "Accept"));
        expect(result()).toMatch(/^Effective communication plays a pivotal/);
        await user.click(button("Accept the rest"));
        expect(result()).toMatch(/^Effective communication helps people/);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("works from the keyboard like any review", async () => {
        const { user } = await open();
        await user.keyboard("a");
        expect(decisionsNow()[0]).toBe("accepted");
      });

      it("comes in the language of the page", async () => {
        const user = userEvent.setup();
        noRequests();
        renderWithIntl(<RewriteWorkspace />, "fr");
        await user.click(button("Essayer un exemple"));
        expect(screen.getByText(SAMPLE_FR)).toBeInTheDocument();
        expect(result()).toBe(fr.Editor.exampleText);
        expect(cards()).toHaveLength(fr.Editor.exampleEdits.length);
      });

      it("has no button to carry the result into the box", async () => {
        const { user } = await open();
        await user.click(inCard(0, "Accept"));
        expect(editResult()).toBeNull();
      });

      it("leaves the box empty, with nothing to go back to", async () => {
        const { user } = await open();
        await user.click(inCard(0, "Accept"));
        await user.click(leave());
        expect(box()).toHaveValue("");
        expect(wayBack()).toBeNull();
        expect(button("Try an example")).toBeInTheDocument();
        expect(box()).toHaveFocus();
        expect(readDraft()?.review).toBeUndefined();
      });

      it("takes away the blanks a box held when it was opened", async () => {
        noRequests();
        const user = userEvent.setup();
        renderWithIntl(<RewriteWorkspace />);
        fireEvent.change(box(), { target: { value: "   " } });
        await user.click(button("Try an example"));
        await user.click(leave());
        expect(box()).toHaveValue("");
      });

      // Edit ids start over with every review: what was decided on "edit-0" is not about this one
      it("does not take over the decisions of an earlier review", async () => {
        mockStream(answer([EDIT]));
        const user = userEvent.setup();
        renderWithIntl(<RewriteWorkspace />);
        await user.type(box(), TEXT);
        await user.click(button("Rewrite"));
        await screen.findByText("Plainer word");
        await user.click(inCard(0, "Accept"));
        await user.click(button("Back to the original text"));
        await user.clear(box());
        await user.click(button("Try an example"));
        expect(new Set(decisionsNow())).toEqual(new Set(["pending"]));
        expect(result()).toBe(en.Editor.exampleText);
      });

      it("is not in the writer's draft, nor in what a sign-in link keeps", async () => {
        await open();
        expect(readDraft()?.text).toBe("");
        keepDraftForSignIn();
        expect(localStorage.getItem("rewrity:sign-in-draft")).toBeNull();
      });

      it("starts over each time: decisions, undo and the marked edit", async () => {
        const { user } = await open();
        await user.click(inCard(0, "Accept"));
        await user.click(inCard(1, "Reject"));
        await user.click(leave());
        await user.click(button("Try an example"));
        expect(new Set(decisionsNow())).toEqual(new Set(["pending"]));
        expect(button("Undo last decision")).toHaveAttribute(
          "aria-disabled",
          "true",
        );
        expect(cards()[0]).toHaveAttribute("data-active", "true");
      });

      it("follows a change of language, decisions and all", async () => {
        const { user, page } = await open();
        await user.click(inCard(1, "Accept"));
        page.unmount();
        renderWithIntl(<RewriteWorkspace />, "fr");
        expect(screen.getByText(SAMPLE_FR)).toBeInTheDocument();
        expect(result()).toContain("aide les gens à se rapprocher");
        expect(decisionsNow()[1]).toBe("accepted");
        expect(readDraft()?.text).toBe("");
      });

      it("comes back as it was after a trip to the history", async () => {
        const { user, page } = await open();
        await user.click(inCard(0, "Accept"));
        page.unmount();
        renderWithIntl(<RewriteWorkspace />);
        expect(screen.getByText(SAMPLE)).toBeInTheDocument();
        expect(decisionsNow()[0]).toBe("accepted");
        expect(editResult()).toBeNull();
        await user.click(leave());
        expect(box()).toHaveValue("");
      });

      it("is gone once the writer sends a text of their own", async () => {
        const { user } = await open();
        await user.click(leave());
        const fetchMock = mockStream(answer([EDIT]));
        await user.type(box(), TEXT);
        await user.click(button("Rewrite"));
        await screen.findByText("Plainer word");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(SAMPLE)).toBeNull();
      });

      it.each(["Accept", "Reject"])(
        "does not count the second click of a double click on %s",
        async (name) => {
          await open();
          fireEvent.click(inCard(0, name), { detail: 2 });
          expect(decisionsNow()[0]).toBe("pending");
        },
      );

      it("does not leave on the second click of a double click", async () => {
        await open();
        fireEvent.click(leave(), { detail: 2 });
        expect(heading()).toBeInTheDocument();
      });
    });

    describe("the free check", () => {
      const FOUND = "We met in order to talk. It is crucial to act now.";
      const CHECK = /Free check: a short list of stock phrases/;
      const LONG_ENOUGH =
        "Moreover, the city of Lyon has been growing over the last ten years.";
      const check = async (text: string, locale: "en" | "fr" = "en") => {
        const fetchMock = noRequests();
        const user = userEvent.setup();
        const page = renderWithIntl(<RewriteWorkspace />, locale);
        fireEvent.change(
          screen.getByLabelText(locale === "fr" ? "Votre texte" : "Your text"),
          { target: { value: text } },
        );
        await user.click(
          button(locale === "fr" ? "Vérification gratuite" : "Free check"),
        );
        await screen.findByRole("heading", { level: 2 });
        return { user, fetchMock, page };
      };

      it("opens a review of the box and asks nobody for it", async () => {
        const { fetchMock } = await check(FOUND);
        expect(screen.getByText(CHECK)).toBeInTheDocument();
        expect(
          screen.getByText(en.Review.checkReason.filler),
        ).toBeInTheDocument();
        expect(result()).toBe(FOUND);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("says so with no word on who wrote the text", async () => {
        await check(FOUND);
        const notice = screen.getByText(CHECK).textContent!;
        expect(notice).toMatch(/Nothing was sent, no attempt was used/);
        expect(notice).not.toMatch(/\bAI\b|human|person|written by/i);
      });

      it("moves the focus to the review's heading, like any review", async () => {
        await check(FOUND);
        expect(heading()).toHaveFocus();
      });

      it("works on more text than a rewrite takes", async () => {
        const long = `${"We met in order to talk. ".repeat(250)}`;
        expect(long.length).toBeGreaterThan(MAX_CHARS);
        const { fetchMock } = await check(long.trim());
        expect(cards().length).toBeGreaterThan(0);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("gives the accepted edits as the result", async () => {
        const { user } = await check(FOUND);
        await user.click(inCard(0, "Accept"));
        expect(result()).toBe("We met to talk. It is crucial to act now.");
      });

      it("names the reason in the language of the page, not of the text", async () => {
        await check(LONG_ENOUGH, "fr");
        expect(
          screen.getByText(fr.Review.checkReason.opener),
        ).toBeInTheDocument();
        expect(result()).toBe(LONG_ENOUGH);
        expect(cards()[0]).toHaveTextContent("The");
      });

      // Read aloud, the quote takes the text's voice and the reason the page's
      it("tells the text's language for the quote, and leaves the reason to the page's", async () => {
        const long = `${FOUND} The team has been working on this plan for many weeks, and we think that it will help the people who need it most.`;
        await check(long, "fr");
        const first = cards()[0] as HTMLElement;
        expect(first.querySelector("[id^='quote-']")).toHaveAttribute(
          "lang",
          "en",
        );
        expect(
          within(first).getByText(fr.Review.checkReason.filler),
        ).not.toHaveAttribute("lang");
      });

      it("reads the text in its own language, whatever the page's", async () => {
        const french =
          "De plus, les prix de la commune sont en hausse depuis le début de l'année.";
        await check(french, "en");
        expect(
          screen.getByText(en.Review.checkReason.opener),
        ).toBeInTheDocument();
        expect(cards()).toHaveLength(1);
      });

      it("takes the language of the page when the text is too short to tell", async () => {
        await check("De plus, cela suffit.", "fr");
        expect(cards()).toHaveLength(1);
        expect(result()).toBe("De plus, cela suffit.");
      });

      it("has its own words when the list finds nothing", async () => {
        await check("We walked to the sea.");
        expect(
          screen.getByText(/Nothing on the list turned up/),
        ).toBeInTheDocument();
        expect(screen.queryByText(/already reads naturally/)).toBeNull();
      });

      it("says when there were more than it shows", async () => {
        const text = "We met in order to talk. ".repeat(MAX_EDITS + 2).trim();
        await check(text);
        expect(cards()).toHaveLength(MAX_EDITS);
        expect(
          screen.getByText(/2 more edits are not shown/),
        ).toBeInTheDocument();
      });

      it("still says so after a change of language", async () => {
        const text = "We met in order to talk. ".repeat(MAX_EDITS + 2).trim();
        const { page } = await check(text);
        page.unmount();
        renderWithIntl(<RewriteWorkspace />, "fr");
        expect(screen.getByText(/2 autres modifications/)).toBeInTheDocument();
      });

      it("offers nothing of the kind at the limit itself", async () => {
        const text = "We met in order to talk. ".repeat(MAX_EDITS).trim();
        await check(text);
        expect(screen.queryByText(/not shown/)).toBeNull();
      });

      it("lets the result go into the box, like any review", async () => {
        const { user } = await check(FOUND);
        await user.click(inCard(0, "Accept"));
        await user.click(editResult()!);
        expect(box()).toHaveValue("We met to talk. It is crucial to act now.");
        expect(wayBack()).toBeNull();
        expect(screen.queryByText(CHECK)).toBeNull();
      });

      it("goes back to the writer's text, with the way back to the review", async () => {
        const { user } = await check(FOUND);
        await user.click(inCard(0, "Accept"));
        await user.click(button("Back to the original text"));
        expect(box()).toHaveValue(FOUND);
        await user.click(wayBack()!);
        expect(decisionsNow()[0]).toBe("accepted");
        expect(screen.getByText(CHECK)).toBeInTheDocument();
      });

      it("reads the box in the form a rewrite would send", async () => {
        const decomposed =
          "Le caf\u0065\u0301 ferme. Nous partons in order to talk.";
        await check(decomposed);
        const composed = decomposed.normalize("NFC");
        expect(result()).toBe(composed);
        await userEvent.click(button("Back to the original text"));
        expect(box()).toHaveValue(composed);
      });

      it("starts over: decisions, undo and the marked edit", async () => {
        const { user } = await check(FOUND);
        await user.click(inCard(0, "Accept"));
        await user.click(button("Back to the original text"));
        await user.click(button("Free check"));
        await screen.findByRole("heading", { level: 2 });
        expect(new Set(decisionsNow())).toEqual(new Set(["pending"]));
        expect(button("Undo last decision")).toHaveAttribute(
          "aria-disabled",
          "true",
        );
      });

      it("keeps the reasons in the language of the page after a change", async () => {
        const { page } = await check(FOUND);
        page.unmount();
        renderWithIntl(<RewriteWorkspace />, "fr");
        expect(
          screen.getByText(fr.Review.checkReason.filler),
        ).toBeInTheDocument();
        expect(result()).toBe(FOUND);
      });

      // It would take the place of that review, which cost an attempt, and of its decisions
      it("is not offered while a review by the model waits for this very text", async () => {
        mockStream(answer([EDIT]));
        renderWithIntl(<RewriteWorkspace />);
        const user = await submit();
        await user.click(await screen.findByRole("button", { name: "Accept" }));
        await user.click(button("Back to the original text"));
        const freeCheck = () =>
          screen.queryByRole("button", { name: "Free check" });
        expect(box()).toHaveValue(TEXT);
        expect(wayBack()).toBeInTheDocument();
        expect(freeCheck()).toBeNull();
        await user.type(box(), "x");
        expect(wayBack()).toBeNull();
        expect(freeCheck()).toBeEnabled();
        await user.type(box(), "{Backspace}");
        expect(freeCheck()).toBeNull();
        await user.click(wayBack()!);
        expect(decisionsNow()).toEqual(["accepted"]);
      });

      it("does not offer the way back while its code is on the way, and gives it back if it fails", async () => {
        const { user } = await check(FOUND);
        await user.click(inCard(0, "Accept"));
        await user.click(button("Back to the original text"));
        expect(wayBack()).toBeInTheDocument();
        // As on the first check of a page: the code has to be fetched
        scanning.arrives = new Promise<void>(
          (resolve) => (scanning.release = resolve),
        );
        vi.doMock("@/lib/check/scan", fakeScan);
        await user.click(button("Free check"));
        expect(button("Free check")).toBeDisabled();
        expect(wayBack()).toBeNull();
        scanning.fails = true;
        await act(async () => scanning.release());
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Network error",
        );
        await user.click(wayBack()!);
        expect(decisionsNow()[0]).toBe("accepted");
        // Back in the editor, the message is about a check the reader has moved on from
        await user.click(button("Back to the original text"));
        expect(box()).toHaveValue(FOUND);
        expect(screen.queryByRole("alert")).toBeNull();
      });

      it("is gone once a real rewrite starts", async () => {
        const { user } = await check(FOUND);
        await user.click(button("Back to the original text"));
        const fetchMock = mockStream(answer([EDIT]));
        await user.clear(box());
        await user.type(box(), TEXT);
        await user.click(button("Rewrite"));
        await screen.findByText("Plainer word");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(screen.queryByText(CHECK)).toBeNull();
      });

      it("says what went wrong when its code cannot be fetched", async () => {
        scanning.fails = true;
        const fetchMock = noRequests();
        const user = userEvent.setup();
        renderWithIntl(<RewriteWorkspace />);
        fireEvent.change(box(), { target: { value: FOUND } });
        await user.click(button("Free check"));
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Network error",
        );
        expect(box()).toHaveValue(FOUND);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      // Its message has the words a rewrite that could not connect leaves: it still has to be read
      // out, and to give the focus back
      it("says it failed again after a rewrite that failed the same way", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
        );
        scanning.fails = true;
        const user = userEvent.setup();
        renderWithIntl(<RewriteWorkspace />);
        fireEvent.change(box(), { target: { value: FOUND } });
        await user.click(button("Rewrite"));
        const before = await screen.findByRole("alert");
        expect(before).toHaveTextContent("Network error");
        // A browser drops the focus of a button that becomes disabled, to the page. jsdom leaves it
        // on the button, so the test puts it on the page before the click.
        act(() => (document.activeElement as HTMLElement).blur());
        fireEvent.click(button("Free check"));
        await waitFor(() => expect(button("Free check")).toBeEnabled());
        expect(button("Free check")).toHaveFocus();
        // A new message, not the one that was there: a screen reader says it again
        const after = screen.getByRole("alert");
        expect(after).toHaveTextContent("Network error");
        expect(after).not.toBe(before);
      });

      it("takes the message back when the next try works", async () => {
        scanning.fails = true;
        noRequests();
        const user = userEvent.setup();
        renderWithIntl(<RewriteWorkspace />);
        fireEvent.change(box(), { target: { value: FOUND } });
        await user.click(button("Free check"));
        await screen.findByRole("alert");
        scanning.fails = false;
        await user.click(button("Free check"));
        await screen.findByRole("heading", { level: 2 });
        await user.click(button("Back to the original text"));
        expect(box()).toHaveValue(FOUND);
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });
});
