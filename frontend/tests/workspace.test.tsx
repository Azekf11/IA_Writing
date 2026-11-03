import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { saveDraft } from "@/lib/rewrite/draft";
import { stashReopen } from "@/lib/rewrite/reopen";
import {
  encodeEvent,
  STREAM_TYPE,
  type StreamEvent,
} from "@/lib/rewrite/protocol";
import { renderWithIntl } from "./render";

const refresh = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

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
  vi.unstubAllGlobals();
  sessionStorage.clear();
  saveDraft(null);
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
    expect(screen.getByText("1 of 1 accepted")).toBeInTheDocument();
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
      expect(screen.getByRole("alert")).toHaveTextContent("could not answer"),
    );
  });

  it("returns to the editor from the review", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(
      await screen.findByRole("button", { name: "Edit the text" }),
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
      screen.getByRole("button", { name: /Edit the text/ }),
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
    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
  });

  it("does not treat typing in a field as a shortcut", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    await screen.findByText("Plainer word");
    await user.click(screen.getByRole("button", { name: "Edit the text" }));
    await user.type(screen.getByLabelText("Your text"), " and a");
    expect(screen.getByLabelText("Your text")).toHaveValue(`${TEXT} and a`);
  });

  it("leaves browser shortcuts alone", async () => {
    mockStream(answer([EDIT]));
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();
    await screen.findByText("Plainer word");
    await user.keyboard("{Meta>}r{/Meta}");
    expect(screen.getByText("0 of 1 accepted")).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: "Edit the text" }));
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
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

      renderWithIntl(<RewriteWorkspace />);
      expect(screen.getByLabelText("Your text")).toHaveValue("Something else");
    });

    describe("after reopening a rewrite and going back to its text", () => {
      const reopenAndEdit = async () => {
        stashReopen(TEXT, [EDIT]);
        const page = renderWithIntl(<RewriteWorkspace />);
        await userEvent.click(
          await screen.findByRole("button", { name: "Edit the text" }),
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

      it("brings nothing back when a change was undone and no draft waited", async () => {
        const page = await reopenAndEdit();
        const box = screen.getByLabelText("Your text");
        await userEvent.type(box, "x{Backspace}");
        page.unmount();
        expect(back()).toHaveValue("");
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
      fireEvent.click(screen.getByRole("button", { name: "Edit the text" }), {
        detail: 2,
      });
      expect(screen.getByText("Plainer word")).toBeInTheDocument();
    });

    it("leaves the keyboard alone, which reports no clicks at all", async () => {
      mockStream(answer([EDIT]));
      renderWithIntl(<RewriteWorkspace />);
      await submit();
      fireEvent.click(await screen.findByRole("button", { name: "Accept" }), {
        detail: 0,
      });
      fireEvent.click(screen.getByRole("button", { name: "Edit the text" }), {
        detail: 0,
      });
      expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
    });
  });
});
