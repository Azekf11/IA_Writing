import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "@/components/history-list";
import { renderWithIntl } from "./render";

const del = vi.fn();
const push = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({ in: (...args: unknown[]) => del(...args) }),
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
  push.mockReset();
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
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(del).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    await waitFor(() =>
      expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
    );
    expect(del).toHaveBeenCalledWith("id", ["a", "b"]);
  });
});
