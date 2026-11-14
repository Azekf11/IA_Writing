import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otherTab, settle, withFakeChannels } from "./fake-channel";
import { renderWithIntl } from "./render";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const KEPT = "rewrity:sign-in-draft";
const assign = vi.fn();

beforeEach(() => {
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

// A page loaded anew, with nothing shown yet: the code is this tab's own
async function load() {
  vi.resetModules();
  const [layout, panel, account, missing, failed] = await Promise.all([
    import("@/components/leave-on-sign-out"),
    import("@/components/auth-panel"),
    import("@/components/account-actions"),
    import("@/app/[locale]/not-found"),
    import("@/app/[locale]/error"),
  ]);
  const { LeaveOnSignOut } = layout;
  const NotFound = missing.default;
  const LocaleError = failed.default;
  return {
    AuthPanel: panel.AuthPanel,
    AccountActions: account.AccountActions,
    // The pages that show nothing of the account
    pages: {
      "the privacy page": <p>Privacy</p>,
      "a missing page": <NotFound />,
      "the error page": (
        <LocaleError error={new Error("broken")} retry={() => {}} />
      ),
      "a history that could not be read": (
        <p role="alert">Could not load your history.</p>
      ),
    } as Record<string, ReactNode>,
    // What the layout holds around every page: a client navigation changes the page, not this
    inLayout: (locale: string, content: ReactNode) => (
      <>
        <LeaveOnSignOut locale={locale} />
        {content}
      </>
    ),
  };
}

describe("a sign-out in another tab", () => {
  withFakeChannels();

  // Reached without a full load, the tab still holds the editor's text and the router's copies of
  // the pages it has shown
  it.each([
    "the privacy page",
    "a missing page",
    "the error page",
    "a history that could not be read",
  ])(
    "takes a tab that has shown the account away, once it is on %s",
    async (name) => {
      const { AuthPanel, pages, inLayout } = await load();
      const { rerender } = renderWithIntl(
        inLayout("fr", <AuthPanel email="a@example.com" />),
        "fr",
      );
      rerender(inLayout("fr", pages[name]));
      localStorage.setItem(KEPT, "kept");
      (await otherTab()).announceSignedOut();
      await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      expect(String(assign.mock.calls[0][0])).toBe(
        `${window.location.origin}/fr`,
      );
      expect(localStorage.getItem(KEPT)).toBeNull();
    },
  );

  it("does so after the history's account section too", async () => {
    const { AccountActions, pages, inLayout } = await load();
    const { rerender } = renderWithIntl(
      inLayout("en", <AccountActions owner="owner-1" hasHistory />),
    );
    rerender(inLayout("en", pages["a missing page"]));
    (await otherTab()).announceSignedOut();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toBe(
      `${window.location.origin}/en`,
    );
  });

  // The account panel and the history's account section listen themselves
  it.each([
    ["the account panel", "panel"],
    ["the history's account section", "account"],
  ])("loads the page anew once while %s is there", async (_name, part) => {
    const { AuthPanel, AccountActions, inLayout } = await load();
    renderWithIntl(
      inLayout(
        "en",
        part === "panel" ? (
          <AuthPanel email="a@example.com" />
        ) : (
          <AccountActions owner="owner-1" hasHistory />
        ),
      ),
    );
    (await otherTab()).announceSignedOut();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    await settle();
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it.each([
    "the privacy page",
    "a missing page",
    "the error page",
    "a history that could not be read",
  ])("leaves a tab that has shown no account as it is, on %s", async (name) => {
    const { pages, inLayout } = await load();
    renderWithIntl(inLayout("en", pages[name]));
    (await otherTab()).announceSignedOut();
    await settle();
    expect(assign).not.toHaveBeenCalled();
  });

  it("leaves a tab whose account panel has shown no session as it is", async () => {
    const { AuthPanel, pages, inLayout } = await load();
    const { rerender } = renderWithIntl(
      inLayout("en", <AuthPanel email={null} />),
    );
    rerender(inLayout("en", pages["the privacy page"]));
    (await otherTab()).announceSignedOut();
    await settle();
    expect(assign).not.toHaveBeenCalled();
  });

  it("is heard no more once the page is gone", async () => {
    const { AuthPanel, pages, inLayout } = await load();
    const { rerender, unmount } = renderWithIntl(
      inLayout("en", <AuthPanel email="a@example.com" />),
    );
    rerender(inLayout("en", pages["a missing page"]));
    unmount();
    (await otherTab()).announceSignedOut();
    await settle();
    expect(assign).not.toHaveBeenCalled();
  });
});
