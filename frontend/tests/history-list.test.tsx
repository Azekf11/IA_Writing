import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "@/components/history-list";
import { renderWithIntl } from "./render";

const del = vi.fn();

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({ eq: (...args: unknown[]) => del(...args) }),
    }),
  }),
}));

const items = [
  {
    id: "a",
    original: "First text",
    editCount: 2,
    createdAt: "2026-10-01T10:00:00Z",
  },
  {
    id: "b",
    original: "Second text",
    editCount: 1,
    createdAt: "2026-10-02T10:00:00Z",
  },
];

beforeEach(() => del.mockReset());

describe("HistoryList", () => {
  it("shows each entry with its edit count", () => {
    renderWithIntl(<HistoryList items={items} />);
    expect(screen.getByText("First text")).toBeInTheDocument();
    expect(screen.getByText("2 edits")).toBeInTheDocument();
    expect(screen.getByText("1 edit")).toBeInTheDocument();
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
    expect(del).toHaveBeenCalledWith("id", "a");
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
});
