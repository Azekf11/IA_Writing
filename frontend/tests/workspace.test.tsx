import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
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

async function submit(text = TEXT) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/your text|votre texte/i), text);
  await user.click(screen.getByRole("button", { name: /rewrite|réécrire/i }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RewriteWorkspace", () => {
  it("sends the text and shows the suggested edit", async () => {
    const fetchMock = mockApi(200, { edits: [EDIT] });
    renderWithIntl(<RewriteWorkspace />);
    await submit();

    expect(await screen.findByText("Plainer word")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/rewrite",
      expect.objectContaining({
        body: JSON.stringify({ text: TEXT, locale: "en" }),
      }),
    );
    // Nothing is applied until the user accepts
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  it("applies an edit once accepted and can undo it", async () => {
    mockApi(200, { edits: [EDIT] });
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
    mockApi(200, { edits: [EDIT] });
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(await screen.findByRole("button", { name: "Reject" }));
    expect(screen.getByTestId("result")).toHaveTextContent(TEXT);
  });

  it("accepts all edits at once", async () => {
    mockApi(200, { edits: [EDIT] });
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(await screen.findByRole("button", { name: "Accept all" }));
    expect(screen.getByText("1 of 1 accepted")).toBeInTheDocument();
  });

  it("copies the final text", async () => {
    mockApi(200, { edits: [EDIT] });
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
    mockApi(200, { edits: [] });
    renderWithIntl(<RewriteWorkspace />);
    await submit();
    expect(await screen.findByText(/already reads naturally/)).toBeVisible();
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
    mockApi(200, { edits: [EDIT] });
    renderWithIntl(<RewriteWorkspace />);
    const user = await submit();

    await user.click(
      await screen.findByRole("button", { name: "Edit the text" }),
    );
    expect(screen.getByLabelText("Your text")).toHaveValue(TEXT);
  });
});
