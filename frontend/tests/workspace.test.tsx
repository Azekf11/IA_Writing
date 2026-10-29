import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { stashReopen } from "@/lib/rewrite/reopen";
import {
  encodeEvent,
  STREAM_TYPE,
  type StreamEvent,
} from "@/lib/rewrite/protocol";
import { renderWithIntl } from "./render";

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

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
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

  it("keeps the edits that arrived when the connection drops afterwards", async () => {
    mockStream([START, { type: "edit", edit: EDIT }]);
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
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
});
