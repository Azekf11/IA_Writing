import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryContent } from "@/components/history-content";
import en from "../messages/en.json";
import { renderWithIntl } from "./render";

const getClaims = vi.fn();
const select = vi.fn();
const order = vi.fn();
const limit = vi.fn();
const del = vi.fn();
let configured = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    configured
      ? {
          auth: { getClaims },
          from: () => ({
            select: (...args: unknown[]) => {
              select(...args);
              const chain = {
                order: (...by: unknown[]) => (order(...by), chain),
                limit,
              };
              return chain;
            },
          }),
        }
      : null,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: keyof typeof en.History) =>
    en.History[key],
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => ({
      delete: () => ({
        in: (...id: unknown[]) => ({
          eq: (...owner: unknown[]) => del(...id, ...owner),
        }),
      }),
    }),
  }),
}));
vi.mock("@/components/auth-panel", () => ({ AuthPanel: () => null }));

const row = (id: string) => ({
  id,
  original: `Text ${id}`,
  edits: [],
  edit_count: 0,
  created_at: "2026-10-01T10:00:00Z",
});

const show = async () => renderWithIntl(await HistoryContent());

beforeEach(() => {
  configured = true;
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: "u" } } });
  select.mockReset();
  order.mockReset();
  limit.mockReset();
  del.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

describe("HistoryContent", () => {
  it("lists the most recent rows and counts all of them", async () => {
    limit.mockResolvedValue({
      data: [row("a"), row("b")],
      count: 60,
      error: null,
    });
    await show();
    expect(screen.getByText("Text a")).toBeInTheDocument();
    expect(screen.getByText("60 rewrites")).toBeInTheDocument();
    expect(select).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
    expect(limit).toHaveBeenCalledWith(50);
  });

  it("orders the rows so that the same place in the list is always the same row", async () => {
    limit.mockResolvedValue({ data: [row("a")], count: 1, error: null });
    await show();
    expect(order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("tells the list whose rows these are, from the verified session", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "from-claims" } } });
    limit.mockResolvedValue({ data: [row("a")], count: 1, error: null });
    await show();
    await userEvent.click(
      screen.getByRole("button", { name: /^Delete the rewrite of/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("id", ["a"], "user_id", "from-claims"),
    );
  });

  it("offers the account's actions under the list, and asks for the account the session named", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "from-claims" } } });
    limit.mockResolvedValue({ data: [row("a")], count: 1, error: null });
    const fetchMock = vi.fn().mockResolvedValue({ status: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await show();
    expect(
      screen.getByRole("button", { name: "Download my history" }),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete my account" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete my account" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      account: "from-claims",
    });
  });

  it("still lets someone with no rewrite leave, with nothing to download", async () => {
    limit.mockResolvedValue({ data: [], count: 0, error: null });
    await show();
    expect(screen.getByText("No rewrites yet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete my account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Download my history" }),
    ).toBeNull();
  });

  it("offers nothing when the read failed", async () => {
    limit.mockResolvedValue({
      data: null,
      count: null,
      error: { code: "XX000" },
    });
    await show();
    expect(
      screen.queryByRole("button", { name: "Delete my account" }),
    ).toBeNull();
  });

  it("does not make a failed read look like an empty history", async () => {
    limit.mockResolvedValue({
      data: null,
      count: null,
      error: { code: "XX000" },
    });
    await show();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load your history.",
    );
    expect(screen.queryByText("No rewrites yet.")).toBeNull();
  });

  it("shows the empty state when there really is nothing", async () => {
    limit.mockResolvedValue({ data: [], count: 0, error: null });
    await show();
    expect(screen.getByText("No rewrites yet.")).toBeInTheDocument();
  });

  it("asks a visitor to sign in, and reads nothing", async () => {
    getClaims.mockResolvedValue({ data: null });
    await show();
    expect(
      screen.getByText("Sign in to see your history."),
    ).toBeInTheDocument();
    expect(select).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Delete my account" }),
    ).toBeNull();
  });

  it("says so when Supabase is not configured", async () => {
    configured = false;
    await show();
    expect(screen.getByText("History is not configured.")).toBeInTheDocument();
  });
});
