import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPanel } from "@/components/auth-panel";
import { RewriteWorkspace } from "@/components/rewrite-workspace";
import { readDraft, saveDraft } from "@/lib/rewrite/draft";
import { readReopen, stashReopen } from "@/lib/rewrite/reopen";
import {
  FakeChannel,
  RefusedChannel,
  otherTab,
  settle,
  withFakeChannels,
} from "./fake-channel";
import { hydrateAfter, renderWithIntl } from "./render";

const signOut = vi.fn();
const getSession = vi.fn();
const signInWithOtp = vi.fn();
const refresh = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signOut, getSession, signInWithOtp } }),
}));

const KEY = "rewrity:sign-in-draft";

beforeEach(() => {
  search = "";
  refresh.mockReset();
  signOut.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({
    data: { session: null },
    error: null,
  });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  // Unmounted before anything is reset, as in workspace.test.tsx: an editor's effect still waiting
  // when a test ends would otherwise put its draft back after saveDraft(null)
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  saveDraft(null);
  window.history.pushState({}, "", "/");
});

const askForLink = async () => {
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
};

// The status line is on the page from the start: what counts is the message in it
const linkOnItsWay = () => screen.findByText(/on its way to/);

describe("AuthPanel", () => {
  const typedEarly = (page: HTMLElement) => {
    page.querySelector("input")!.value = "early@example.com";
  };

  it("sends an address typed before the scripts arrived", async () => {
    hydrateAfter(typedEarly, <AuthPanel email={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "early@example.com" }),
    );
  });

  it("sends what the box holds when the state is a moment behind", async () => {
    renderWithIntl(<AuthPanel email={null} />);
    const box = screen.getByLabelText<HTMLInputElement>("Email");
    box.value = "early@example.com";
    fireEvent.submit(box.closest("form")!);
    await waitFor(() =>
      expect(signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({ email: "early@example.com" }),
      ),
    );
  });

  it("keeps that address when sending fails", async () => {
    signInWithOtp.mockResolvedValue({ error: new Error("too many") });
    hydrateAfter(typedEarly, <AuthPanel email={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("early@example.com");
  });

  describe("when sending fails", () => {
    // A browser drops the focus of a button that becomes disabled, and jsdom does not: the focus is
    // moved to the page by hand while the link is being sent
    const dropFocus = () => {
      const spare = document.createElement("input");
      document.body.append(spare);
      spare.focus();
      spare.blur();
      spare.remove();
    };
    const failSlowly = () => {
      const answer = Promise.withResolvers<{ error: unknown }>();
      signInWithOtp.mockReturnValue(answer.promise);
      return () => answer.resolve({ error: new Error("too many") });
    };
    afterEach(() => vi.restoreAllMocks());

    it("gives the focus back to the address, which carries the message", async () => {
      const fail = failSlowly();
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await screen.findByRole("button", { name: "Sending..." });
      dropFocus();
      fail();
      const alert = await screen.findByRole("alert");
      expect(screen.getByLabelText("Email")).toHaveFocus();
      // The focus lands there as the message arrives, and can cut it off
      expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
        alert.textContent!,
      );
    });

    // The words change offline, and the address carries them all the same
    it("gives the focus back to the address offline too, which carries the message", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const fail = failSlowly();
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await screen.findByRole("button", { name: "Sending..." });
      dropFocus();
      fail();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Check your connection");
      expect(screen.getByLabelText("Email")).toHaveFocus();
      expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(
        alert.textContent!,
      );
    });

    it("leaves the focus where the reader has put it since", async () => {
      const fail = failSlowly();
      renderWithIntl(
        <>
          <AuthPanel email={null} />
          <button type="button">Elsewhere</button>
        </>,
      );
      await askForLink();
      await screen.findByRole("button", { name: "Sending..." });
      screen.getByRole("button", { name: "Elsewhere" }).focus();
      fail();
      await screen.findByRole("alert");
      expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
    });
  });

  it("signs out with a full load, so nothing of the session stays on the page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderWithIntl(<AuthPanel email="a@example.com" />, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Se déconnecter" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toBe(
      `${window.location.origin}/fr`,
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  // The default ends the session on every device, and each one would then need a new email
  it("signs out of this browser only", async () => {
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    renderWithIntl(<AuthPanel email="a@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("removes the text kept for a sign-in when signing out", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    localStorage.setItem(KEY, "kept");
    renderWithIntl(<AuthPanel email="a@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  // Reopen hands a rewrite over through this tab's storage: the next account must not open it
  it("removes a rewrite on its way from the history when signing out", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    expect(stashReopen("A text from the history", [])).toBe(true);
    renderWithIntl(<AuthPanel email="a@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(readReopen()).toBeNull();
  });

  describe("when the session could not be ended", () => {
    const assign = vi.fn();
    beforeEach(() => {
      assign.mockReset();
      vi.stubGlobal("location", { ...window.location, assign });
    });

    const signOutFails = async (locale: "en" | "fr" = "en") => {
      renderWithIntl(<AuthPanel email="a@example.com" />, locale);
      await userEvent.click(
        screen.getByRole("button", {
          name: locale === "en" ? "Sign out" : "Se déconnecter",
        }),
      );
      return screen.findByRole("alert");
    };

    // The session could not be renewed first, so it is still in the browser
    it("stays on the page, still signed in, and says so", async () => {
      signOut.mockResolvedValue({ error: new Error("network") });
      getSession.mockResolvedValue({
        data: { session: null },
        error: new Error("network"),
      });
      expect(await signOutFails()).toHaveTextContent(
        "Could not sign out, so this browser is still signed in. Reload the page, then try again.",
      );
      expect(assign).not.toHaveBeenCalled();
      expect(screen.getByText("Signed in as a@example.com")).toBeVisible();
    });

    it("stays when the browser still holds the session after an error", async () => {
      signOut.mockResolvedValue({ error: new Error("lock") });
      getSession.mockResolvedValue({ data: { session: {} }, error: null });
      await signOutFails();
      expect(assign).not.toHaveBeenCalled();
    });

    it("stays when signing out throws", async () => {
      signOut.mockRejectedValue(new Error("lock"));
      await signOutFails();
      expect(assign).not.toHaveBeenCalled();
    });

    it("says it in French", async () => {
      signOut.mockRejectedValue(new Error("lock"));
      expect(await signOutFails("fr")).toHaveTextContent(
        "Impossible de vous déconnecter : ce navigateur est toujours connecté. Rechargez la page, puis réessayez.",
      );
    });

    it("lets the reader try again, and the message goes with the next click", async () => {
      signOut.mockRejectedValueOnce(new Error("lock"));
      await signOutFails();
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  // While Auth stalls, a sign-out can take several seconds: the button says so, and takes one press
  describe("while the sign-out waits for Auth", () => {
    const assign = vi.fn();
    beforeEach(() => {
      assign.mockReset();
      vi.stubGlobal("location", { ...window.location, assign });
    });
    const waitForAuth = () => {
      const answer = Promise.withResolvers<{ error: unknown }>();
      signOut.mockReturnValue(answer.promise);
      return answer;
    };

    it("says that it is signing out, takes no second press, and stays so until the page goes", async () => {
      const answer = waitForAuth();
      renderWithIntl(<AuthPanel email="a@example.com" />);
      const button = screen.getByRole("button", { name: "Sign out" });
      await userEvent.click(button);
      expect(button).toHaveTextContent("Signing out...");
      expect(button).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(button);
      fireEvent.click(button, { detail: 0 });
      expect(signOut).toHaveBeenCalledTimes(1);
      answer.resolve({ error: null });
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(button).toHaveTextContent("Signing out...");
    });

    it("says it in French too", async () => {
      waitForAuth();
      renderWithIntl(<AuthPanel email="a@example.com" />, "fr");
      await userEvent.click(
        screen.getByRole("button", { name: "Se déconnecter" }),
      );
      expect(
        screen.getByRole("button", { name: "Déconnexion..." }),
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("gives the button back with the failure, for another try", async () => {
      const answer = waitForAuth();
      getSession.mockResolvedValue({ data: { session: {} }, error: null });
      renderWithIntl(<AuthPanel email="a@example.com" />);
      const button = screen.getByRole("button", { name: "Sign out" });
      await userEvent.click(button);
      answer.resolve({ error: new Error("lock") });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not sign out, so this browser is still signed in.",
      );
      expect(button).toHaveTextContent("Sign out");
      expect(button).toHaveAttribute("aria-disabled", "false");
      expect(assign).not.toHaveBeenCalled();
    });

    // Its second click must not start a second sign-out once the first has failed
    it("does not count the second click of a double click", async () => {
      signOut.mockRejectedValue(new Error("lock"));
      renderWithIntl(<AuthPanel email="a@example.com" />);
      const button = screen.getByRole("button", { name: "Sign out" });
      fireEvent.click(button, { detail: 1 });
      await screen.findByRole("alert");
      fireEvent.click(button, { detail: 2 });
      await settle();
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
  });

  // The server could not be told, and the library removed the session from the browser all the same
  it("goes on when the session left the browser despite an error", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    signOut.mockResolvedValue({ error: new Error("server unreachable") });
    renderWithIntl(<AuthPanel email="a@example.com" />);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  describe("the browser's other tabs", () => {
    withFakeChannels();
    const assign = vi.fn();
    beforeEach(() => {
      assign.mockReset();
      vi.stubGlobal("location", { ...window.location, assign });
    });

    it("are told once this one has signed out", async () => {
      const heard = vi.fn();
      (await otherTab()).onSignedOutElsewhere(heard);
      renderWithIntl(<AuthPanel email="a@example.com" />);
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    });

    it("are told nothing when it could not sign out", async () => {
      signOut.mockRejectedValue(new Error("lock"));
      const heard = vi.fn();
      (await otherTab()).onSignedOutElsewhere(heard);
      renderWithIntl(<AuthPanel email="a@example.com" />);
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await screen.findByRole("alert");
      await settle();
      expect(heard).not.toHaveBeenCalled();
    });

    // Without being brought to the front: no focus, no change of visibility
    it("load anew when one of them ends the session, and forget what this one kept", async () => {
      localStorage.setItem(KEY, "kept");
      expect(stashReopen("A text from the history", [])).toBe(true);
      renderWithIntl(<AuthPanel email="a@example.com" />, "fr");
      (await otherTab()).announceSignedOut();
      await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(String(assign.mock.calls[0][0])).toBe(
        `${window.location.origin}/fr`,
      );
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(readReopen()).toBeNull();
      expect(signOut).not.toHaveBeenCalled();
    });

    it("leave a tab with no session as it is", async () => {
      renderWithIntl(<AuthPanel email={null} />);
      (await otherTab()).announceSignedOut();
      await settle();
      expect(assign).not.toHaveBeenCalled();
      expect(FakeChannel.open.size).toBe(0);
    });

    it("are heard no more once the account panel is gone", async () => {
      const { unmount } = renderWithIntl(<AuthPanel email="a@example.com" />);
      unmount();
      (await otherTab()).announceSignedOut();
      await settle();
      expect(assign).not.toHaveBeenCalled();
      expect(FakeChannel.open.size).toBe(0);
    });

    // Telling them is a courtesy: the sign-out itself does not depend on it
    it("cannot stop a sign-out where the browser refuses to tell them", async () => {
      vi.stubGlobal("BroadcastChannel", RefusedChannel);
      renderWithIntl(<AuthPanel email="a@example.com" />);
      await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    });
  });

  it.each([
    ["en", "Email", "You need an account", "creates one", "Privacy"],
    [
      "fr",
      "E-mail",
      "Il faut un compte",
      "vous en cr\u00e9ez un",
      "Confidentialit\u00e9",
    ],
  ] as const)(
    "says above the form that an account is needed and that a link creates it, in %s",
    (locale, label, needed, creates, link) => {
      renderWithIntl(<AuthPanel email={null} />, locale);
      const note = screen.getByText((_, element) =>
        element?.tagName === "P"
          ? (element.textContent ?? "").startsWith(needed)
          : false,
      );
      expect(note).toHaveTextContent(creates);
      expect(within(note).getByRole("link", { name: link })).toHaveAttribute(
        "href",
        "/privacy",
      );
      expect(
        note.compareDocumentPosition(screen.getByLabelText(label)) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  // The browser's own placeholder is the text colour at half strength, 3.3:1 by day
  it("writes the sample address in the muted colour, as the other fields do", () => {
    renderWithIntl(<AuthPanel email={null} />);
    expect(screen.getByLabelText("Email")).toHaveClass(
      "placeholder:text-muted",
    );
  });

  it("does not show that note to someone signed in", () => {
    renderWithIntl(<AuthPanel email="a@example.com" />);
    expect(screen.queryByText(/You need an account/)).toBeNull();
  });

  it.each([
    ["en", "/en/history"],
    ["fr", "/fr/history"],
    ["fr", "/fr"],
  ] as const)(
    "brings a reader of %s back to %s, the page that asked",
    async (locale, path) => {
      window.history.pushState({}, "", path);
      renderWithIntl(<AuthPanel email={null} />, locale);
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: "a@example.com" },
      });
      fireEvent.submit(screen.getByRole("textbox").closest("form")!);
      await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(1));
      const back = new URL(
        signInWithOtp.mock.calls[0][0].options.emailRedirectTo,
      );
      expect(back.origin).toBe(window.location.origin);
      expect(back.pathname).toBe("/auth/callback");
      expect(back.searchParams.get("next")).toBe(path);
    },
  );

  describe("the text in the editor when a link is asked for", () => {
    const typed = () =>
      saveDraft({
        text: "My text",
        options: { strength: "light", voice: "My own sample" },
      });

    it("is kept for the page the link opens, without the writing sample", async () => {
      typed();
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await linkOnItsWay();
      const raw = localStorage.getItem(KEY)!;
      expect(JSON.parse(raw)).toMatchObject({
        text: "My text",
        strength: "light",
      });
      expect(raw).not.toContain("My own sample");
      // The tab that asked goes on as before
      expect(readDraft()?.text).toBe("My text");
    });

    it("is not kept before the link is on its way", async () => {
      typed();
      let arrive = () => {};
      signInWithOtp.mockReturnValue(
        new Promise((resolve) => {
          arrive = () => resolve({ error: null });
        }),
      );
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
      expect(localStorage.getItem(KEY)).toBeNull();
      arrive();
      await linkOnItsWay();
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    it("is not kept when the link could not be sent", async () => {
      typed();
      signInWithOtp.mockResolvedValue({ error: { status: 429 } });
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await screen.findByRole("alert");
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("needs a text: an empty editor keeps nothing", async () => {
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await linkOnItsWay();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("removes the copy of an earlier request when the editor is empty now", async () => {
      typed();
      renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await linkOnItsWay();
      expect(localStorage.getItem(KEY)).not.toBeNull();

      saveDraft({ text: "", options: { strength: "light", voice: "" } });
      await userEvent.click(
        screen.getByRole("button", { name: "Use another address" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      );
      await linkOnItsWay();
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe("once the link is sent", () => {
    const sent = async () => {
      const page = renderWithIntl(<AuthPanel email={null} />);
      await askForLink();
      await linkOnItsWay();
      return page;
    };
    const another = () =>
      screen.getByRole("button", { name: "Use another address" });
    const backToForm = () => userEvent.click(another());

    it("says which address it went to", async () => {
      await sent();
      expect(screen.getByRole("status")).toHaveTextContent(
        "on its way to a@example.com.",
      );
    });

    // Many screen readers do not announce a line that arrives together with its text
    it("says it in a status line that was on the page before", async () => {
      renderWithIntl(<AuthPanel email={null} />);
      const line = screen.getByRole("status");
      expect(line).toBeEmptyDOMElement();
      await askForLink();
      await linkOnItsWay();
      expect(screen.getByRole("status")).toBe(line);
      expect(line).toHaveTextContent("on its way to a@example.com.");
    });

    it("moves the focus to what is left to press, which says what was sent", async () => {
      await sent();
      expect(another()).toHaveFocus();
      expect(another()).toHaveAccessibleDescription(
        /on its way to a@example.com/,
      );
    });

    it("says it in French too", async () => {
      renderWithIntl(<AuthPanel email={null} />, "fr");
      await userEvent.type(screen.getByLabelText("E-mail"), "a@example.com");
      await userEvent.click(
        screen.getByRole("button", { name: "Recevoir un lien de connexion" }),
      );
      expect(await screen.findByText(/en route vers/)).toHaveTextContent(
        "est en route vers a@example.com.",
      );
      expect(
        screen.getByRole("button", { name: "Utiliser une autre adresse" }),
      ).toBeInTheDocument();
    });

    it("offers another address outside the message a screen reader announces", async () => {
      await sent();
      expect(
        within(screen.getByRole("status")).queryByRole("button"),
      ).toBeNull();
      expect(another()).toBeInTheDocument();
    });

    it("goes back to the form with the address, ready to correct, sending nothing", async () => {
      await sent();
      await backToForm();
      const box = screen.getByLabelText("Email");
      expect(box).toHaveValue("a@example.com");
      expect(box).toHaveFocus();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(signInWithOtp).toHaveBeenCalledTimes(1);
    });

    it("gives back the address that was sent, even if the state was behind", async () => {
      renderWithIntl(<AuthPanel email={null} />);
      const box = screen.getByLabelText<HTMLInputElement>("Email");
      box.value = "  early@example.com ";
      fireEvent.submit(box.closest("form")!);
      await linkOnItsWay();
      await backToForm();
      expect(screen.getByLabelText("Email")).toHaveValue("early@example.com");
    });

    it("does not count a second click of a double click", async () => {
      await sent();
      fireEvent.click(another(), { detail: 2 });
      expect(screen.getByRole("status")).toHaveTextContent("on its way to");
    });

    it("sends to the corrected address", async () => {
      await sent();
      await backToForm();
      const box = screen.getByLabelText("Email");
      await userEvent.clear(box);
      await userEvent.type(box, "b@example.com");
      await userEvent.click(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      );
      expect(await screen.findByText(/on its way to/)).toHaveTextContent(
        "b@example.com",
      );
      expect(signInWithOtp).toHaveBeenCalledTimes(2);
      expect(signInWithOtp.mock.calls[1][0].email).toBe("b@example.com");
    });

    // The failure belonged to the link before this one
    it("does not bring back an old link's failure with the form", async () => {
      search = "auth_error=1";
      await sent();
      await backToForm();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    describe("while waiting for the reader to open it", () => {
      const comeBack = () => window.dispatchEvent(new Event("focus"));
      const tabIs = (state: DocumentVisibilityState) => {
        vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
        document.dispatchEvent(new Event("visibilitychange"));
      };
      afterEach(() => vi.restoreAllMocks());

      it("asks the server again when the reader comes back to this tab", async () => {
        await sent();
        expect(refresh).not.toHaveBeenCalled();
        comeBack();
        expect(refresh).toHaveBeenCalledTimes(1);
        comeBack();
        expect(refresh).toHaveBeenCalledTimes(2);
      });

      // Coming back from another app on iOS may fire no focus event at all
      it("also asks when the page becomes visible again, and not when it is hidden", async () => {
        await sent();
        tabIs("hidden");
        expect(refresh).not.toHaveBeenCalled();
        tabIs("visible");
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      // Offline, the refresh falls back to a full load, and the browser's error page replaces this one
      it("does not ask while the browser is offline", async () => {
        await sent();
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        comeBack();
        tabIs("visible");
        expect(refresh).not.toHaveBeenCalled();
      });

      it("does not before a link is sent", () => {
        renderWithIntl(<AuthPanel email={null} />);
        comeBack();
        tabIs("visible");
        expect(refresh).not.toHaveBeenCalled();
      });

      it("stops when the form is back", async () => {
        await sent();
        await backToForm();
        comeBack();
        tabIs("visible");
        expect(refresh).not.toHaveBeenCalled();
      });

      it("stops when the page is left", async () => {
        const page = await sent();
        page.unmount();
        comeBack();
        tabIs("visible");
        expect(refresh).not.toHaveBeenCalled();
      });

      it("follows a session that arrives: the account shows, and the waiting stops", async () => {
        const page = await sent();
        page.rerender(<AuthPanel email="a@example.com" />);
        expect(screen.getByText("Signed in as a@example.com")).toBeVisible();
        expect(screen.queryByRole("status")).toBeNull();
        comeBack();
        expect(refresh).not.toHaveBeenCalled();
      });

      it("takes the editor's request to sign in off the page when the session arrives", async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: "unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        );
        const page = renderWithIntl(
          <>
            <AuthPanel email={null} />
            <RewriteWorkspace />
          </>,
        );
        await userEvent.type(screen.getByLabelText("Your text"), "My text");
        await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Sign in to rewrite your text.",
        );
        await askForLink();
        await linkOnItsWay();

        page.rerender(
          <>
            <AuthPanel email="a@example.com" />
            <RewriteWorkspace />
          </>,
        );
        await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
        expect(screen.getByLabelText("Your text")).toHaveValue("My text");
      });
    });
  });

  // A held key repeats on whatever holds the focus by then: Use another address, which takes the
  // box's place once the link is on its way, then the box it gives back, which would send again
  describe("a held Enter in the address box", () => {
    const hold = async () => {
      await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
      await userEvent.keyboard("{Enter>12/}");
    };

    it.each([
      ["alone, as on the history page", () => <AuthPanel email={null} />],
      [
        "next to the editor, as on the home page",
        () => (
          <>
            <AuthPanel email={null} />
            <RewriteWorkspace />
          </>
        ),
      ],
    ])("asks for one link, %s", async (_, page) => {
      renderWithIntl(page());
      await hold();
      await linkOnItsWay();
      expect(signInWithOtp).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Use another address" }),
      ).toHaveFocus();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("does not ask again after a failure while it is held", async () => {
      signInWithOtp.mockResolvedValue({ error: { status: 429 } });
      renderWithIntl(<AuthPanel email={null} />);
      await hold();
      await screen.findByRole("alert");
      expect(signInWithOtp).toHaveBeenCalledTimes(1);
    });

    it("still takes a new press", async () => {
      renderWithIntl(<AuthPanel email={null} />);
      await hold();
      await linkOnItsWay();
      await userEvent.keyboard("{Enter}");
      expect(screen.getByLabelText("Email")).toHaveFocus();
      await userEvent.keyboard("{Enter}");
      await waitFor(() => expect(signInWithOtp).toHaveBeenCalledTimes(2));
      await linkOnItsWay();
    });
  });

  it("tells the reader to open the link in this browser", async () => {
    renderWithIntl(<AuthPanel email={null} />);
    await askForLink();
    expect(await linkOnItsWay()).toHaveTextContent("Open it in this browser.");
  });

  it("says why a link can fail, without blaming its age alone", () => {
    search = "auth_error=1";
    renderWithIntl(<AuthPanel email={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "in the browser that asked for it",
    );
  });

  it("does not put a sending failure down to the address alone", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429 } });
    renderWithIntl(<AuthPanel email={null} />);
    await askForLink();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "try again in a few minutes",
    );
  });
});
