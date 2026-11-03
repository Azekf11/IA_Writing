import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "@/components/history-list";
import { hydrateAfter, renderWithIntl } from "./render";

const del = vi.fn();
const delAll = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({
        in: (...args: unknown[]) => del(...args),
        not: (...args: unknown[]) => delAll(...args),
      }),
    }),
  }),
}));

const items = [
  {
    id: "a",
    original: "First text",
    edits: [],
    editCount: 2,
    createdAt: "2026-10-01T10:00:00Z",
  },
  {
    id: "b",
    original: "Second text",
    edits: [],
    editCount: 1,
    createdAt: "2026-10-02T10:00:00Z",
  },
];

beforeEach(() => {
  del.mockReset();
  delAll.mockReset();
  push.mockReset();
  refresh.mockReset();
  sessionStorage.clear();
});

describe("HistoryList", () => {
  it("shows each entry with its edit count", () => {
    renderWithIntl(<HistoryList items={items} />);
    expect(screen.getByText("First text")).toBeInTheDocument();
    expect(screen.getByText(/2 edits/)).toBeInTheDocument();
    expect(screen.getByText(/ 1 edit$/)).toBeInTheDocument();
  });

  it("shows a helpful empty state", () => {
    renderWithIntl(<HistoryList items={[]} />);
    expect(screen.getByText("No rewrites yet.")).toBeInTheDocument();
    expect(screen.getByText(/will show up here/)).toBeInTheDocument();
  });

  it("removes an entry once the delete succeeds", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() =>
      expect(screen.queryByText("First text")).not.toBeInTheDocument(),
    );
    expect(del).toHaveBeenCalledWith("id", ["a"]);
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  // The list closes up after a delete, so the next row's button comes under the pointer
  it("deletes one entry on a double click, not two", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} />);
    const [first] = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(first, { detail: 1 });
    await waitFor(() =>
      expect(screen.queryByText("First text")).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }), {
      detail: 2,
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  // The question's line closes, so the first row's Reopen comes under the pointer
  it("does not reopen on the second click of a double click on Yes", async () => {
    let finish: (value: { error: null }) => void = () => {};
    delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete all" }));
    const [reopen] = screen.getAllByRole("button", { name: "Reopen" });
    // Still deleting: the button does nothing, whatever the click count
    expect(reopen).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(reopen, { detail: 2 });
    fireEvent.click(reopen, { detail: 1 });
    expect(push).not.toHaveBeenCalled();
    finish({ error: null });
    await waitFor(() =>
      expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps the keyboard's place during a delete, and Enter tries again after a failure", async () => {
    let finish: (value: unknown) => void = () => {};
    del.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    renderWithIntl(<HistoryList items={items} />);
    const [button] = screen.getAllByRole("button", { name: "Delete" });
    button.focus();
    await userEvent.keyboard("{Enter}");
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    // Still running: nothing starts twice, from this row or another one
    await userEvent.keyboard("{Enter}");
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[1], {
      detail: 1,
    });
    expect(del).toHaveBeenCalledTimes(1);

    finish({ error: { code: "500" }, status: 500 });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "false");

    del.mockResolvedValueOnce({ error: null });
    await userEvent.keyboard("{Enter}");
    expect(del).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("1 rewrite")).toBeInTheDocument();
  });

  it("filters by a search typed before the scripts arrived", async () => {
    hydrateAfter(
      (page) => {
        page.querySelector("input")!.value = "second";
      },
      <HistoryList items={items} />,
    );
    await waitFor(() => expect(screen.queryByText("First text")).toBeNull());
    expect(screen.getByText("Second text")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("second");
  });

  it("ignores the second click on Reopen once nothing is running", () => {
    renderWithIntl(<HistoryList items={items} />);
    const [reopen] = screen.getAllByRole("button", { name: "Reopen" });
    fireEvent.click(reopen, { detail: 2 });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(reopen, { detail: 1 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  describe("when a delete fails", () => {
    it.each([
      ["one entry", () => screen.getAllByRole("button", { name: "Delete" })[0]],
    ])("asks for the page again after a 401 on %s", async (_case, button) => {
      del.mockResolvedValue({ error: { code: "42501" }, status: 401 });
      renderWithIntl(<HistoryList items={items} />);
      fireEvent.click(button(), { detail: 1 });
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("asks for the page again after a 401 on Delete all", async () => {
      delAll.mockResolvedValue({ error: { code: "42501" }, status: 401 });
      renderWithIntl(<HistoryList items={items} />);
      await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
      await userEvent.click(
        screen.getByRole("button", { name: "Yes, delete all" }),
      );
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });

    it.each([
      ["offline", 0],
      ["a server error", 500],
    ])("keeps the page when %s", async (_case, status) => {
      del.mockResolvedValue({ error: { code: "x" }, status });
      renderWithIntl(<HistoryList items={items} />);
      fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0], {
        detail: 1,
      });
      await screen.findByRole("alert");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  it("deletes from the keyboard, which reports no clicks", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0], {
      detail: 0,
    });
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  it("shows when an entry was written, with the zone of that time", () => {
    const first = renderWithIntl(<HistoryList items={[items[0]]} />);
    expect(first.container.querySelector("time")).toHaveTextContent(
      "Oct 1, 2026, 12:00 PM GMT+2",
    );
    first.unmount();
    const french = renderWithIntl(<HistoryList items={[items[0]]} />, "fr");
    expect(french.container.querySelector("time")).toHaveTextContent(
      "1 oct. 2026, 12:00 UTC+2",
    );
  });

  it("keeps the entry and says so when the delete fails", async () => {
    del.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete",
    );
    expect(screen.getByText("First text")).toBeInTheDocument();
  });

  it("is translated in French", () => {
    renderWithIntl(<HistoryList items={[]} />, "fr");
    expect(
      screen.getByText("Aucune réécriture pour le moment."),
    ).toBeInTheDocument();
  });

  it("finds entries by their text", async () => {
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.type(screen.getByRole("searchbox"), "second");
    expect(screen.queryByText("First text")).not.toBeInTheDocument();
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("reopens an entry in the editor with its edits", async () => {
    const edit = {
      id: "edit-0",
      original: "First",
      replacement: "1st",
      reason: "r",
      start: 0,
      end: 5,
    };
    renderWithIntl(<HistoryList items={[{ ...items[0], edits: [edit] }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(push).toHaveBeenCalledWith("/");
    const stashed = JSON.parse(sessionStorage.getItem("rewrity:reopen")!);
    expect(stashed).toMatchObject({ text: "First text", edits: [edit] });
  });

  it("asks twice before deleting everything", async () => {
    delAll.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(delAll).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(delAll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    await waitFor(() =>
      expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
    );
  });

  it("cannot confirm Delete all with a double click: Yes opens elsewhere", async () => {
    renderWithIntl(<HistoryList items={items} />);
    const button = screen.getByRole("button", { name: "Delete all" });
    await userEvent.dblClick(button);
    expect(screen.getByRole("button", { name: "Delete all" })).toBe(button);
    expect(delAll).not.toHaveBeenCalled();
  });

  it("says to everyone what Delete all covers, also during a search", async () => {
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.type(screen.getByRole("searchbox"), "First");
    expect(screen.queryByText("Second text")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    const question = screen.getByText(
      "Delete all 2 entries? This cannot be undone.",
    );
    expect(question.className).not.toContain("sr-only");
  });

  // The page loads the 50 most recent: "delete all" must reach the others too
  it("deletes every entry of the account, loaded or not", async () => {
    delAll.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} total={60} />);
    expect(screen.getByText("60 rewrites")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    await waitFor(() =>
      expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
    );
    expect(delAll).toHaveBeenCalledWith("id", "is", null);
    expect(del).not.toHaveBeenCalled();
    // The browser's copy of this page must not bring the rows back
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the list and says so when deleting everything fails", async () => {
    delAll.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList items={items} total={60} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete",
    );
    expect(screen.getByText("60 rewrites")).toBeInTheDocument();
    expect(screen.getByText("First text")).toBeInTheDocument();
  });

  it("says when older entries are not listed, and only then", () => {
    const { unmount } = renderWithIntl(
      <HistoryList items={items} total={60} />,
    );
    expect(
      screen.getByText(
        "Only your 2 most recent rewrites are listed and searched.",
      ),
    ).toBeInTheDocument();
    unmount();
    renderWithIntl(<HistoryList items={items} />);
    expect(screen.queryByText(/most recent/)).toBeNull();
  });

  it("asks the server for the list again after a delete", async () => {
    del.mockResolvedValue({ error: null });
    const { unmount } = renderWithIntl(
      <HistoryList items={items} total={60} />,
    );
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() =>
      expect(screen.getByText("59 rewrites")).toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();

    // Even with every entry loaded: the browser's copy of this page must not bring the row back
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() =>
      expect(screen.getByText("1 rewrite")).toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not ask for the list again when a delete fails", async () => {
    del.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes the new list from the server, and leaves the search as it is", async () => {
    const view = renderWithIntl(<HistoryList items={items} total={60} />);
    await userEvent.type(screen.getByRole("searchbox"), "text");
    expect(screen.getByText("First text")).toBeInTheDocument();

    view.rerender(<HistoryList items={[items[1]]} total={59} />);
    expect(screen.getByText("59 rewrites")).toBeInTheDocument();
    expect(screen.queryByText("First text")).toBeNull();
    expect(screen.getByText("Second text")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("text");
  });

  it("does not let Delete all overtake a delete still running", async () => {
    let finish: (value: { error: null }) => void = () => {};
    del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(
      screen.getByRole("button", { name: "Yes, delete all" }),
    ).toBeDisabled();
    finish({ error: null });
    await waitFor(() =>
      expect(screen.getByText("1 rewrite")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Yes, delete all" }),
    ).toBeEnabled();
  });

  it("never says the history is empty while older entries remain", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={[items[0]]} total={3} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(screen.getByText("2 rewrites")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No rewrites yet.")).toBeNull();
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it("words the confirmation for one entry and for several, in both languages", async () => {
    const { unmount } = renderWithIntl(<HistoryList items={[items[0]]} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(
      screen.getByText("Delete this entry? This cannot be undone."),
    ).toBeInTheDocument();
    unmount();

    const second = renderWithIntl(<HistoryList items={[items[0]]} />, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Tout supprimer" }),
    );
    expect(
      screen.getByText("Supprimer cette entrée ? Cette action est définitive."),
    ).toBeInTheDocument();
    second.unmount();

    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(
      screen.getByText("Delete all 2 entries? This cannot be undone."),
    ).toBeInTheDocument();
  });
});
