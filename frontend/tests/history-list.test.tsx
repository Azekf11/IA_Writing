import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryList } from "@/components/history-list";
import { hydrateAfter, renderWithIntl } from "./render";

const del = vi.fn();
const delAll = vi.fn();
// What each delete asked for besides its filters
const deletes: unknown[][] = [];
const push = vi.fn();
const refresh = vi.fn();
// The steps of a Load more, in order, and the answer it ends on
const older = { steps: [] as unknown[][], answer: vi.fn() };

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    from: () => ({
      delete: (...options: unknown[]) => (
        deletes.push(options),
        {
          in: (...args: unknown[]) => ({
            eq: (...owner: unknown[]) => del(...args, ...owner),
          }),
          eq: (...args: unknown[]) => delAll(...args),
        }
      ),
      select: (...select: unknown[]) => {
        older.steps.push(["select", ...select]);
        const chain = {
          eq: (...args: unknown[]) => (
            older.steps.push(["eq", ...args]),
            chain
          ),
          or: (...args: unknown[]) => (
            older.steps.push(["or", ...args]),
            chain
          ),
          order: (...args: unknown[]) => (
            older.steps.push(["order", ...args]),
            chain
          ),
          limit: (...args: unknown[]) => {
            older.steps.push(["limit", ...args]);
            return older.answer();
          },
        };
        return chain;
      },
    }),
  }),
}));

const OWNER = "owner-1";

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

// A row as the database gives it, for a Load more
const stored = (id: string, createdAt: string, original = `Text ${id}`) => ({
  id,
  original,
  edits: [],
  edit_count: 0,
  created_at: createdAt,
});

const deleteButtons = () =>
  screen.getAllByRole("button", { name: /^Delete the rewrite of/ });
const reopenButtons = () =>
  screen.getAllByRole("button", { name: /^Reopen the rewrite of/ });
const yes = () => screen.getByRole("button", { name: "Yes, delete" });
const cancel = () => screen.getByRole("button", { name: "Cancel" });
const loadMore = () => screen.getByRole("button", { name: "Load more" });
const confirmDelete = async (row = 0) => {
  await userEvent.click(deleteButtons()[row]);
  await userEvent.click(yes());
};

beforeEach(() => {
  del.mockReset();
  delAll.mockReset();
  deletes.length = 0;
  push.mockReset();
  refresh.mockReset();
  older.steps.length = 0;
  older.answer.mockReset();
  sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("HistoryList", () => {
  it("shows each entry with its edit count", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    expect(screen.getByText("First text")).toBeInTheDocument();
    expect(screen.getByText(/2 edits/)).toBeInTheDocument();
    expect(screen.getByText(/ 1 edit$/)).toBeInTheDocument();
  });

  it("shows a helpful empty state", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={[]} />);
    expect(screen.getByText("No rewrites yet.")).toBeInTheDocument();
    expect(screen.getByText(/will show up here/)).toBeInTheDocument();
  });

  it("removes an entry once the delete succeeds", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await confirmDelete();
    await waitFor(() =>
      expect(screen.queryByText("First text")).not.toBeInTheDocument(),
    );
    expect(del).toHaveBeenCalledWith("id", ["a"], "user_id", OWNER);
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  it("deletes nothing on the first click: it asks on the row's own line", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(deleteButtons()[1]);
    expect(del).not.toHaveBeenCalled();
    const row = screen.getByText("Second text").closest("li")!;
    expect(
      within(row).getByText("Delete this entry? This cannot be undone."),
    ).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Yes, delete" })).toBe(
      yes(),
    );
    const other = screen.getByText("First text").closest("li")!;
    expect(within(other).queryByRole("button", { name: "Yes, delete" })).toBe(
      null,
    );
  });

  it("deletes nothing on Cancel, and the keyboard goes back to the row's Delete", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(deleteButtons()[1]);
    await userEvent.click(cancel());
    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Yes, delete" })).toBeNull();
    expect(deleteButtons()[1]).toHaveFocus();
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  it("keeps one question open at a time", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(deleteButtons()[0]);
    await userEvent.click(deleteButtons()[1]);
    expect(screen.getAllByRole("button", { name: "Yes, delete" })).toHaveLength(
      1,
    );
    const row = screen.getByText("Second text").closest("li")!;
    expect(within(row).getByRole("button", { name: "Yes, delete" })).toBe(
      yes(),
    );
  });

  it("cannot be confirmed with a double click on Delete", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.dblClick(deleteButtons()[0]);
    expect(del).not.toHaveBeenCalled();
    // Still the row's question, on a line of its own under the button
    expect(yes()).not.toBe(deleteButtons()[0]);
  });

  // Opening a row's question closes another one's, so the list moves under the pointer
  it("does not take the second click of a double click as an answer", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    fireEvent.click(deleteButtons()[0], { detail: 1 });
    fireEvent.click(yes(), { detail: 2 });
    // A delete marks the buttons at once; its request only leaves once a script has been fetched
    expect(yes()).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(cancel(), { detail: 2 });
    expect(yes()).toBeInTheDocument();
  });

  // The list closes up after a delete, so the next row's button comes under the pointer
  it("deletes one entry on a double click, not two", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    fireEvent.click(deleteButtons()[0], { detail: 1 });
    fireEvent.click(yes(), { detail: 1 });
    await waitFor(() =>
      expect(screen.queryByText("First text")).not.toBeInTheDocument(),
    );
    fireEvent.click(deleteButtons()[0], { detail: 2 });
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Yes, delete" })).toBeNull();
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  // The browser sends whichever session its cookie holds now: only the page knows whose rows it shows
  it("names the account the page was rendered for on every delete", async () => {
    del.mockResolvedValue({ error: null });
    delAll.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner="someone" items={items} />);
    await confirmDelete();
    expect(del).toHaveBeenCalledExactlyOnceWith(
      "id",
      ["a"],
      "user_id",
      "someone",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    await waitFor(() =>
      expect(delAll).toHaveBeenCalledExactlyOnceWith("user_id", "someone"),
    );
  });

  it("names the row's date on each button, in both languages", () => {
    const first = renderWithIntl(
      <HistoryList owner={OWNER} items={[items[0]]} />,
    );
    expect(
      screen.getByRole("button", {
        name: "Delete the rewrite of Oct 1, 2026, 12:00 PM GMT+2",
      }),
    ).toHaveTextContent("Delete");
    expect(
      screen.getByRole("button", {
        name: "Reopen the rewrite of Oct 1, 2026, 12:00 PM GMT+2",
      }),
    ).toHaveTextContent("Reopen");
    first.unmount();
    renderWithIntl(<HistoryList owner={OWNER} items={[items[0]]} />, "fr");
    expect(
      screen.getByRole("button", {
        name: "Supprimer la réécriture du 1 oct. 2026, 12:00 UTC+2",
      }),
    ).toHaveTextContent("Supprimer");
    expect(
      screen.getByRole("button", {
        name: "Rouvrir la réécriture du 1 oct. 2026, 12:00 UTC+2",
      }),
    ).toHaveTextContent("Rouvrir");
  });

  // The question's line closes, so the first row's Reopen comes under the pointer
  it("does not reopen on the second click of a double click on Yes", async () => {
    let finish: (value: { error: null }) => void = () => {};
    delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete all" }));
    const [reopen] = reopenButtons();
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
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    deleteButtons()[0].focus();
    await userEvent.keyboard("{Enter}");
    expect(del).not.toHaveBeenCalled();
    // The answer is the next stop on the way down
    await userEvent.tab();
    const button = yes();
    expect(button).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-disabled", "true");
    // Still running: nothing starts twice, from this row or another one
    await userEvent.keyboard("{Enter}");
    fireEvent.click(deleteButtons()[1], { detail: 1 });
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
      <HistoryList owner={OWNER} items={items} />,
    );
    await waitFor(() => expect(screen.queryByText("First text")).toBeNull());
    expect(screen.getByText("Second text")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("second");
  });

  it("ignores the second click on Reopen once nothing is running", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    const [reopen] = reopenButtons();
    fireEvent.click(reopen, { detail: 2 });
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(reopen, { detail: 1 });
    expect(push).toHaveBeenCalledTimes(1);
  });

  describe("when a delete fails", () => {
    it("asks for the page again after a 401 on one entry", async () => {
      del.mockResolvedValue({ error: { code: "42501" }, status: 401 });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await confirmDelete();
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    it("asks for the page again after a 401 on Delete all", async () => {
      delAll.mockResolvedValue({ error: { code: "42501" }, status: 401 });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
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
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await confirmDelete();
      await screen.findByRole("alert");
      expect(refresh).not.toHaveBeenCalled();
    });
  });

  // A tab left open on one account while the cookie became another's: the filter on the owner
  // keeps the other account's rows safe, so nothing matches, and the page must not look as if it
  // had deleted anything
  describe("a delete that matches no row", () => {
    const stale = { error: null, status: 204, count: 0 };
    const deleteAll = async (locale: "en" | "fr" = "en") => {
      const [ask, yes] =
        locale === "en"
          ? ["Delete all", "Yes, delete all"]
          : ["Tout supprimer", "Oui, tout supprimer"];
      await userEvent.click(screen.getByRole("button", { name: ask }));
      await userEvent.click(screen.getByRole("button", { name: yes }));
    };

    it("is told by the count of the rows that went", async () => {
      del.mockResolvedValue({ error: null, status: 204, count: 1 });
      delAll.mockResolvedValue({ error: null, status: 204, count: 1 });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await confirmDelete();
      await waitFor(() =>
        expect(screen.getByText("1 rewrite")).toBeInTheDocument(),
      );
      await deleteAll();
      await waitFor(() =>
        expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
      );
      expect(deletes).toEqual([[{ count: "exact" }], [{ count: "exact" }]]);
    });

    it("keeps the row, says on it that the page is out of date, and asks for no list", async () => {
      del.mockResolvedValue(stale);
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await confirmDelete();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "This page is out of date, so nothing was deleted. Reload the page.",
      );
      expect(screen.getByText("First text").closest("li")).toContainElement(
        alert,
      );
      expect(screen.getByText("2 rewrites")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });

    // Pressing it again would reach the account signed in now, whose rows this page does not show
    it("says so for Delete all, without asking to try again", async () => {
      delAll.mockResolvedValue(stale);
      renderWithIntl(<HistoryList owner={OWNER} items={items} total={60} />);
      await deleteAll();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("nothing was deleted");
      expect(alert).not.toHaveTextContent(/try again/i);
      expect(screen.getByText("60 rewrites")).toBeInTheDocument();
      expect(screen.getByText("First text")).toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("says it in French", async () => {
      delAll.mockResolvedValue(stale);
      renderWithIntl(<HistoryList owner={OWNER} items={items} />, "fr");
      await deleteAll("fr");
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Cette page n'est plus à jour : rien n'a été supprimé. Rechargez la page.",
      );
    });
  });

  it("deletes from the keyboard, which reports no clicks", async () => {
    del.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    fireEvent.click(deleteButtons()[0], { detail: 0 });
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(yes(), { detail: 0 });
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
  });

  it("shows when an entry was written, with the zone of that time", () => {
    const first = renderWithIntl(
      <HistoryList owner={OWNER} items={[items[0]]} />,
    );
    expect(first.container.querySelector("time")).toHaveTextContent(
      "Oct 1, 2026, 12:00 PM GMT+2",
    );
    first.unmount();
    const french = renderWithIntl(
      <HistoryList owner={OWNER} items={[items[0]]} />,
      "fr",
    );
    expect(french.container.querySelector("time")).toHaveTextContent(
      "1 oct. 2026, 12:00 UTC+2",
    );
  });

  it("keeps the entry and says so when the delete fails", async () => {
    del.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await confirmDelete();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not delete this entry");
    expect(screen.getByText("First text")).toBeInTheDocument();
    // On the row itself: the list can be long, and the top of it out of sight
    expect(screen.getByText("First text").closest("li")).toContainElement(
      alert,
    );
  });

  it("is translated in French", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={[]} />, "fr");
    expect(
      screen.getByText("Aucune réécriture pour le moment."),
    ).toBeInTheDocument();
  });

  it("finds entries by their text", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.type(screen.getByRole("searchbox"), "second");
    expect(screen.queryByText("First text")).not.toBeInTheDocument();
    expect(screen.getByText("Second text")).toBeInTheDocument();
  });

  describe("search in French text", () => {
    const entry = (original: string, id = "x") => ({
      ...items[0],
      id,
      original,
    });

    it.each([
      ["the accents a reader did not type", "reecriture", "Une réécriture"],
      ["a capital with an accent", "a propos", "À propos du projet"],
      ["accents typed where the text has none", "école", "Une ecole"],
      ["a curly apostrophe", "l'ete", "Pendant l\u2019été"],
      ["a typed curly apostrophe", "l\u2019ete", "Pendant l'été"],
      ["a ligature", "coeur", "Au cœur du sujet"],
      ["a capital ligature", "oeuvre", "UNE ŒUVRE"],
      ["a typed capital ligature", "CŒUR", "au coeur"],
      ["the other ligature", "aeternam", "Requiem æternam"],
      ["its capital", "aeternam", "REQUIEM ÆTERNAM"],
      ["a no-break space", "prix : 3", "Prix\u00a0: 3"],
      ["a narrow no-break space", "prix : 3", "Prix\u202f: 3"],
      [
        "accents written as separate marks",
        "reecriture",
        "re\u0301e\u0301criture",
      ],
      [
        "a phrase across a line break",
        "premier paragraphe",
        "Le premier\nparagraphe",
      ],
      ["a phrase with a double space", "deux espaces", "Deux  espaces"],
      ["a ligature pasted from a PDF", "efficace", "Un texte e\ufb03cace"],
    ])("finds %s", async (_case, query, text) => {
      renderWithIntl(
        <HistoryList
          owner={OWNER}
          items={[entry(text), entry("Autre", "y")]}
        />,
      );
      await userEvent.type(screen.getByRole("searchbox"), query);
      expect(document.querySelector("li p")?.textContent).toBe(text);
      expect(screen.queryByText("Autre")).toBeNull();
    });

    it("does not make a word match another one", async () => {
      renderWithIntl(
        <HistoryList owner={OWNER} items={[entry("Une école")]} />,
      );
      await userEvent.type(screen.getByRole("searchbox"), "ecoles");
      expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    });
  });

  describe("what a search says to a screen reader", () => {
    const status = () => screen.getByRole("status");

    it("has its line on the page before there is anything to say", () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      expect(status()).toHaveTextContent(/^$/);
    });

    it("counts what matches, as the reader types and clears", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      const box = screen.getByRole("searchbox");
      await userEvent.type(box, "text");
      expect(status()).toHaveTextContent(/^2 matches$/);
      await userEvent.type(box, " f");
      expect(status()).toHaveTextContent(/^No matches$/);
      await userEvent.clear(box);
      await userEvent.type(box, "first");
      expect(status()).toHaveTextContent(/^1 match$/);
      await userEvent.clear(box);
      expect(status()).toHaveTextContent(/^$/);
    });

    it("counts in French", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />, "fr");
      const box = screen.getByRole("searchbox");
      await userEvent.type(box, "text");
      expect(status()).toHaveTextContent(/^2 résultats$/);
      await userEvent.type(box, " zz");
      expect(status()).toHaveTextContent(/^Aucun résultat$/);
    });

    it("says a row's question while it is open", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteButtons()[0]);
      expect(status()).toHaveTextContent(
        "Delete this entry? This cannot be undone.",
      );
      await userEvent.click(cancel());
      expect(status()).toHaveTextContent(/^$/);
    });

    it("does not say a question whose row a search has hidden", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteButtons()[0]);
      await userEvent.type(screen.getByRole("searchbox"), "second");
      expect(status()).toHaveTextContent(/^1 match$/);
    });
  });

  describe("what a delete says to a screen reader, and where the keyboard goes", () => {
    const status = () => screen.getByRole("status");
    const deleteAll = () => screen.getByRole("button", { name: "Delete all" });
    const yesAll = () =>
      screen.getByRole("button", { name: "Yes, delete all" });
    const three = [
      ...items,
      {
        ...items[1],
        id: "c",
        original: "Third text",
        createdAt: "2026-10-03T10:00:00Z",
      },
    ];

    // Many screen readers do not announce a line that arrives together with its text
    it("says Delete all's question on the one line that was on the page before it asks", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      const line = status();
      expect(line).toHaveTextContent(/^$/);
      await userEvent.click(deleteAll());
      expect(screen.getAllByRole("status")).toEqual([line]);
      expect(line).toHaveTextContent(
        /^Delete all 2 entries\? This cannot be undone\.$/,
      );
      await userEvent.click(cancel());
      expect(line).toHaveTextContent(/^$/);
    });

    it("says that an entry was deleted", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      const line = status();
      await confirmDelete();
      await waitFor(() => expect(line).toHaveTextContent(/^Entry deleted\.$/));
    });

    it("says that the history was deleted, on a line that stays when the list goes", async () => {
      delAll.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      const line = status();
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      await screen.findByText("No rewrites yet.");
      expect(status()).toBe(line);
      expect(line).toHaveTextContent(/^Your history was deleted\.$/);
    });

    it("says both in French", async () => {
      del.mockResolvedValue({ error: null });
      delAll.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />, "fr");
      await userEvent.click(
        screen.getAllByRole("button", {
          name: /^Supprimer la réécriture du/,
        })[0],
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Oui, supprimer" }),
      );
      await waitFor(() =>
        expect(status()).toHaveTextContent(/^Entrée supprimée\.$/),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Tout supprimer" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Oui, tout supprimer" }),
      );
      await waitFor(() =>
        expect(status()).toHaveTextContent(
          /^Votre historique a été supprimé\.$/,
        ),
      );
    });

    it("counts the matches again once the reader searches after a delete", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete();
      await waitFor(() => expect(status()).toHaveTextContent("Entry deleted."));
      await userEvent.type(screen.getByRole("searchbox"), "text");
      expect(status()).toHaveTextContent(/^2 matches$/);
    });

    it("takes the keyboard to the next row once an entry is deleted", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete(0);
      await waitFor(() => expect(reopenButtons()[0]).toHaveFocus());
      expect(reopenButtons()[0]).toHaveAccessibleName(/ Oct 2, /);
    });

    // A held key repeats, and each repeat of Enter on a button is another click, on whatever holds
    // the focus by then
    it("does not reopen the next row on a held Enter", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await userEvent.click(deleteButtons()[0]);
      yes().focus();
      await userEvent.keyboard("{Enter>8/}");
      await waitFor(() => expect(reopenButtons()[0]).toHaveFocus());
      expect(del).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      expect(sessionStorage.length).toBe(0);
      // A new press is the reader's own
      await userEvent.keyboard("{Enter}");
      expect(push).toHaveBeenCalledExactlyOnceWith("/");
    });

    it("to the row before when the last row goes", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete(2);
      await waitFor(() => expect(reopenButtons()[1]).toHaveFocus());
      expect(reopenButtons()[1]).toHaveAccessibleName(/ Oct 2, /);
    });

    it("to the search box when a search showed that row alone", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await userEvent.type(screen.getByRole("searchbox"), "first");
      await confirmDelete(0);
      await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());
    });

    it("to the empty history when the last entry goes", async () => {
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={[items[0]]} />);
      await confirmDelete();
      await waitFor(() =>
        expect(screen.getByText("No rewrites yet.")).toHaveFocus(),
      );
    });

    // A slow answer: the next row's Reopen would take the rest of the typing, and a space opens it
    it("leaves it where the reader has put it while the delete ran", async () => {
      let finish: (value: unknown) => void = () => {};
      del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete(0);
      const box = screen.getByRole("searchbox");
      await userEvent.type(box, "te");
      finish({ error: null });
      await waitFor(() => expect(status()).toHaveTextContent("Entry deleted."));
      expect(box).toHaveFocus();
      await userEvent.keyboard(" my");
      expect(box).toHaveValue("te my");
      expect(push).not.toHaveBeenCalled();
    });

    // A click on text takes the focus off Yes and leaves it on the page, where a space scrolls: it
    // must not land on the next row's Reopen and open it
    it("leaves it on the page after a click on a row's text while the delete ran", async () => {
      let finish: (value: unknown) => void = () => {};
      del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete(0);
      await userEvent.click(screen.getByText("Second text"));
      expect(document.body).toHaveFocus();
      finish({ error: null });
      await waitFor(() => expect(status()).toHaveTextContent("Entry deleted."));
      await userEvent.keyboard(" ");
      expect(document.body).toHaveFocus();
      expect(push).not.toHaveBeenCalled();
    });

    // A press on the page's scrollbar reaches the page, and leaves the focus on Yes
    it("takes it to the next row after a press that moves no focus while the delete ran", async () => {
      let finish: (value: unknown) => void = () => {};
      del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await confirmDelete(0);
      const button = yes();
      fireEvent.mouseDown(document.documentElement);
      expect(button).toHaveFocus();
      finish({ error: null });
      await waitFor(() => expect(reopenButtons()[0]).toHaveFocus());
      expect(reopenButtons()[0]).toHaveAccessibleName(/ Oct 2, /);
    });

    // Safari does not give the focus to a button that is clicked: it stays on the page while the
    // delete runs, with Yes still there, and the presses came before the delete
    it("takes it to the next row after clicks that focus nothing", async () => {
      let finish: (value: unknown) => void = () => {};
      del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      const click = (button: HTMLElement) => {
        fireEvent.mouseDown(button);
        fireEvent.mouseUp(button);
        fireEvent.click(button, { detail: 1 });
      };
      click(deleteButtons()[0]);
      click(yes());
      await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
      expect(document.body).toHaveFocus();
      finish({ error: null });
      await waitFor(() => expect(reopenButtons()[0]).toHaveFocus());
      expect(reopenButtons()[0]).toHaveAccessibleName(/ Oct 2, /);
    });

    // A new list from the server can come first and no longer hold the row: Yes goes with it, and
    // the focus falls to the page with nothing pressed
    it("takes it to the next row when the server's new list took the row first", async () => {
      let finish: (value: unknown) => void = () => {};
      del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const view = renderWithIntl(<HistoryList owner={OWNER} items={three} />);
      await userEvent.click(deleteButtons()[0]);
      yes().focus();
      await userEvent.keyboard("{Enter}");
      view.rerender(<HistoryList owner={OWNER} items={three.slice(1)} />);
      expect(document.body).toHaveFocus();
      finish({ error: null });
      await waitFor(() => expect(reopenButtons()[0]).toHaveFocus());
      expect(reopenButtons()[0]).toHaveAccessibleName(/ Oct 2, /);
    });

    it("brings the keyboard back to Delete all on Cancel", async () => {
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(cancel());
      expect(deleteAll()).toHaveFocus();
    });

    it("keeps the keyboard on Delete all while everything goes, then on the empty history", async () => {
      let finish: (value: unknown) => void = () => {};
      delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      expect(deleteAll()).toHaveFocus();
      finish({ error: null });
      await waitFor(() =>
        expect(screen.getByText("No rewrites yet.")).toHaveFocus(),
      );
    });

    it("leaves it on the page after a click on a row's text while everything went", async () => {
      let finish: (value: unknown) => void = () => {};
      delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      await userEvent.click(screen.getByText("Second text"));
      expect(document.body).toHaveFocus();
      finish({ error: null });
      await waitFor(() =>
        expect(status()).toHaveTextContent("Your history was deleted."),
      );
      expect(document.body).toHaveFocus();
    });

    // A press on the page's scrollbar reaches the page, and leaves the focus on Delete all
    it("takes it to the empty history after a press that moves no focus while everything went", async () => {
      let finish: (value: unknown) => void = () => {};
      delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      const button = deleteAll();
      fireEvent.mouseDown(document.documentElement);
      expect(button).toHaveFocus();
      finish({ error: null });
      await waitFor(() =>
        expect(screen.getByText("No rewrites yet.")).toHaveFocus(),
      );
    });

    // A new list from the server can come first and be empty: Delete all goes with the toolbar, and
    // the focus falls to the page with nothing pressed
    it("takes it to the empty history when the server's new list emptied it first", async () => {
      let finish: (value: unknown) => void = () => {};
      delAll.mockReturnValue(new Promise((resolve) => (finish = resolve)));
      const view = renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      view.rerender(<HistoryList owner={OWNER} items={[]} total={0} />);
      expect(document.body).toHaveFocus();
      finish({ error: null });
      await waitFor(() =>
        expect(screen.getByText("No rewrites yet.")).toHaveFocus(),
      );
    });

    it("leaves it on Delete all when deleting everything fails", async () => {
      delAll.mockResolvedValue({ error: { code: "500" }, status: 500 });
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      await userEvent.click(deleteAll());
      await userEvent.click(yesAll());
      await screen.findByRole("alert");
      expect(deleteAll()).toHaveFocus();
    });
  });

  it("keeps iOS from zooming on the search box, whose placeholder is its only label", () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    const box = screen.getByRole("searchbox");
    expect(box).toHaveClass("max-sm:text-base", "placeholder:text-muted");
    expect(box.className).not.toContain("placeholder:text-muted/70");
  });

  it("says so when nothing matches", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
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
    renderWithIntl(
      <HistoryList owner={OWNER} items={[{ ...items[0], edits: [edit] }]} />,
    );
    await userEvent.click(reopenButtons()[0]);
    expect(push).toHaveBeenCalledWith("/");
    const stashed = JSON.parse(sessionStorage.getItem("rewrity:reopen")!);
    expect(stashed).toMatchObject({ text: "First text", edits: [edit] });
  });

  describe("when the rewrite cannot be handed to the editor", () => {
    const blocked = () =>
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });

    it.each([
      ["en", "Could not reopen", /^Reopen the rewrite of/],
      ["fr", "Impossible de rouvrir", /^Rouvrir la réécriture du/],
    ] as const)(
      "stays on the page and says so, in %s",
      async (locale, words, name) => {
        const storage = blocked();
        renderWithIntl(<HistoryList owner={OWNER} items={items} />, locale);
        await userEvent.click(screen.getAllByRole("button", { name })[0]);
        expect(screen.getByRole("alert")).toHaveTextContent(words);
        expect(push).not.toHaveBeenCalled();
        storage.mockRestore();
      },
    );

    it("takes the message back when another try works", async () => {
      const storage = blocked();
      renderWithIntl(<HistoryList owner={OWNER} items={items} />);
      const [reopen] = reopenButtons();
      await userEvent.click(reopen);
      expect(screen.getByRole("alert")).toBeInTheDocument();
      storage.mockRestore();
      await userEvent.click(reopen);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(push).toHaveBeenCalledTimes(1);
    });
  });

  it("asks twice before deleting everything", async () => {
    delAll.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
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
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    const button = screen.getByRole("button", { name: "Delete all" });
    await userEvent.dblClick(button);
    expect(screen.getByRole("button", { name: "Delete all" })).toBe(button);
    expect(delAll).not.toHaveBeenCalled();
  });

  it("says to everyone what Delete all covers, also during a search", async () => {
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.type(screen.getByRole("searchbox"), "First");
    expect(screen.queryByText("Second text")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    // On its own line for the eye, and on the status line for a screen reader
    const question = within(
      screen.getByRole("group", { name: "Delete all" }),
    ).getByText("Delete all 2 entries? This cannot be undone.");
    expect(question.className).not.toContain("sr-only");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Delete all 2 entries? This cannot be undone.",
    );
  });

  // The page loads the 50 most recent: "delete all" must reach the others too
  it("deletes every entry of the account, loaded or not", async () => {
    delAll.mockResolvedValue({ error: null });
    renderWithIntl(<HistoryList owner={OWNER} items={items} total={60} />);
    expect(screen.getByText("60 rewrites")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    await waitFor(() =>
      expect(screen.getByText("No rewrites yet.")).toBeInTheDocument(),
    );
    expect(delAll).toHaveBeenCalledWith("user_id", OWNER);
    expect(del).not.toHaveBeenCalled();
    // The browser's copy of this page must not bring the rows back
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the list and says so when deleting everything fails", async () => {
    delAll.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList owner={OWNER} items={items} total={60} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Yes, delete all" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete your history",
    );
    expect(screen.getByText("60 rewrites")).toBeInTheDocument();
    expect(screen.getByText("First text")).toBeInTheDocument();
  });

  it("says in French that the whole history could not be deleted", async () => {
    delAll.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Tout supprimer" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Oui, tout supprimer" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible de supprimer votre historique",
    );
  });

  it("says when older entries are not listed, and only then", () => {
    const { unmount } = renderWithIntl(
      <HistoryList owner={OWNER} items={items} total={60} />,
    );
    expect(
      screen.getByText(
        "Your 2 most recent rewrites are listed. Search covers these only: load more to reach older ones.",
      ),
    ).toBeInTheDocument();
    unmount();
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    expect(screen.queryByText(/most recent/)).toBeNull();
  });

  it("asks the server for the list again after a delete", async () => {
    del.mockResolvedValue({ error: null });
    const { unmount } = renderWithIntl(
      <HistoryList owner={OWNER} items={items} total={60} />,
    );
    await confirmDelete();
    await waitFor(() =>
      expect(screen.getByText("59 rewrites")).toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();

    // Even with every entry loaded: the browser's copy of this page must not bring the row back
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await confirmDelete();
    await waitFor(() =>
      expect(screen.getByText("1 rewrite")).toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not ask for the list again when a delete fails", async () => {
    del.mockResolvedValue({ error: { code: "42501" } });
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await confirmDelete();
    await screen.findByRole("alert");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes the new list from the server, and leaves the search as it is", async () => {
    const view = renderWithIntl(
      <HistoryList owner={OWNER} items={items} total={60} />,
    );
    await userEvent.type(screen.getByRole("searchbox"), "text");
    expect(screen.getByText("First text")).toBeInTheDocument();

    view.rerender(<HistoryList owner={OWNER} items={[items[1]]} total={59} />);
    expect(screen.getByText("59 rewrites")).toBeInTheDocument();
    expect(screen.queryByText("First text")).toBeNull();
    expect(screen.getByText("Second text")).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("text");
  });

  it("does not let Delete all overtake a delete still running", async () => {
    let finish: (value: { error: null }) => void = () => {};
    del.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    await confirmDelete();
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
    renderWithIntl(<HistoryList owner={OWNER} items={[items[0]]} total={3} />);
    await confirmDelete();
    await waitFor(() =>
      expect(screen.getByText("2 rewrites")).toBeInTheDocument(),
    );
    expect(screen.queryByText("No rewrites yet.")).toBeNull();
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  describe("older entries", () => {
    // The microseconds are the point: a Date would drop them
    const LAST = "2026-10-01T10:00:00.123456+00:00";
    const page = (count: number, start = 0) =>
      Array.from({ length: count }, (_, i) =>
        stored(
          `row-${start + i}`,
          `2026-09-01T10:00:${String(i).padStart(2, "0")}Z`,
        ),
      );
    const first = [
      items[0],
      { ...items[1], id: "b", createdAt: LAST, original: "Last of the page" },
    ];
    const entries = () =>
      screen.getAllByRole("listitem").map((row) => row.textContent);

    it("offers more only when the account holds more", () => {
      const { unmount } = renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={5} />,
      );
      expect(loadMore()).toBeInTheDocument();
      unmount();
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={2} />);
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    it("asks for what comes after the last row, by the account and the date as stored", async () => {
      older.answer.mockResolvedValue({ data: page(1), error: null });
      renderWithIntl(<HistoryList owner="someone" items={first} total={3} />);
      await userEvent.click(loadMore());
      await screen.findByText("Text row-0");
      expect(older.steps).toEqual([
        ["select", "id, original, edits, edit_count, created_at"],
        ["eq", "user_id", "someone"],
        ["or", `created_at.lt."${LAST}",and(created_at.eq."${LAST}",id.lt.b)`],
        ["order", "created_at", { ascending: false }],
        ["order", "id", { ascending: false }],
        ["limit", 50],
      ]);
    });

    it("adds them after the others, with their dates and their Reopen", async () => {
      older.answer.mockResolvedValue({
        data: [
          stored("c", "2026-09-30T10:00:00Z", "Older one"),
          stored("d", "2026-09-29T10:00:00Z", "Oldest one"),
        ],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={4} />);
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      expect(entries()).toHaveLength(4);
      expect(entries()[3]).toContain("Oldest one");
      expect(
        screen.getByRole("button", { name: /^Reopen the rewrite of Sep 29/ }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      expect(screen.queryByText(/most recent/)).toBeNull();
    });

    it("keeps offering more until the last page, which is short", async () => {
      older.answer
        .mockResolvedValueOnce({ data: page(50), error: null })
        .mockResolvedValueOnce({ data: page(1, 50), error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={53} />);
      await userEvent.click(loadMore());
      await screen.findByText("Text row-49");
      expect(loadMore()).toBeInTheDocument();
      expect(screen.getByText("53 rewrites")).toBeInTheDocument();
      await userEvent.click(loadMore());
      await screen.findByText("Text row-50");
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
      expect(entries()).toHaveLength(53);
    });

    it("corrects the count when a short page ends the list early", async () => {
      older.answer.mockResolvedValue({ data: page(1), error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={9} />);
      await userEvent.click(loadMore());
      await screen.findByText("Text row-0");
      expect(screen.getByText("3 rewrites")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    });

    it("follows the session when nothing comes where the count promised more", async () => {
      older.answer.mockResolvedValue({ data: [], error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.click(loadMore());
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(screen.getByText("2 rewrites")).toBeInTheDocument();
    });

    it("keeps what was loaded through a new answer from the server", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      del.mockResolvedValue({ error: null });
      const view = renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={3} />,
      );
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      await confirmDelete();
      await waitFor(() => expect(entries()).toHaveLength(2));
      view.rerender(<HistoryList owner={OWNER} items={[first[1]]} total={2} />);
      expect(screen.getByText("Older one")).toBeInTheDocument();
      expect(screen.getByText("Last of the page")).toBeInTheDocument();
      expect(screen.getByText("2 rewrites")).toBeInTheDocument();
    });

    it("drops what the server's page has taken over", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      const view = renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={3} />,
      );
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      // A row went, and the next one moved up into the first page
      view.rerender(
        <HistoryList
          owner={OWNER}
          items={[
            first[1],
            {
              ...items[0],
              id: "c",
              original: "Older one",
              createdAt: "2026-09-30T10:00:00Z",
            },
          ]}
          total={2}
        />,
      );
      expect(screen.getAllByText("Older one")).toHaveLength(1);
      expect(entries()).toHaveLength(2);
    });

    it("drops what was loaded when the server's page is the whole history", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      const view = renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={3} />,
      );
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      view.rerender(<HistoryList owner={OWNER} items={[...first]} total={2} />);
      expect(screen.queryByText("Older one")).toBeNull();
    });

    it("shows a row only once when the server's page overtakes a load", async () => {
      let arrive: (value: unknown) => void = () => {};
      older.answer.mockReturnValue(
        new Promise((resolve) => (arrive = resolve)),
      );
      const moved = {
        ...items[0],
        id: "c",
        original: "Moved up",
        createdAt: "2026-09-30T10:00:00Z",
      };
      const view = renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={4} />,
      );
      fireEvent.click(loadMore(), { detail: 1 });
      view.rerender(
        <HistoryList owner={OWNER} items={[first[1], moved]} total={3} />,
      );
      arrive({
        data: [
          stored("c", "2026-09-30T10:00:00Z", "Moved up"),
          stored("d", "2026-09-29T10:00:00Z", "Older one"),
        ],
        error: null,
      });
      await screen.findByText("Older one");
      expect(screen.getAllByText("Moved up")).toHaveLength(1);
    });

    it("searches what was loaded", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Une réécriture ancienne")],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.type(screen.getByRole("searchbox"), "reecriture");
      expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
      await userEvent.click(loadMore());
      await screen.findByText("Une réécriture ancienne");
      expect(screen.getByRole("status")).toHaveTextContent(/^1 match$/);
    });

    it("carries the keyboard on from the first new row", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      loadMore().focus();
      await userEvent.keyboard("{Enter}");
      await screen.findByText("Older one");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Reopen the rewrite of Sep 30/ }),
        ).toHaveFocus(),
      );
    });

    it("does not reopen the first new row on a held Enter", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      loadMore().focus();
      await userEvent.keyboard("{Enter>8/}");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Reopen the rewrite of Sep 30/ }),
        ).toHaveFocus(),
      );
      expect(older.answer).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    });

    it("carries the keyboard on from the first new row while more remain", async () => {
      older.answer.mockResolvedValue({ data: page(50), error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={60} />);
      loadMore().focus();
      await userEvent.keyboard("{Enter}");
      await screen.findByText("Text row-0");
      expect(loadMore()).toBeInTheDocument();
      await waitFor(() => expect(reopenButtons()[2]).toHaveFocus());
    });

    // A slow answer: the first new row's Reopen would take the rest of the typing, and a space
    // opens it
    it("leaves the keyboard where the reader has put it while the load ran", async () => {
      let arrive: (value: unknown) => void = () => {};
      older.answer.mockReturnValue(
        new Promise((resolve) => (arrive = resolve)),
      );
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.click(loadMore());
      const box = screen.getByRole("searchbox");
      await userEvent.click(box);
      await userEvent.keyboard("ol");
      arrive({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      await screen.findByText("Older one");
      await userEvent.keyboard("der one");
      expect(box).toHaveFocus();
      expect(box).toHaveValue("older one");
      expect(push).not.toHaveBeenCalled();
    });

    // A click on text takes the focus off the button and leaves it on the page, where a space
    // scrolls: it must not land on the first new row's Reopen, out of sight, and open it
    it.each([
      ["while more remain", 60, page(50), "Text row-49"],
      [
        "on the last page",
        3,
        [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        "Older one",
      ],
    ])(
      "leaves the focus on the page after a click on a row's text while the load ran, %s",
      async (_case, total, data, shown) => {
        let arrive: (value: unknown) => void = () => {};
        older.answer.mockReturnValue(
          new Promise((resolve) => (arrive = resolve)),
        );
        renderWithIntl(
          <HistoryList owner={OWNER} items={first} total={total} />,
        );
        loadMore().focus();
        await userEvent.keyboard("{Enter}");
        await userEvent.click(screen.getByText("First text"));
        expect(document.body).toHaveFocus();
        arrive({ data, error: null });
        await screen.findByText(shown);
        await userEvent.keyboard(" ");
        expect(document.body).toHaveFocus();
        expect(push).not.toHaveBeenCalled();
      },
    );

    // Safari does not give the focus to a button that is clicked: it stays on the page while the
    // load runs, with Load more still there while more remain, and the press came before the load
    it.each([
      ["while more remain", 60, page(50)],
      [
        "on the last page",
        3,
        [stored("c", "2026-09-30T10:00:00Z", "Older one")],
      ],
    ])(
      "carries the keyboard on from the page after a click that does not focus Load more, %s",
      async (_case, total, data) => {
        let arrive: (value: unknown) => void = () => {};
        older.answer.mockReturnValue(
          new Promise((resolve) => (arrive = resolve)),
        );
        renderWithIntl(
          <HistoryList owner={OWNER} items={first} total={total} />,
        );
        const button = loadMore();
        fireEvent.mouseDown(button);
        fireEvent.mouseUp(button);
        fireEvent.click(button, { detail: 1 });
        await waitFor(() => expect(older.answer).toHaveBeenCalledTimes(1));
        expect(document.body).toHaveFocus();
        arrive({ data, error: null });
        await waitFor(() => expect(reopenButtons()[2]).toHaveFocus());
      },
    );

    // A press on the page's scrollbar reaches the page, and leaves the focus where it was
    it("carries the keyboard on after a press that moves no focus while the load ran", async () => {
      let arrive: (value: unknown) => void = () => {};
      older.answer.mockReturnValue(
        new Promise((resolve) => (arrive = resolve)),
      );
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      const button = loadMore();
      button.focus();
      await userEvent.keyboard("{Enter}");
      fireEvent.mouseDown(document.documentElement);
      expect(button).toHaveFocus();
      arrive({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Reopen the rewrite of Sep 30/ }),
        ).toHaveFocus(),
      );
    });

    // A search can hide the first new row: the keyboard goes on from the first one it shows
    it("carries the keyboard on from the first new row the search shows", async () => {
      older.answer.mockResolvedValue({
        data: [
          stored("c", "2026-09-30T10:00:00Z", "Not a match"),
          stored("d", "2026-09-29T10:00:00Z", "Older one"),
        ],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={4} />);
      await userEvent.type(screen.getByRole("searchbox"), "older");
      loadMore().focus();
      await userEvent.keyboard("{Enter}");
      await screen.findByText("Older one");
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^Reopen the rewrite of Sep 29/ }),
        ).toHaveFocus(),
      );
    });

    // The button goes with the last page, and the search shows nothing it brought
    it("takes the keyboard to the search box when the search hides the whole last page", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      const box = screen.getByRole("searchbox");
      await userEvent.type(box, "last");
      loadMore().focus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Load more" })).toBeNull(),
      );
      await waitFor(() => expect(box).toHaveFocus());
      expect(push).not.toHaveBeenCalled();
    });

    it("leaves the keyboard on Load more when the search hides a page and more remain", async () => {
      older.answer.mockResolvedValue({ data: page(50), error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={60} />);
      await userEvent.type(screen.getByRole("searchbox"), "last");
      loadMore().focus();
      await userEvent.keyboard("{Enter}");
      await screen.findByText(/^Your 52 most recent rewrites/);
      expect(loadMore()).toHaveFocus();
    });

    it("deletes a loaded row like any other", async () => {
      older.answer.mockResolvedValue({
        data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
        error: null,
      });
      del.mockResolvedValue({ error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      await confirmDelete(2);
      await waitFor(() => expect(screen.queryByText("Older one")).toBeNull());
      expect(del).toHaveBeenCalledWith("id", ["c"], "user_id", OWNER);
      expect(screen.getByText("2 rewrites")).toBeInTheDocument();
    });

    it("runs one load at a time, and blocks the rest meanwhile", async () => {
      let arrive: (value: unknown) => void = () => {};
      older.answer.mockReturnValue(
        new Promise((resolve) => (arrive = resolve)),
      );
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={9} />);
      const button = loadMore();
      fireEvent.click(button, { detail: 1 });
      expect(button).toHaveTextContent("Loading...");
      expect(button).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(deleteButtons()[0], { detail: 1 });
      expect(screen.queryByRole("button", { name: "Yes, delete" })).toBeNull();
      await waitFor(() => expect(older.answer).toHaveBeenCalledTimes(1));
      arrive({ data: page(1), error: null });
      await screen.findByText("Text row-0");
    });

    it("ignores the second click of a double click", () => {
      older.answer.mockResolvedValue({ data: page(1), error: null });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      fireEvent.click(loadMore(), { detail: 2 });
      // A load marks the button at once; its request only leaves once a script has been fetched
      expect(loadMore()).toHaveAttribute("aria-disabled", "false");
    });

    it("says so beside the button when the load fails, and can try again", async () => {
      older.answer
        .mockResolvedValueOnce({
          data: null,
          error: { code: "x" },
          status: 500,
        })
        .mockResolvedValueOnce({
          data: [stored("c", "2026-09-30T10:00:00Z", "Older one")],
          error: null,
        });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.click(loadMore());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Could not load older rewrites");
      expect(alert.nextElementSibling).toBe(loadMore());
      expect(refresh).not.toHaveBeenCalled();
      await userEvent.click(loadMore());
      await screen.findByText("Older one");
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says so in French", async () => {
      older.answer.mockResolvedValue({
        data: null,
        error: { code: "x" },
        status: 500,
      });
      renderWithIntl(
        <HistoryList owner={OWNER} items={first} total={3} />,
        "fr",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Charger la suite" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Impossible de charger les réécritures plus anciennes",
      );
    });

    it("asks for the page again after a 401", async () => {
      older.answer.mockResolvedValue({
        data: null,
        error: { code: "42501" },
        status: 401,
      });
      renderWithIntl(<HistoryList owner={OWNER} items={first} total={3} />);
      await userEvent.click(loadMore());
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    });
  });

  it("words the confirmation for one entry and for several, in both languages", async () => {
    const question = (name: string) =>
      within(screen.getByRole("group", { name }));
    const { unmount } = renderWithIntl(
      <HistoryList owner={OWNER} items={[items[0]]} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(
      question("Delete all").getByText(
        "Delete this entry? This cannot be undone.",
      ),
    ).toBeInTheDocument();
    unmount();

    const second = renderWithIntl(
      <HistoryList owner={OWNER} items={[items[0]]} />,
      "fr",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Tout supprimer" }),
    );
    expect(
      question("Tout supprimer").getByText(
        "Supprimer cette entrée ? Cette action est définitive.",
      ),
    ).toBeInTheDocument();
    second.unmount();

    renderWithIntl(<HistoryList owner={OWNER} items={items} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete all" }));
    expect(
      question("Delete all").getByText(
        "Delete all 2 entries? This cannot be undone.",
      ),
    ).toBeInTheDocument();
  });
});
