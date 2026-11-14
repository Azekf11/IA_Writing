import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllowanceLine } from "@/components/allowance-line";
import { refreshAllowance } from "@/lib/rewrite/allowance-store";
import { announceSignedIn } from "@/lib/signed-in";
import { hydrateAfter, renderWithIntl } from "./render";

const VISITOR = { limit: 5, used: null, open: true };
const member = (used: number, limit = 5) => ({ limit, used, open: true });

const answering = (allowance: unknown) => {
  const fetchMock = vi.fn(async () => Response.json({ allowance }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const settled = () => act(async () => {});

async function show(allowance: unknown, locale: "en" | "fr" = "en") {
  const fetchMock = answering(allowance);
  const { container } = renderWithIntl(<AllowanceLine />, locale);
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await settled();
  return { line: container.querySelector("p")!, fetchMock };
}

afterEach(async () => {
  answering(null);
  await act(() => refreshAllowance());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the line about the limits", () => {
  describe("for a visitor", () => {
    it.each([
      ["en", 5, "Up to 5 free rewrites a day with an email address."],
      ["en", 1, "Up to 1 free rewrite a day with an email address."],
      [
        "fr",
        5,
        "Jusqu'à 5 réécritures gratuites par jour avec une adresse e-mail.",
      ],
      [
        "fr",
        1,
        "Jusqu'à 1 réécriture gratuite par jour avec une adresse e-mail.",
      ],
    ] as const)("in %s, with a limit of %i", async (locale, limit, words) => {
      const { line } = await show({ ...VISITOR, limit }, locale);
      expect(line).toHaveTextContent(words);
    });
  });

  describe("for an account", () => {
    it.each([
      [
        "en",
        member(2),
        /^You have up to 3 of 5 attempts left today\. Resets at /,
      ],
      [
        "en",
        member(4),
        /^You have up to 1 of 5 attempts left today\. Resets at /,
      ],
      ["en", member(5), /^No attempts left today\. Resets at /],
      [
        "fr",
        member(2),
        /^Il vous reste au plus 3 tentatives sur 5 aujourd'hui\. Réinitialisation à /,
      ],
      [
        "fr",
        member(4),
        /^Il vous reste au plus 1 tentative sur 5 aujourd'hui\. Réinitialisation à /,
      ],
      [
        "fr",
        member(5),
        /^Plus aucune tentative aujourd'hui\. Réinitialisation à /,
      ],
    ] as const)(
      "in %s, says what is left: %j",
      async (locale, allowance, words) => {
        const { line } = await show(allowance, locale);
        expect(line.textContent).toMatch(words);
      },
    );

    // The limits can be lowered while a day's count stands above them
    it("never counts below nothing", async () => {
      const { line } = await show(member(7));
      expect(line.textContent).toMatch(/^No attempts left today/);
    });

    it.each([
      [
        "in winter",
        "en",
        "2026-01-15T12:00:00Z",
        /Resets at 1:00\sAM GMT\+1\.$/,
      ],
      [
        "in summer",
        "en",
        "2026-07-15T12:00:00Z",
        /Resets at 2:00\sAM GMT\+2\.$/,
      ],
      [
        "in winter",
        "fr",
        "2026-01-15T12:00:00Z",
        /Réinitialisation à 01:00\sUTC\+1\.$/,
      ],
      [
        "in summer",
        "fr",
        "2026-07-15T12:00:00Z",
        /Réinitialisation à 02:00\sUTC\+2\.$/,
      ],
    ] as const)(
      "gives the next UTC midnight in the site's zone, %s, in %s",
      async (_, locale, now, words) => {
        vi.useFakeTimers({ toFake: ["Date"], now: new Date(now) });
        const { line } = await show(member(1), locale);
        expect(line.textContent).toMatch(words);
      },
    );
  });

  describe("while rewriting is paused", () => {
    it.each([
      [
        "a visitor",
        "en",
        { ...VISITOR, open: false },
        "Rewriting is paused for now.",
      ],
      [
        "an account",
        "en",
        { ...member(1), open: false },
        "Rewriting is paused for now.",
      ],
      [
        "a visitor",
        "fr",
        { ...VISITOR, open: false },
        "La réécriture est en pause pour le moment.",
      ],
      [
        "an account",
        "fr",
        { ...member(1), open: false },
        "La réécriture est en pause pour le moment.",
      ],
    ] as const)(
      "tells %s so, in %s, and nothing else",
      async (_, locale, allowance, words) => {
        const { line } = await show(allowance, locale);
        expect(line.textContent).toBe(words);
      },
    );
  });

  it("says nothing when the site cannot say", async () => {
    const { line } = await show(null);
    expect(line).toBeEmptyDOMElement();
  });

  // Its place is taken before the words come: the editor under it must not move when they do
  it("holds its height while it is empty, with room for the lines a phone needs", async () => {
    const { line } = await show(null);
    expect(line).toHaveClass("min-h-15", "min-[336px]:min-h-10", "sm:min-h-5");
  });

  it("is empty on the server and over it, so a full load has nothing to mismatch", async () => {
    answering(member(1));
    await act(() => refreshAllowance());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const errors = vi.spyOn(console, "error");
    let served: string | null | undefined;
    hydrateAfter(
      (page) => {
        served = page.textContent;
      },
      <AllowanceLine />,
    );
    await settled();
    expect(served).toBe("");
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  describe("for a screen reader", () => {
    it("becomes a live region only once it has words, so that only changes are spoken", async () => {
      const answer = Promise.withResolvers<Response>();
      vi.stubGlobal(
        "fetch",
        vi.fn(() => answer.promise),
      );
      const { container } = renderWithIntl(<AllowanceLine />);
      const line = container.querySelector("p")!;
      expect(line).not.toHaveAttribute("aria-live");
      await act(async () => {
        answer.resolve(Response.json({ allowance: member(1) }));
      });
      expect(line).toHaveTextContent("up to 4 of 5");
      expect(line).toHaveAttribute("aria-live", "polite");
      expect(line).toHaveAttribute("aria-atomic", "true");
    });

    it("is not a live region when there is nothing to say", async () => {
      const { line } = await show(null);
      expect(line).not.toHaveAttribute("aria-live");
    });
  });

  describe("when a session arrives on the page", () => {
    it("asks again if it showed the visitor's line", async () => {
      const { line, fetchMock } = await show(VISITOR);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fetchMock.mockImplementation(async () =>
        Response.json({ allowance: member(0) }),
      );
      await act(async () => announceSignedIn());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(line).toHaveTextContent("up to 5 of 5");
    });

    // The account panel announces itself each time it appears
    it("asks nothing more when it already showed the account's", async () => {
      const { fetchMock } = await show(member(1));
      await act(async () => announceSignedIn());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops listening once it is gone", async () => {
      const fetchMock = answering(VISITOR);
      const { unmount } = renderWithIntl(<AllowanceLine />);
      await settled();
      unmount();
      await act(async () => announceSignedIn());
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("offers nothing to press, and stops no one", async () => {
    const { line } = await show({ ...VISITOR, open: false });
    expect(line.querySelector("a, button, input")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
