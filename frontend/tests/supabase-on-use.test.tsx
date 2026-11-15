import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "./render";

const script = { fetched: 0, broken: false };
const signInWithOtp = vi.fn();
const signOut = vi.fn();
const del = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The components, loaded anew for each test, so each one starts with the client's script not fetched
const authPanel = async () =>
  (await import("@/components/auth-panel")).AuthPanel;
const historyList = async () =>
  (await import("@/components/history-list")).HistoryList;

beforeEach(() => {
  vi.resetModules();
  script.fetched = 0;
  script.broken = false;
  // Runs when the file is first asked for, as the browser's fetch of its script would
  vi.doMock("@/lib/supabase/browser", () => {
    script.fetched++;
    if (script.broken) throw new Error("the script could not be fetched");
    return {
      createClient: () => ({
        auth: { signInWithOtp, signOut },
        from: () => ({
          delete: () => ({
            in: (...id: unknown[]) => ({
              eq: (...owner: unknown[]) => del(...id, ...owner),
            }),
          }),
        }),
      }),
    };
  });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  signOut.mockReset().mockResolvedValue({ error: null });
  del.mockReset().mockResolvedValue({ error: null, status: 204 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const entry = {
  id: "a",
  original: "First text",
  edits: [],
  editCount: 1,
  createdAt: "2026-10-01T10:00:00Z",
};

const deleteRow = () =>
  screen.getByRole("button", { name: /^Delete the rewrite of/ });

describe("the Supabase client in the browser", () => {
  it("is not fetched with the sign-in form", async () => {
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    expect(script.fetched).toBe(0);
  });

  it("is fetched ahead of need when the email box gets focus", async () => {
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    screen.getByLabelText("Email").focus();
    await waitFor(() => expect(script.fetched).toBe(1));
  });

  it("does not stop anything when fetching it ahead of need fails", async () => {
    script.broken = true;
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    screen.getByLabelText("Email").focus();
    await waitFor(() => expect(script.fetched).toBe(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // The mailer allows few sends: a second click during the fetch must not spend one
  it("disables the button before it is fetched, so one click is one email", async () => {
    let arrive = () => {};
    signInWithOtp.mockReturnValue(
      new Promise((resolve) => {
        arrive = () => resolve({ error: null });
      }),
    );
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    const button = screen.getByRole("button", {
      name: "Email me a sign-in link",
    });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Sending...");
    fireEvent.click(button);
    await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
    arrive();
    expect(await screen.findByText(/on its way/)).toBeInTheDocument();
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  // The address is not the trouble: a reload gets the page's scripts anew
  it("says the page needs a reload when it cannot be fetched, and the button works again", async () => {
    script.broken = true;
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Could not send the link. Reload the page, then try again.",
    );
    expect(alert).not.toHaveTextContent("address");
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeEnabled();
  });

  // The draft lives in memory, which the reload empties: the editor that loads takes this copy back
  it("keeps the text in the editor for the reload it asks for, without the writing sample", async () => {
    script.broken = true;
    const { saveDraft } = await import("@/lib/rewrite/draft");
    saveDraft({
      text: "My text",
      options: { strength: "light", voice: "My own sample" },
    });
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reload the page",
    );
    const raw = localStorage.getItem("rewrity:sign-in-draft");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({
      text: "My text",
      strength: "light",
    });
    expect(raw).not.toContain("My own sample");
  });

  // A reload while offline puts the browser's error page in this one's place, and the next click
  // fetches the script again. The address is not the trouble either.
  it("does not ask for a reload while the browser is offline", async () => {
    script.broken = true;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("Reload");
    expect(alert).not.toHaveTextContent("address");
    expect(alert).toHaveTextContent(
      "Could not send the link. Check your connection, then try again.",
    );
  });

  it("says so in French too", async () => {
    script.broken = true;
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />, "fr");
    await userEvent.type(screen.getByLabelText("E-mail"), "a@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Recevoir un lien de connexion" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Impossible d'envoyer le lien. Rechargez la page, puis réessayez.",
    );
  });

  it("keeps the usual message when the script came and the sending failed", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429 } });
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email={null} />);
    await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not send the link. Check the address, or try again in a few minutes.",
    );
  });

  describe("what the form says when sending fails", () => {
    const FORM = {
      en: { box: "Email", send: "Email me a sign-in link" },
      fr: { box: "E-mail", send: "Recevoir un lien de connexion" },
    };
    const OFFLINE = {
      en: "Could not send the link. Check your connection, then try again.",
      // In French, "connexion" alone also means the sign-in this form asks for: the network is named
      fr: "Impossible d'envoyer le lien. Vérifiez votre connexion Internet, puis réessayez.",
    };
    const sendIn = async (locale: "en" | "fr") => {
      const AuthPanel = await authPanel();
      renderWithIntl(<AuthPanel email={null} />, locale);
      await userEvent.type(
        screen.getByLabelText(FORM[locale].box),
        "a@example.com",
      );
      await userEvent.click(
        screen.getByRole("button", { name: FORM[locale].send }),
      );
      return screen.findByRole("alert");
    };
    const offline = () =>
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    it.each(["en", "fr"] as const)(
      "asks to check the connection, in %s, when the script is out of reach offline",
      async (locale) => {
        script.broken = true;
        offline();
        expect(await sendIn(locale)).toHaveTextContent(OFFLINE[locale]);
      },
    );

    it.each(["en", "fr"] as const)(
      "asks to check the connection, in %s, when the sending fails offline",
      async (locale) => {
        signInWithOtp.mockResolvedValue({ error: { status: 0 } });
        offline();
        expect(await sendIn(locale)).toHaveTextContent(OFFLINE[locale]);
      },
    );

    it("asks to check the connection when the sending throws offline", async () => {
      signInWithOtp.mockRejectedValue(new TypeError("Failed to fetch"));
      offline();
      expect(await sendIn("en")).toHaveTextContent(OFFLINE.en);
    });

    // Online, a refusal from the server can be about the address or a busy mailer
    it.each([
      [
        "en",
        400,
        "Could not send the link. Check the address, or try again in a few minutes.",
      ],
      [
        "fr",
        429,
        "Impossible d'envoyer le lien. Vérifiez l'adresse ou réessayez dans quelques minutes.",
      ],
    ] as const)(
      "keeps its words, in %s, when the server refuses the link online (%i)",
      async (locale, status, said) => {
        signInWithOtp.mockResolvedValue({ error: { status } });
        expect(await sendIn(locale)).toHaveTextContent(said);
      },
    );

    // A request that got no answer at all has status 0. A network that is up but reaches nothing,
    // such as a Wi-Fi that asks to sign in first, leaves the browser online, and the server never
    // saw the address.
    it.each(["en", "fr"] as const)(
      "asks to check the connection, in %s, when the request gets no answer online",
      async (locale) => {
        signInWithOtp.mockResolvedValue({ error: { status: 0 } });
        expect(navigator.onLine).toBe(true);
        expect(await sendIn(locale)).toHaveTextContent(OFFLINE[locale]);
      },
    );
  });

  // Without it the session cannot be removed: the page must not look signed out while it is not
  it("is fetched for a sign-out, and when it cannot be, the reader stays signed in and is told", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    script.broken = true;
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email="a@example.com" />);
    expect(script.fetched).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not sign out, so this browser is still signed in. Reload the page, then try again.",
    );
    expect(script.fetched).toBe(1);
    expect(assign).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("does not need it to remove the text kept for a sign-in, or a rewrite on its way to the editor", async () => {
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    localStorage.setItem("rewrity:sign-in-draft", "kept");
    sessionStorage.setItem("rewrity:reopen", "on its way");
    script.broken = true;
    const AuthPanel = await authPanel();
    renderWithIntl(<AuthPanel email="a@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(localStorage.getItem("rewrity:sign-in-draft")).toBeNull();
    expect(sessionStorage.getItem("rewrity:reopen")).toBeNull();
  });

  it("waits for a first delete on the history page", async () => {
    const HistoryList = await historyList();
    renderWithIntl(<HistoryList owner="me" items={[entry]} />);
    expect(script.fetched).toBe(0);
    await userEvent.click(deleteRow());
    // The question costs nothing: only the answer needs the script
    expect(script.fetched).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("id", ["a"], "user_id", "me"),
    );
    expect(script.fetched).toBe(1);
  });

  it("makes a delete fail in the open when it cannot be fetched", async () => {
    script.broken = true;
    const HistoryList = await historyList();
    renderWithIntl(<HistoryList owner="me" items={[entry]} />);
    await userEvent.click(deleteRow());
    await userEvent.click(screen.getByRole("button", { name: "Yes, delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not delete",
    );
    expect(screen.getByText("First text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Yes, delete" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });

  it("makes a Load more fail in the open when it cannot be fetched", async () => {
    script.broken = true;
    const HistoryList = await historyList();
    renderWithIntl(<HistoryList owner="me" items={[entry]} total={2} />);
    expect(script.fetched).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load older rewrites",
    );
    expect(screen.getByRole("button", { name: "Load more" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  });
});
