import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HistoryLoading from "@/app/[locale]/history/loading";
import HistoryPage from "@/app/[locale]/history/page";
import en from "../messages/en.json";
import { renderWithIntl } from "./render";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: keyof typeof en.History) =>
    en.History[key],
  setRequestLocale: () => {},
}));

// The list that is still being fetched
const waiting = new Promise(() => {});
vi.mock("@/components/history-content", () => ({
  HistoryContent: () => {
    throw waiting;
  },
}));

const pageWaiting = async () =>
  renderWithIntl(
    await HistoryPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    }),
  );

describe("while the history is on its way", () => {
  it("shows the title and a skeleton, in place of the list", async () => {
    const { container } = await pageWaiting();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "History",
    );
    expect(container.querySelector("[aria-busy]")).not.toBeNull();
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });

  // A list element would be counted as a row of the real list
  it("is not a list yet", async () => {
    const { container } = await pageWaiting();
    expect(container.querySelector("ul, li")).toBeNull();
  });

  // The click on History shows one, the page's first answer the other: nothing may jump between them
  it("looks the same before and after the page's first answer", async () => {
    const page = await pageWaiting();
    const loading = renderWithIntl(<HistoryLoading />);
    expect(loading.container.innerHTML).toBe(page.container.innerHTML);
  });

  it("has no main of its own: the layout holds it", () => {
    const { container } = renderWithIntl(<HistoryLoading />);
    expect(container.querySelector("main")).toBeNull();
  });

  // The list's toolbar wraps on a phone, in French first, as does the first line of a row, and a row
  // shows up to three lines of text
  it.each([
    ["en", "50 rewrites", "Delete all", "3 edits", "Reopen", "Delete"],
    [
      "fr",
      "50 réécritures",
      "Tout supprimer",
      "3 modifications",
      "Rouvrir",
      "Supprimer",
    ],
  ] as const)(
    "holds the toolbar's own words unseen, and a row's, with three lines of text for each row, in %s",
    (locale, count, clear, edits, reopen, remove) => {
      const { container } = renderWithIntl(<HistoryLoading />, locale);
      const unseen = (element: Element) =>
        [...element.querySelectorAll(".invisible")].map(
          (word) => word.textContent,
        );
      const [toolbar, list] = container.querySelector("[aria-busy]")!.children;
      expect(unseen(toolbar)).toEqual([count, clear]);
      expect(list.children).toHaveLength(3);
      for (const row of list.children) {
        const [when, ...buttons] = unseen(row);
        expect(when).toMatch(new RegExp(`2026.+ · ${edits}$`));
        expect(buttons).toEqual([reopen, remove]);
        const text = row.querySelector(".h-\\[3lh\\].leading-relaxed");
        expect(text?.querySelectorAll(".skeleton")).toHaveLength(3);
      }
    },
  );
});
