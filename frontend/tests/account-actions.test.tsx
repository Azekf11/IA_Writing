import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountActions } from "@/components/account-actions";
import { readReopen, stashReopen } from "@/lib/rewrite/reopen";
import {
  FakeChannel,
  otherTab,
  settle,
  withFakeChannels,
} from "./fake-channel";
import { renderWithIntl } from "./render";

const refresh = vi.fn();
const assign = vi.fn();
// One answer per read of the export, in order, and what each read asked for
const reads = { answers: [] as unknown[], steps: [] as unknown[][] };
let broken = false;

vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
}));
vi.mock("@/lib/supabase/browser", () => {
  if (broken) throw new Error("the script could not be fetched");
  return {
    createClient: () => ({
      from: (table: string) => {
        reads.steps.push(["from", table]);
        const chain = {
          select: (...args: unknown[]) => (
            reads.steps.push(["select", ...args]),
            chain
          ),
          eq: (...args: unknown[]) => (
            reads.steps.push(["eq", ...args]),
            chain
          ),
          order: (...args: unknown[]) => (
            reads.steps.push(["order", ...args]),
            chain
          ),
          range: (...args: unknown[]) => {
            reads.steps.push(["range", ...args]);
            return Promise.resolve(reads.answers.shift());
          },
        };
        return chain;
      },
    }),
  };
});

const OWNER = "owner-1";
const KEPT_DRAFT = "rewrity:sign-in-draft";

const download = () =>
  screen.getByRole("button", { name: "Download my history" });
const askToDelete = () =>
  screen.getByRole("button", { name: "Delete my account" });
const yes = () =>
  screen.getByRole("button", { name: "Yes, delete my account" });
const cancel = () => screen.getByRole("button", { name: "Cancel" });
const view = (hasHistory = true, locale: "en" | "fr" = "en") =>
  renderWithIntl(
    <AccountActions owner={OWNER} hasHistory={hasHistory} />,
    locale,
  );

const answerWith = (status: number) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ status })),
  );
const sent = () => vi.mocked(fetch).mock.calls;

// What a click on a download link would have saved
function catchDownloads() {
  const saved: { name: string; blob: Blob }[] = [];
  const urls = new Map<string, Blob>();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: (blob: Blob) => {
        const url = `blob:${urls.size}`;
        urls.set(url, blob);
        return url;
      },
      revokeObjectURL: () => {},
    }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    saved.push({ name: this.download, blob: urls.get(this.href)! });
  });
  return saved;
}

const contents = (blob: Blob) =>
  new Promise<string>((done) => {
    const reader = new FileReader();
    reader.onload = () => done(String(reader.result));
    reader.readAsText(blob);
  });

const row = (n: number) => ({
  original: `Text ${n}`,
  edits: [{ id: `edit-${n}` }],
  locale: "fr",
  created_at: `2026-10-01T10:00:0${n}.123456+00:00`,
});

beforeEach(() => {
  refresh.mockReset();
  assign.mockReset();
  reads.answers = [];
  reads.steps = [];
  broken = false;
  vi.stubGlobal("location", { ...window.location, assign });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("deleting the account", () => {
  it("asks first, on a line of its own, and sends nothing before the answer", async () => {
    answerWith(200);
    view();
    await userEvent.click(askToDelete());
    expect(sent()).toHaveLength(0);
    expect(yes()).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Delete your account and your whole history? This cannot be undone. What Anthropic has already received falls under its own terms.",
    );
  });

  it("has the status line on the page before the question arrives", () => {
    view();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  });

  it("asks in French, with the same warnings", async () => {
    view(true, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Supprimer mon compte" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Supprimer votre compte et tout votre historique ? Cette action est définitive. Ce qu'Anthropic a déjà reçu reste soumis à ses propres conditions.",
    );
    expect(
      screen.getByRole("button", { name: "Oui, supprimer mon compte" }),
    ).toBeInTheDocument();
  });

  it("sends nothing on Cancel, and the keyboard goes back to the button", async () => {
    answerWith(200);
    view();
    await userEvent.click(askToDelete());
    await userEvent.click(cancel());
    expect(sent()).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Yes, delete my account" }),
    ).toBeNull();
    expect(askToDelete()).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(/^$/);
  });

  it("cannot be confirmed with a double click: the answer opens elsewhere", async () => {
    answerWith(200);
    view();
    await userEvent.dblClick(askToDelete());
    expect(sent()).toHaveLength(0);
    expect(yes()).not.toBe(askToDelete());
  });

  it("does not take the second click of a double click as the answer", () => {
    answerWith(200);
    view();
    fireEvent.click(askToDelete(), { detail: 1 });
    fireEvent.click(yes(), { detail: 2 });
    expect(sent()).toHaveLength(0);
  });

  it("works from the keyboard, which reports no clicks", async () => {
    answerWith(200);
    view();
    fireEvent.click(askToDelete(), { detail: 0 });
    fireEvent.click(yes(), { detail: 0 });
    await waitFor(() => expect(sent()).toHaveLength(1));
  });

  it("names the account the page was rendered for, and that alone", async () => {
    answerWith(200);
    view();
    await userEvent.click(askToDelete());
    await userEvent.click(yes());
    await waitFor(() => expect(sent()).toHaveLength(1));
    const [address, options] = sent()[0] as unknown as [string, RequestInit];
    expect(address).toBe("/api/account");
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ account: OWNER }));
  });

  it("sends one request however often Yes is pressed", async () => {
    let arrive: (value: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (arrive = resolve))),
    );
    view();
    fireEvent.click(askToDelete(), { detail: 1 });
    const button = yes();
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Deleting...");
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(cancel(), { detail: 1 });
    expect(sent()).toHaveLength(1);
    arrive({ status: 500 });
    await screen.findByRole("alert");
    expect(button).toHaveAttribute("aria-disabled", "false");
  });

  describe("once it is done", () => {
    const finish = async (locale: "en" | "fr" = "en") => {
      answerWith(200);
      view(true, locale);
      fireEvent.click(askToDelete_for(locale), { detail: 1 });
      fireEvent.click(yes_for(locale), { detail: 1 });
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    };
    const askToDelete_for = (locale: "en" | "fr") =>
      screen.getByRole("button", {
        name: locale === "en" ? "Delete my account" : "Supprimer mon compte",
      });
    const yes_for = (locale: "en" | "fr") =>
      screen.getByRole("button", {
        name:
          locale === "en"
            ? "Yes, delete my account"
            : "Oui, supprimer mon compte",
      });

    it("ends with a full load of the home page, in the reader's language", async () => {
      await finish("fr");
      expect(String(assign.mock.calls[0][0])).toBe(
        `${window.location.origin}/fr`,
      );
    });

    it("leaves no copy of the text kept for a sign-in link", async () => {
      localStorage.setItem(KEPT_DRAFT, "kept");
      await finish();
      expect(localStorage.getItem(KEPT_DRAFT)).toBeNull();
    });

    // Reopen hands a rewrite over through storage: it must not open a deleted account's text
    it("leaves no rewrite on its way to the editor", async () => {
      expect(stashReopen("A deleted text", [])).toBe(true);
      await finish();
      expect(readReopen()).toBeNull();
    });

    it("stays busy until the page goes", async () => {
      await finish();
      expect(
        screen.getByRole("button", { name: "Deleting..." }),
      ).toHaveAttribute("aria-disabled", "true");
    });
  });

  describe("the browser's other tabs", () => {
    withFakeChannels();

    it("are told once the account is gone", async () => {
      const heard = vi.fn();
      (await otherTab()).onSignedOutElsewhere(heard);
      answerWith(200);
      view();
      fireEvent.click(askToDelete(), { detail: 1 });
      fireEvent.click(yes(), { detail: 1 });
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    });

    it("are told when a press after one with no definite answer finds the session gone", async () => {
      const heard = vi.fn();
      (await otherTab()).onSignedOutElsewhere(heard);
      const statuses = [504, 401];
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ status: statuses.shift() })),
      );
      view();
      await userEvent.click(askToDelete());
      await userEvent.click(yes());
      await screen.findByRole("alert");
      await settle();
      expect(heard).not.toHaveBeenCalled();
      await userEvent.click(yes());
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    });

    it("are told nothing when it did not happen", async () => {
      const heard = vi.fn();
      (await otherTab()).onSignedOutElsewhere(heard);
      answerWith(500);
      view();
      await userEvent.click(askToDelete());
      await userEvent.click(yes());
      await screen.findByRole("alert");
      await settle();
      expect(heard).not.toHaveBeenCalled();
    });

    // The history on this page is no longer the reader's to see
    it("take this one away from the history when one of them ends the session", async () => {
      localStorage.setItem(KEPT_DRAFT, "kept");
      expect(stashReopen("A text from the history", [])).toBe(true);
      view(true, "fr");
      (await otherTab()).announceSignedOut();
      await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(String(assign.mock.calls[0][0])).toBe(
        `${window.location.origin}/fr`,
      );
      expect(localStorage.getItem(KEPT_DRAFT)).toBeNull();
      expect(readReopen()).toBeNull();
    });

    it("are heard no more once the section is gone", async () => {
      const { unmount } = view();
      unmount();
      (await otherTab()).announceSignedOut();
      await settle();
      expect(assign).not.toHaveBeenCalled();
      expect(FakeChannel.open.size).toBe(0);
    });
  });

  describe("when it does not happen", () => {
    const attempt = async (status: number) => {
      answerWith(status);
      view();
      await userEvent.click(askToDelete());
      await userEvent.click(yes());
      return screen.findByRole("alert");
    };

    it.each([
      ["a server error", 500],
      ["a preview without the key", 503],
      ["a refused Origin", 403],
    ])("says so and keeps the session after %s", async (_case, status) => {
      localStorage.setItem(KEPT_DRAFT, "kept");
      expect(await attempt(status)).toHaveTextContent(
        "Could not confirm that your account was deleted. You can safely try again in a moment: if it is already gone, you will simply be signed out.",
      );
      expect(assign).not.toHaveBeenCalled();
      expect(localStorage.getItem(KEPT_DRAFT)).toBe("kept");
      expect(refresh).not.toHaveBeenCalled();
    });

    it("says so when the network fails", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("network");
        }),
      );
      view();
      await userEvent.click(askToDelete());
      await userEvent.click(yes());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not confirm that your account was deleted",
      );
      expect(assign).not.toHaveBeenCalled();
    });

    // The deletion may have gone through before the answer was lost or Auth's was cut: the page
    // cannot say that nothing was removed
    it.each([
      ["the network fails", null],
      ["a gateway gives up", 504],
      ["a gateway fails", 502],
      ["the route fails", 500],
    ])("claims nothing it cannot know when %s", async (_case, status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          if (status === null) throw new TypeError("network");
          return { status };
        }),
      );
      view();
      await userEvent.click(askToDelete());
      await userEvent.click(yes());
      const alert = await screen.findByRole("alert");
      expect(alert).not.toHaveTextContent(
        /Nothing was removed|still signed in/,
      );
      expect(alert).toHaveTextContent("Could not confirm");
      expect(assign).not.toHaveBeenCalled();
    });

    it("lets the reader try again from the same place", async () => {
      await attempt(500);
      expect(yes()).toHaveAttribute("aria-disabled", "false");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ status: 200 })),
      );
      await userEvent.click(yes());
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).toBeNull();
    });

    // A tab left open after signing in as someone else: retrying would never work
    it("says the page is out of date when another account is signed in", async () => {
      expect(await attempt(409)).toHaveTextContent(
        "the account it was opened for is no longer the one signed in here. Nothing was deleted.",
      );
      expect(assign).not.toHaveBeenCalled();
    });

    it("follows the session when it has ended", async () => {
      expect(await attempt(401)).toHaveTextContent(
        "the account it was opened for is no longer the one signed in here",
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
    });

    // A deletion that went through takes the session with it, so a later press can find none: once
    // the access token has run out, or with the legacy shared secret. The first answer promised a
    // plain sign-out for that case.
    describe("after a press that got no definite answer", () => {
      const pressTwice = async (
        first: number | null,
        then: number,
        locale: "en" | "fr" = "en",
      ) => {
        const statuses = [first, then];
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            const status = statuses.shift();
            if (status === null) throw new TypeError("network");
            return { status };
          }),
        );
        view(true, locale);
        const answer = () =>
          screen.getByRole("button", {
            name:
              locale === "en"
                ? "Yes, delete my account"
                : "Oui, supprimer mon compte",
          });
        await userEvent.click(
          screen.getByRole("button", {
            name:
              locale === "en" ? "Delete my account" : "Supprimer mon compte",
          }),
        );
        await userEvent.click(answer());
        await screen.findByRole("alert");
        await userEvent.click(answer());
      };

      it.each([
        ["the answer was lost", null],
        ["a gateway gave up", 504],
        ["a gateway failed", 502],
        ["the route failed", 500],
      ])(
        "signs this browser out on a 401, as after a deletion, when %s",
        async (_case, first) => {
          localStorage.setItem(KEPT_DRAFT, "kept");
          expect(stashReopen("A deleted text", [])).toBe(true);
          await pressTwice(first, 401, "fr");
          await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
          expect(String(assign.mock.calls[0][0])).toBe(
            `${window.location.origin}/fr`,
          );
          expect(screen.queryByRole("alert")).toBeNull();
          expect(refresh).not.toHaveBeenCalled();
          expect(localStorage.getItem(KEPT_DRAFT)).toBeNull();
          expect(readReopen()).toBeNull();
        },
      );

      it("stays busy until the page goes", async () => {
        await pressTwice(500, 401);
        await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
        expect(
          screen.getByRole("button", { name: "Deleting..." }),
        ).toHaveAttribute("aria-disabled", "true");
      });

      // Refused before anything was deleted: that much is known
      it("still says that nothing was deleted on a 409", async () => {
        await pressTwice(500, 409);
        await waitFor(() =>
          expect(screen.getByRole("alert")).toHaveTextContent(
            "Nothing was deleted.",
          ),
        );
        expect(assign).not.toHaveBeenCalled();
      });

      // A refused Origin deletes nothing, so a 401 after it means what it does on a first press
      it("says the page is out of date on a 401 after an answer that was definite", async () => {
        await pressTwice(403, 401);
        await waitFor(() =>
          expect(screen.getByRole("alert")).toHaveTextContent(
            "Nothing was deleted.",
          ),
        );
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(assign).not.toHaveBeenCalled();
      });
    });

    it("says so in French", async () => {
      answerWith(500);
      view(true, "fr");
      await userEvent.click(
        screen.getByRole("button", { name: "Supprimer mon compte" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Oui, supprimer mon compte" }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Impossible de confirmer la suppression de votre compte. Vous pouvez réessayer sans risque dans un instant : s'il a déjà été supprimé, votre session sera simplement fermée.",
      );
    });
  });
});

describe("downloading the history", () => {
  const ok = (data: unknown[], count: number) => ({
    data,
    count,
    error: null,
    status: 206,
  });
  const press = async () => {
    await userEvent.click(download());
    await waitFor(() =>
      expect(download()).toHaveAttribute("aria-disabled", "false"),
    );
  };

  it("is not offered when there is nothing to download", () => {
    view(false);
    expect(
      screen.queryByRole("button", { name: "Download my history" }),
    ).toBeNull();
    expect(askToDelete()).toBeInTheDocument();
  });

  it("fetches the Supabase script only when asked", async () => {
    catchDownloads();
    reads.answers = [ok([row(1)], 1)];
    view();
    expect(reads.steps).toEqual([]);
    await press();
    expect(reads.steps[0]).toEqual(["from", "rewrites"]);
  });

  // Everything the privacy page lists as stored for each rewrite, the language included
  it("reads the account's rows in a fixed order, and saves them under its own name", async () => {
    const saved = catchDownloads();
    reads.answers = [ok([row(1), row(2)], 2)];
    view();
    await press();
    expect(reads.steps).toEqual([
      ["from", "rewrites"],
      ["select", "original, edits, locale, created_at", { count: "exact" }],
      ["eq", "user_id", OWNER],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["range", 0, 99],
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe("rewrity-history.json");
    expect(saved[0].blob.type).toBe("application/json");
    expect(JSON.parse(await contents(saved[0].blob))).toEqual([row(1), row(2)]);
  });

  it("goes on from what actually arrived, however few rows the API sends at a time", async () => {
    const saved = catchDownloads();
    reads.answers = [
      ok([row(1), row(2)], 5),
      ok([row(3), row(4)], 5),
      ok([row(5)], 5),
    ];
    view();
    await press();
    const ranges = reads.steps.filter(([step]) => step === "range");
    expect(ranges).toEqual([
      ["range", 0, 99],
      ["range", 2, 101],
      ["range", 4, 103],
    ]);
    expect(JSON.parse(await contents(saved[0].blob))).toHaveLength(5);
  });

  it("says how many it saved", async () => {
    catchDownloads();
    reads.answers = [ok([row(1), row(2)], 2)];
    view();
    await press();
    expect(screen.getByRole("status")).toHaveTextContent(
      "2 rewrites saved in rewrity-history.json.",
    );
  });

  describe("saves nothing and says so", () => {
    const expectFailure = async () => {
      const saved = catchDownloads();
      view();
      await press();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not download your whole history, so no file was saved.",
      );
      expect(saved).toHaveLength(0);
      expect(screen.getByRole("status")).toHaveTextContent(/^$/);
    };

    it("when fewer rows arrive than were counted", async () => {
      reads.answers = [ok([row(1), row(2)], 3), ok([], 3)];
      await expectFailure();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("when the count changes on the way, which shifts the pages", async () => {
      reads.answers = [ok([row(1)], 2), ok([row(2)], 3)];
      await expectFailure();
    });

    it("when a read fails half way", async () => {
      reads.answers = [
        ok([row(1)], 2),
        { data: null, count: null, error: { code: "500" }, status: 500 },
      ];
      await expectFailure();
      expect(refresh).not.toHaveBeenCalled();
    });

    it("when the script cannot be fetched", async () => {
      broken = true;
      await expectFailure();
    });

    // Filtered by the page's account, so a session that changed reads nothing
    it("and follows the session when this account has no row any more", async () => {
      reads.answers = [ok([], 0)];
      await expectFailure();
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("and follows the session on a 401", async () => {
      reads.answers = [
        { data: null, count: null, error: { code: "42501" }, status: 401 },
      ];
      await expectFailure();
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });

  it("says so in French", async () => {
    catchDownloads();
    reads.answers = [
      { data: null, count: null, error: { code: "500" }, status: 500 },
    ];
    view(true, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Télécharger mon historique" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible de télécharger tout votre historique",
    );
  });

  it("runs one export at a time, and holds the rest back meanwhile", async () => {
    const saved = catchDownloads();
    answerWith(200);
    let arrive: (value: unknown) => void = () => {};
    reads.answers = [new Promise((resolve) => (arrive = resolve))];
    view();
    const button = download();
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveTextContent("Preparing...");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(askToDelete(), { detail: 1 });
    expect(
      screen.queryByRole("button", { name: "Yes, delete my account" }),
    ).toBeNull();
    await waitFor(() =>
      expect(reads.steps.filter(([s]) => s === "range")).toHaveLength(1),
    );
    arrive(ok([row(1)], 1));
    await waitFor(() => expect(saved).toHaveLength(1));
  });

  it("does not count the second click of a double click", () => {
    catchDownloads();
    view();
    fireEvent.click(download(), { detail: 2 });
    // A download marks the button at once; its reads only leave once a script has been fetched
    expect(download()).toHaveAttribute("aria-disabled", "false");
  });
});
