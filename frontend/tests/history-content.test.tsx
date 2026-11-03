import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryContent } from "@/components/history-content";
import en from "../messages/en.json";
import { renderWithIntl } from "./render";

const getClaims = vi.fn();
const select = vi.fn();
const limit = vi.fn();
let configured = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () =>
    configured
      ? {
          auth: { getClaims },
          from: () => ({
            select: (...args: unknown[]) => {
              select(...args);
              return { order: () => ({ limit }) };
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
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => null }));
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
  limit.mockReset();
});

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
  });

  it("says so when Supabase is not configured", async () => {
    configured = false;
    await show();
    expect(screen.getByText("History is not configured.")).toBeInTheDocument();
  });
});
