import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ReviewBar } from "@/components/review-bar";
import { renderWithIntl } from "./render";

const bar = (
  writing: boolean,
  total: number,
  accepted: number,
  props: Partial<ComponentProps<typeof ReviewBar>> = {},
) => (
  <ReviewBar
    writing={writing}
    total={total}
    accepted={accepted}
    pending={total - accepted}
    canUndo={false}
    onAcceptAll={vi.fn()}
    onRejectAll={vi.fn()}
    onUndo={vi.fn()}
    onNext={vi.fn()}
    onCopy={vi.fn().mockResolvedValue(true)}
    {...props}
  />
);

describe("ReviewBar", () => {
  it.each([
    [0, "0 acceptée, 0 refusée, 3 à décider"],
    [1, "1 acceptée, 0 refusée, 2 à décider"],
    [2, "2 acceptées, 0 refusée, 1 à décider"],
  ])("counts %i accepted in French", (accepted, expected) => {
    renderWithIntl(bar(false, 3, accepted), "fr");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("says what is accepted, what is rejected and what is left", () => {
    renderWithIntl(bar(false, 6, 2, { pending: 1 }));
    expect(
      screen.getByText("2 accepted, 3 rejected, 1 to decide"),
    ).toBeInTheDocument();
  });

  it("agrees the rejected count in French", () => {
    renderWithIntl(bar(false, 6, 0, { pending: 2 }), "fr");
    expect(
      screen.getByText("0 acceptée, 4 refusées, 2 à décider"),
    ).toBeInTheDocument();
  });

  it.each([
    [1, "1 modification pour l'instant"],
    [2, "2 modifications pour l'instant"],
  ])("counts %i edits so far in French", (total, expected) => {
    renderWithIntl(bar(true, total, 0), "fr");
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it("only pulses for readers who have not asked for less motion", () => {
    const { container } = renderWithIntl(bar(true, 1, 0));
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(
      container.querySelector(".motion-safe\\:animate-pulse"),
    ).not.toBeNull();
  });

  // Counts are spoken from the workspace's one status line
  it("is not a live region of its own", () => {
    const { container } = renderWithIntl(bar(false, 3, 1));
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  describe("the bulk buttons", () => {
    const names = (locale: "en" | "fr", pending: number, accepted = 0) => {
      const page = renderWithIntl(bar(false, 3, accepted, { pending }), locale);
      const words = [...page.container.querySelectorAll("button")]
        .slice(-2)
        .map((button) => button.textContent);
      page.unmount();
      return words;
    };

    it("say all before any decision and once none is left", () => {
      expect(names("en", 3)).toEqual(["Accept all", "Reject all"]);
      expect(names("en", 0, 3)).toEqual(["Accept all", "Reject all"]);
      expect(names("fr", 3)).toEqual(["Tout accepter", "Tout refuser"]);
    });

    it("say the rest while some edits are decided and some are not", () => {
      expect(names("en", 2, 1)).toEqual(["Accept the rest", "Reject the rest"]);
      expect(names("fr", 1, 2)).toEqual([
        "Accepter le reste",
        "Refuser le reste",
      ]);
    });

    it.each(["Accept all", "Reject all"])(
      "count only the first click of a double click on %s",
      (name) => {
        const onAcceptAll = vi.fn();
        const onRejectAll = vi.fn();
        renderWithIntl(bar(false, 3, 0, { onAcceptAll, onRejectAll }));
        const button = screen.getByRole("button", { name });
        fireEvent.click(button, { detail: 2 });
        expect(onAcceptAll).not.toHaveBeenCalled();
        expect(onRejectAll).not.toHaveBeenCalled();
        fireEvent.click(button, { detail: 1 });
        expect(
          onAcceptAll.mock.calls.length + onRejectAll.mock.calls.length,
        ).toBe(1);
      },
    );

    it("wait for the full answer", () => {
      renderWithIntl(bar(true, 3, 0));
      expect(screen.getByRole("button", { name: "Accept all" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Reject all" })).toBeDisabled();
    });
  });

  describe("the undo control", () => {
    const control = () =>
      screen.getByRole("button", { name: "Undo last decision" });

    it("takes back a step when there is one", () => {
      const onUndo = vi.fn();
      renderWithIntl(bar(false, 3, 1, { canUndo: true, onUndo }));
      expect(control()).toHaveAttribute("aria-disabled", "false");
      fireEvent.click(control(), { detail: 1 });
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it("stays on the page and focusable with nothing to undo, and does nothing", () => {
      const onUndo = vi.fn();
      renderWithIntl(bar(false, 3, 0, { canUndo: false, onUndo }));
      expect(control()).toHaveAttribute("aria-disabled", "true");
      expect(control()).toBeEnabled();
      fireEvent.click(control(), { detail: 1 });
      expect(onUndo).not.toHaveBeenCalled();
    });

    it("counts only the first click of a double click", () => {
      const onUndo = vi.fn();
      renderWithIntl(bar(false, 3, 1, { canUndo: true, onUndo }));
      fireEvent.click(control(), { detail: 2 });
      expect(onUndo).not.toHaveBeenCalled();
    });

    it("works from the keyboard, which reports no clicks", () => {
      const onUndo = vi.fn();
      renderWithIntl(bar(false, 3, 1, { canUndo: true, onUndo }));
      fireEvent.click(control(), { detail: 0 });
      expect(onUndo).toHaveBeenCalledTimes(1);
    });

    it("works while the model writes: a decision can be made by then", () => {
      const onUndo = vi.fn();
      renderWithIntl(bar(true, 3, 1, { canUndo: true, onUndo }));
      fireEvent.click(control(), { detail: 1 });
      expect(onUndo).toHaveBeenCalledTimes(1);
    });
  });

  describe("the sticky row", () => {
    const row = (container: HTMLElement) =>
      container.querySelector<HTMLElement>(".sticky")!;

    it("stays at the top of the screen, on a background nothing shows through", () => {
      const { container } = renderWithIntl(bar(false, 3, 1));
      expect(row(container)).toHaveClass("sticky", "top-0", "bg-surface");
    });

    // The cards keep 96 px free above them for this row, and a second row of buttons would not fit
    it("holds the two buttons at hand, and leaves the bulk buttons in the page", () => {
      const { container } = renderWithIntl(bar(false, 3, 1));
      const inRow = within(row(container));
      expect(inRow.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "Next to decide",
        "Copy",
      ]);
      expect(inRow.queryByText("Undo last decision")).toBeNull();
      expect(inRow.queryByText("Accept the rest")).toBeNull();
    });

    it("is a direct child of the review, or it could not travel with it", () => {
      const { container } = renderWithIntl(<div>{bar(false, 3, 1)}</div>);
      expect(row(container).parentElement).toBe(container.firstElementChild);
    });

    it("never wraps its row, and shows the buttons as icons on a phone", () => {
      const { container } = renderWithIntl(bar(false, 3, 1));
      expect(row(container).className).not.toMatch(/flex-wrap/);
      const name = screen.getByText("Next to decide");
      expect(name).toHaveClass("max-sm:sr-only");
    });

    it.each([
      [0, 3, "0%"],
      [1, 2, "33"],
      [3, 0, "100%"],
    ])(
      "measures what is decided, with %i of 3 decided",
      (accepted, pending, width) => {
        const { container } = renderWithIntl(
          bar(false, 3, accepted, { pending }),
        );
        const fill = container.querySelector<HTMLElement>(
          "[aria-hidden] > div",
        )!;
        expect(fill.style.width.startsWith(width)).toBe(true);
      },
    );

    it("fills up when every edit is rejected, not only when accepted", () => {
      const { container } = renderWithIntl(bar(false, 3, 0, { pending: 0 }));
      const fill = container.querySelector<HTMLElement>("[aria-hidden] > div")!;
      expect(fill.style.width).toBe("100%");
    });

    describe("Next to decide", () => {
      const next = () => screen.getByRole("button", { name: "Next to decide" });

      it("moves on, once per click", () => {
        const onNext = vi.fn();
        renderWithIntl(bar(false, 3, 1, { onNext }));
        fireEvent.click(next(), { detail: 1 });
        fireEvent.click(next(), { detail: 2 });
        expect(onNext).toHaveBeenCalledTimes(2);
      });

      it.each([
        ["nothing is left to decide", false, 3, 0],
        ["the model is still writing", true, 3, 3],
      ])(
        "does nothing while %s, and stays focusable",
        (_, writing, total, pending) => {
          const onNext = vi.fn();
          renderWithIntl(bar(writing, total, 3 - pending, { pending, onNext }));
          expect(next()).toHaveAttribute("aria-disabled", "true");
          expect(next()).toBeEnabled();
          fireEvent.click(next(), { detail: 1 });
          expect(onNext).not.toHaveBeenCalled();
        },
      );
    });

    describe("Copy", () => {
      it("ignores the second click of a double click", () => {
        const onCopy = vi.fn().mockResolvedValue(true);
        renderWithIntl(bar(false, 3, 1, { onCopy }));
        fireEvent.click(screen.getByRole("button", { name: "Copy" }), {
          detail: 2,
        });
        expect(onCopy).not.toHaveBeenCalled();
      });

      const copy = () =>
        screen.getByRole("button", { name: /^(Copy|Copied)$/ });

      it("says it worked once the text has reached the clipboard", async () => {
        const onCopy = vi.fn().mockResolvedValue(true);
        renderWithIntl(bar(false, 3, 1, { onCopy }));
        fireEvent.click(copy());
        expect(await screen.findByText("Copied")).toBeInTheDocument();
        expect(onCopy).toHaveBeenCalledTimes(1);
      });

      it("does not claim it worked when it did not", async () => {
        const onCopy = vi.fn().mockResolvedValue(false);
        renderWithIntl(bar(false, 3, 1, { onCopy }));
        fireEvent.click(copy());
        await waitFor(() => expect(onCopy).toHaveBeenCalled());
        await Promise.resolve();
        expect(screen.queryByText("Copied")).toBeNull();
      });

      it("works while the model writes: the result is there", () => {
        const onCopy = vi.fn().mockResolvedValue(true);
        renderWithIntl(bar(true, 3, 0, { onCopy }));
        fireEvent.click(copy());
        expect(onCopy).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("the line about what is left undecided", () => {
    it.each([
      ["en", 1, "The edit still to decide keeps the original wording."],
      ["en", 2, "The 2 edits still to decide keep the original wording."],
      ["fr", 1, "La modification encore à décider garde le texte d'origine."],
      [
        "fr",
        2,
        "Les 2 modifications encore à décider gardent le texte d'origine.",
      ],
    ] as const)("says so in %s for %i edits", (locale, pending, expected) => {
      renderWithIntl(bar(false, 3, 3 - pending, { pending }), locale);
      expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it("is gone once nothing is left to decide", () => {
      renderWithIntl(bar(false, 3, 3, { pending: 0 }));
      expect(screen.queryByText(/original wording/)).toBeNull();
    });

    it("waits for the full answer", () => {
      renderWithIntl(bar(true, 3, 0));
      expect(screen.queryByText(/original wording/)).toBeNull();
    });
  });

  describe("the list of shortcuts", () => {
    it("says all six, in both languages", () => {
      const first = renderWithIntl(bar(false, 3, 0));
      expect(screen.getByText(/E reword, U undo/)).toBeInTheDocument();
      first.unmount();
      renderWithIntl(bar(false, 3, 0), "fr");
      expect(screen.getByText(/E reformuler, U annuler/)).toBeInTheDocument();
    });

    it("is left out on a device that cannot hover", () => {
      renderWithIntl(bar(false, 3, 0));
      expect(screen.getByText(/A accept, R reject/)).toHaveClass(
        "[@media(hover:none)]:hidden",
      );
    });

    it("waits for the full answer, as the keys do", () => {
      renderWithIntl(bar(true, 3, 0));
      expect(screen.queryByText(/A accept, R reject/)).toBeNull();
    });
  });
});
