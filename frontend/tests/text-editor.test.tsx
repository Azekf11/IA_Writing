import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS, RewriteOptions } from "@/components/rewrite-options";
import { TextEditor } from "@/components/text-editor";
import { MAX_CHARS, MAX_CHECK_CHARS } from "@/lib/text";
import { hydrateAfter, renderWithIntl } from "./render";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function Page() {
  const [value, setValue] = useState("");
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  return (
    <TextEditor
      value={value}
      onChange={setValue}
      onSubmit={vi.fn()}
      options={options}
      onOptionsChange={setOptions}
    />
  );
}

const main = (page: HTMLElement) =>
  page.querySelector<HTMLTextAreaElement>("textarea")!;
const sample = (page: HTMLElement) =>
  page.querySelectorAll<HTMLTextAreaElement>("textarea")[1];

describe("TextEditor", () => {
  // Announced on every keystroke, they drowned out everything else
  it("does not speak the counters as they change, and ties them to the box", () => {
    const { container } = renderWithIntl(
      <TextEditor value="hello big world" onChange={vi.fn()} />,
    );
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(screen.getByLabelText("Your text")).toHaveAccessibleDescription(
      "3 words · 15 / 5,000 characters",
    );
  });

  describe("the way back to a review", () => {
    const back = () =>
      screen.queryByRole("button", { name: "Back to the review" });

    it("is offered only when the page has one", () => {
      const first = renderWithIntl(<TextEditor value="x" onChange={vi.fn()} />);
      expect(back()).toBeNull();
      first.unmount();
      renderWithIntl(
        <TextEditor value="x" onChange={vi.fn()} onResume={vi.fn()} />,
      );
      expect(back()).toBeInTheDocument();
    });

    it("says so in French", () => {
      renderWithIntl(
        <TextEditor value="x" onChange={vi.fn()} onResume={vi.fn()} />,
        "fr",
      );
      expect(
        screen.getByRole("button", { name: "Revenir à la relecture" }),
      ).toBeInTheDocument();
    });

    it("does not send the form", async () => {
      const onSubmit = vi.fn();
      const onResume = vi.fn();
      renderWithIntl(
        <TextEditor
          value="x"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          onResume={onResume}
        />,
      );
      await userEvent.click(back()!);
      expect(onResume).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // It comes where the button that led to the editor was
    it("does not count the second click of a double click", () => {
      const onResume = vi.fn();
      renderWithIntl(
        <TextEditor value="x" onChange={vi.fn()} onResume={onResume} />,
      );
      fireEvent.click(back()!, { detail: 2 });
      expect(onResume).not.toHaveBeenCalled();
    });

    it("leaves the name of the box alone", () => {
      renderWithIntl(
        <TextEditor value="x" onChange={vi.fn()} onResume={vi.fn()} />,
      );
      expect(screen.getByLabelText("Your text").tagName).toBe("TEXTAREA");
    });
  });

  describe("the focus", () => {
    // A browser drops the focus of a button that becomes disabled: it falls to the page. jsdom
    // leaves it on the button, so the tests move it there by hand, as the button is disabled.
    const dropFocus = () => (document.activeElement as HTMLElement).blur();
    const REFUSED = "Sign in to rewrite your text.";

    it("comes back to Rewrite when the request it sent fails", async () => {
      const editor = (props: object) => (
        <TextEditor
          value="hello"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onCheck={vi.fn()}
          {...props}
        />
      );
      const page = renderWithIntl(editor({}));
      const rewrite = screen.getByRole("button", { name: "Rewrite" });
      await userEvent.click(rewrite);
      dropFocus();
      page.rerender(editor({ status: "loading" }));
      page.rerender(editor({ error: REFUSED }));
      expect(rewrite).toHaveFocus();
      // The focus lands there as the message arrives, and can cut it off
      expect(rewrite).toHaveAccessibleDescription(REFUSED);
    });

    it("comes back to the free check when that is what failed", async () => {
      const editor = (props: object) => (
        <TextEditor
          value="hello"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          onCheck={vi.fn()}
          {...props}
        />
      );
      const page = renderWithIntl(editor({}));
      const check = screen.getByRole("button", { name: "Free check" });
      await userEvent.click(check);
      dropFocus();
      page.rerender(editor({ status: "checking" }));
      page.rerender(editor({ error: "Network error." }));
      expect(check).toHaveFocus();
    });

    it("stays where the reader has put it since", async () => {
      const page = renderWithIntl(
        <TextEditor value="hello" onChange={vi.fn()} onSubmit={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
      const box = screen.getByLabelText("Your text");
      box.focus();
      page.rerender(
        <TextEditor
          value="hello"
          onChange={vi.fn()}
          onSubmit={vi.fn()}
          error={REFUSED}
        />,
      );
      expect(box).toHaveFocus();
    });

    it("stays where it is when the editor first appears", () => {
      renderWithIntl(<TextEditor value="" onChange={vi.fn()} />);
      expect(screen.getByLabelText("Your text")).not.toHaveFocus();
    });

    it("comes to the box when the page asks, once", () => {
      const page = renderWithIntl(
        <TextEditor value="" onChange={vi.fn()} focusOnOpen />,
      );
      const box = screen.getByLabelText("Your text");
      expect(box).toHaveFocus();
      box.blur();
      page.rerender(<TextEditor value="more" onChange={vi.fn()} focusOnOpen />);
      expect(box).not.toHaveFocus();
    });
  });

  it("shows the word and character count", () => {
    renderWithIntl(<TextEditor value="hello big world" onChange={vi.fn()} />);
    expect(screen.getByText(/3 words/)).toBeInTheDocument();
    expect(screen.getByText("15 / 5,000 characters")).toBeInTheDocument();
  });

  it("renders in French", () => {
    renderWithIntl(<TextEditor value="un" onChange={vi.fn()} />, "fr");
    expect(screen.getByLabelText("Votre texte")).toBeInTheDocument();
    expect(screen.getByText(/1 mot/)).toBeInTheDocument();
  });

  // As the free check's limit is written, in the way of the reader's language
  it.each([
    ["en", "4,500 / 5,000 characters", "The limit is 5,000 characters."],
    ["fr", "4 500 / 5 000 caractères", "La limite est de 5 000 caractères."],
  ] as const)(
    "writes its numbers as the free check's limit is written, in %s",
    (locale, counter, limit) => {
      const page = renderWithIntl(
        <TextEditor value={"a".repeat(4_500)} onChange={vi.fn()} />,
        locale,
      );
      expect(screen.getByText(/(characters|caractères)$/).textContent).toBe(
        counter,
      );
      page.unmount();
      renderWithIntl(
        <TextEditor value={"a".repeat(MAX_CHARS + 1)} onChange={vi.fn()} />,
        locale,
      );
      expect(screen.getByRole("alert").textContent).toContain(limit);
    },
  );

  it.each([
    ["en", /goes to Anthropic.*until you delete it/, "Privacy"],
    [
      "fr",
      /envoy\u00e9 \u00e0 Anthropic.*le supprimiez/,
      "Confidentialit\u00e9",
    ],
  ] as const)(
    "says where the text goes and links to the privacy page, in %s",
    (locale, notice, link) => {
      renderWithIntl(<TextEditor value="" onChange={vi.fn()} />, locale);
      const line = screen.getByText(notice);
      expect(within(line).getByRole("link", { name: link })).toHaveAttribute(
        "href",
        "/privacy",
      );
      // Under the button, as the last thing in the editor
      expect(line.closest("form")!.lastElementChild).toBe(line);
    },
  );

  it("tells the page what the box holds once it is there, once", () => {
    const onReady = vi.fn();
    const page = renderWithIntl(
      <TextEditor value="Held" onChange={vi.fn()} onReady={onReady} />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith("Held");
    page.rerender(
      <TextEditor value="Held more" onChange={vi.fn()} onReady={onReady} />,
    );
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("counts what was typed before the scripts arrived as held", () => {
    const onReady = vi.fn();
    hydrateAfter(
      (page) => {
        main(page).value = "Typed early";
      },
      <TextEditor value="" onChange={vi.fn()} onReady={onReady} />,
    );
    expect(onReady).toHaveBeenCalledWith("Typed early");
  });

  it("reports typing to the parent", async () => {
    const onChange = vi.fn();
    renderWithIntl(<TextEditor value="" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Your text"), "a");
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("takes in what was typed before the scripts arrived", async () => {
    hydrateAfter(
      (page) => {
        main(page).value = "Typed before the scripts";
      },
      <Page />,
    );
    await waitFor(() =>
      expect(screen.getByText(/4 words/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Rewrite/ })).toBeEnabled();
    expect(screen.getByLabelText("Your text")).toHaveValue(
      "Typed before the scripts",
    );
  });

  it("takes in a writing sample typed before the scripts arrived, along with the text", async () => {
    hydrateAfter(
      (page) => {
        main(page).value = "Typed before the scripts";
        sample(page).value = "A sample of mine";
      },
      <Page />,
    );
    await waitFor(() =>
      expect(screen.getByText(/16 \/ 1,500/)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/Your own writing/)).toHaveValue(
      "A sample of mine",
    );
    expect(screen.getByLabelText("Your text")).toHaveValue(
      "Typed before the scripts",
    );
    expect(screen.getByText(/4 words/)).toBeInTheDocument();
  });

  describe("text the browser puts back on Back", () => {
    afterEach(() => vi.restoreAllMocks());

    it("is taken in after the page has loaded, when that comes after hydration", async () => {
      // A late part of the page keeps it open: hydration runs first, the browser's step after it
      const state = vi
        .spyOn(document, "readyState", "get")
        .mockReturnValue("interactive");
      const { container } = hydrateAfter(() => {}, <Page />);
      await new Promise((resolve) => setTimeout(resolve, 5));
      main(container).value = "Put back by the browser";
      sample(container).value = "A sample of mine";
      expect(screen.getByText(/0 words/)).toBeInTheDocument();
      state.mockReturnValue("complete");
      window.dispatchEvent(new Event("load"));
      await waitFor(() =>
        expect(screen.getByText(/5 words/)).toBeInTheDocument(),
      );
      expect(screen.getByText(/16 \/ 1,500/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("radio", { name: "Thorough" }));
      expect(main(container)).toHaveValue("Put back by the browser");
      expect(sample(container)).toHaveValue("A sample of mine");
    });

    it("does not read the box again for a value it has moved on from", async () => {
      vi.spyOn(document, "readyState", "get").mockReturnValue("interactive");
      const onChange = vi.fn();
      const page = renderWithIntl(<TextEditor value="a" onChange={onChange} />);
      page.rerender(<TextEditor value="b" onChange={onChange} />);
      window.dispatchEvent(new Event("load"));
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(onChange).not.toHaveBeenCalled();
    });

    it("is taken in when hydration comes just after the load event", async () => {
      const { container } = hydrateAfter(() => {}, <Page />);
      main(container).value = "Put back by the browser";
      await waitFor(() =>
        expect(screen.getByText(/5 words/)).toBeInTheDocument(),
      );
    });
  });

  it("does not lose a sample typed early to the next change", async () => {
    const { container } = hydrateAfter(
      (page) => {
        sample(page).value = "A sample of mine";
      },
      <Page />,
    );
    await userEvent.type(main(container), "x");
    expect(sample(container)).toHaveValue("A sample of mine");
    expect(screen.getByText(/16 \/ 1,500/)).toBeInTheDocument();
  });

  it("disables submit when the text is empty", () => {
    renderWithIntl(
      <TextEditor value="   " onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Rewrite" })).toBeDisabled();
  });

  it("blocks submit and warns when the text is too long", () => {
    renderWithIntl(
      <TextEditor
        value={"a".repeat(MAX_CHARS + 1)}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("too long");
    expect(screen.getByRole("button", { name: "Rewrite" })).toBeDisabled();
  });

  it("measures a text as it will be sent, with accents in one form", () => {
    // 4,500 letters in one form, 9,000 as pasted with separate accents
    const pasted = "é".normalize("NFD").repeat(4_500);
    expect(pasted.length).toBe(9_000);
    renderWithIntl(
      <TextEditor value={pasted} onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText("4,500 / 5,000 characters")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /rewrite/i })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits valid text", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <TextEditor value="hello" onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rewrite" }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("locks the form while loading", () => {
    renderWithIntl(
      <TextEditor
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="loading"
      />,
    );
    expect(screen.getByRole("button", { name: "Rewriting..." })).toBeDisabled();
    expect(screen.getByLabelText("Your text")).toHaveAttribute("readonly");
  });

  // The button says it already, and bars over the box hid the last lines of the text
  it("draws nothing over the text while it waits", () => {
    const { container } = renderWithIntl(
      <TextEditor
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="loading"
      />,
    );
    expect(screen.getByLabelText("Your text").nextElementSibling).toBeNull();
    expect(container.querySelector(".skeleton")).toBeNull();
    expect(screen.getByRole("button", { name: "Rewriting..." })).toBeDisabled();
  });

  it("shows an error passed by the parent", () => {
    renderWithIntl(
      <TextEditor value="hello" onChange={vi.fn()} error="Something broke" />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });

  it("submits with Ctrl+Enter when the text is valid", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <TextEditor value="Some text" onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    screen.getByLabelText("Your text").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("ignores Ctrl+Enter when the text is empty", async () => {
    const onSubmit = vi.fn();
    renderWithIntl(
      <TextEditor value="" onChange={vi.fn()} onSubmit={onSubmit} />,
    );
    screen.getByLabelText("Your text").focus();
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("offers a sample text when the editor is empty", async () => {
    const onExample = vi.fn();
    renderWithIntl(
      <TextEditor value="" onChange={vi.fn()} onExample={onExample} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Try an example" }),
    );
    expect(onExample).toHaveBeenCalledTimes(1);
  });

  it("only spins for readers who have not asked for less motion", () => {
    const { container } = renderWithIntl(
      <TextEditor
        value="hello"
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        status="loading"
      />,
    );
    expect(container.querySelector(".animate-spin")).toBeNull();
    expect(
      container.querySelector(".motion-safe\\:animate-spin"),
    ).not.toBeNull();
  });

  describe("the options", () => {
    const summary = (page: HTMLElement) => page.querySelector("summary")!;

    it("look like something that opens", () => {
      const { container } = renderWithIntl(<Page />);
      expect(summary(container).querySelector("svg")).toHaveClass(
        "group-open:rotate-180",
      );
    });

    it("change the intensity with the arrow keys", async () => {
      renderWithIntl(<Page />);
      screen.getByRole("radio", { name: "Standard" }).focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(screen.getByRole("radio", { name: "Thorough" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "Thorough" })).toHaveFocus();
    });

    // As the main counter writes its numbers, in the way of the reader's language
    it.each([
      ["en", /Your own writing/, "16 / 1,500"],
      ["fr", /Votre propre écriture/, "16 / 1 500"],
    ] as const)(
      "write the writing sample's counter as the main one, in %s",
      async (locale, label, counter) => {
        renderWithIntl(<Page />, locale);
        await userEvent.type(screen.getByLabelText(label), "A sample of mine");
        expect(screen.getByText(/^16 \//).textContent).toBe(counter);
      },
    );

    // A screen reader reaches the box without the line beside it, which says where the sample goes
    it("tie the writing sample's hint and counter to its box", () => {
      renderWithIntl(<Page />);
      expect(
        screen.getByLabelText(/Your own writing/),
      ).toHaveAccessibleDescription(/not saved\..*0 \/ 1,500/);
    });

    // The arrow keys move the focus from one segment to the next, and a screen reader's own cursor
    // reaches a segment without choosing it: each says what it does itself, chosen or not
    it("say what each intensity changes on the segment itself", async () => {
      renderWithIntl(<Page />);
      const light = screen.getByRole("radio", { name: "Light" });
      const standard = screen.getByRole("radio", { name: "Standard" });
      const thorough = screen.getByRole("radio", { name: "Thorough" });
      expect(standard).toHaveAccessibleDescription(/Obvious stock phrases/);
      expect(light).toHaveAccessibleDescription(
        "Only the most obvious stock phrases.",
      );
      expect(thorough).toHaveAccessibleDescription(
        "Subtler stock phrases and flat wording too.",
      );
      standard.focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(thorough).toHaveAccessibleDescription(/flat wording/);
      expect(standard).toHaveAccessibleDescription(
        "Obvious stock phrases, and subtler ones when they pile up.",
      );
      expect(light).toHaveAccessibleDescription(
        "Only the most obvious stock phrases.",
      );
    });

    it("say what each intensity changes in French too", () => {
      renderWithIntl(<Page />, "fr");
      expect(
        screen.getByRole("radio", { name: "Léger" }),
      ).toHaveAccessibleDescription(
        "Seulement les formules toutes faites les plus évidentes.",
      );
      expect(
        screen.getByRole("radio", { name: "Standard" }),
      ).toHaveAccessibleDescription(
        "Les formules évidentes, et les plus discrètes quand elles s'accumulent.",
      );
      expect(
        screen.getByRole("radio", { name: "Poussé" }),
      ).toHaveAccessibleDescription(
        "Aussi les formules discrètes et les tournures plates.",
      );
    });

    // The others are there for the segments only: the page does not read them a second time
    it("show only the hint of the chosen intensity", async () => {
      const { container } = renderWithIntl(<Page />);
      await userEvent.click(summary(container));
      expect(
        screen.getByText(
          "Obvious stock phrases, and subtler ones when they pile up.",
          { selector: "p" },
        ),
      ).toBeVisible();
      expect(
        screen.getByText("Only the most obvious stock phrases."),
      ).not.toBeVisible();
      expect(
        screen.getByText("Subtler stock phrases and flat wording too."),
      ).not.toBeVisible();
    });

    // An attempt counts against the day's limit: choosing an intensity must not spend one
    it("do not send the text when Enter is pressed on an intensity", async () => {
      const onSubmit = vi.fn();
      renderWithIntl(
        <TextEditor
          value="hello"
          onChange={vi.fn()}
          onSubmit={onSubmit}
          options={DEFAULT_OPTIONS}
          onOptionsChange={vi.fn()}
        />,
      );
      screen.getByRole("radio", { name: "Thorough" }).focus();
      await userEvent.keyboard("{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("name the writing sample in short in their summary", async () => {
      const { container } = renderWithIntl(<Page />);
      expect(summary(container)).toHaveTextContent("OptionsStandard");
      await userEvent.type(
        screen.getByLabelText(/Your own writing/),
        "My own words",
      );
      expect(summary(container)).toHaveTextContent(
        "Standard · Your own writing",
      );
    });

    describe("the choice not to keep the text", () => {
      const NAME = "Do not keep this text in my history";
      const tick = () => screen.getByRole("checkbox", { name: NAME });
      const box = (page: HTMLElement) =>
        page.querySelector<HTMLInputElement>("input[type=checkbox]")!;

      it("is off until the writer ticks it, and comes off again", async () => {
        renderWithIntl(<Page />);
        expect(tick()).not.toBeChecked();
        await userEvent.click(tick());
        expect(tick()).toBeChecked();
        await userEvent.click(tick());
        expect(tick()).not.toBeChecked();
      });

      it("says what it does not do", () => {
        renderWithIntl(<Page />);
        expect(tick()).toHaveAccessibleDescription(
          /still goes to Anthropic.*still counts.*only on this page/,
        );
      });

      it("shows in the summary while ticked", async () => {
        const { container } = renderWithIntl(<Page />);
        await userEvent.click(tick());
        expect(summary(container)).toHaveTextContent("Standard · Not kept");
      });

      it("changes the line under the editor while ticked", async () => {
        const { container } = renderWithIntl(<Page />);
        const notice = () => container.querySelector("form")!.lastElementChild!;
        expect(notice()).toHaveTextContent("history until you delete it");
        await userEvent.click(tick());
        expect(notice()).toHaveTextContent("not added to your history");
        expect(notice()).not.toHaveTextContent("until you delete it");
        expect(notice()).toHaveTextContent("goes to Anthropic");
        expect(
          within(notice() as HTMLElement).getByRole("link"),
        ).toHaveTextContent("Privacy");
      });

      // The box sits inside the form: Enter would send the text with the box still unticked, which
      // spends an attempt and keeps the text
      it("does not send the text when Enter is pressed on it", async () => {
        const onSubmit = vi.fn();
        renderWithIntl(
          <TextEditor
            value="hello there"
            onChange={vi.fn()}
            onSubmit={onSubmit}
            options={DEFAULT_OPTIONS}
            onOptionsChange={vi.fn()}
          />,
        );
        tick().focus();
        await userEvent.keyboard("{Enter}");
        expect(onSubmit).not.toHaveBeenCalled();
        expect(tick()).not.toBeChecked();
        expect(tick()).toHaveFocus();
      });

      it("still ticks with Space", async () => {
        renderWithIntl(<Page />);
        tick().focus();
        await userEvent.keyboard(" ");
        expect(tick()).toBeChecked();
      });

      it("cannot be changed while a rewrite is running", () => {
        renderWithIntl(
          <TextEditor
            value="hello"
            onChange={vi.fn()}
            options={DEFAULT_OPTIONS}
            onOptionsChange={vi.fn()}
            status="loading"
          />,
        );
        expect(tick()).toBeDisabled();
      });

      // The page says it will not be kept: the state must say so too, or the text is saved
      it("takes in a box ticked before the scripts arrived, along with a sample", async () => {
        const { container } = hydrateAfter(
          (page) => {
            sample(page).value = "A sample of mine";
            box(page).checked = true;
          },
          <Page />,
        );
        await waitFor(() =>
          expect(summary(container)).toHaveTextContent("Not kept"),
        );
        expect(summary(container)).toHaveTextContent("Your own writing");
        expect(box(container)).toBeChecked();
        expect(screen.getByText(/16 \/ 1,500/)).toBeInTheDocument();
      });

      // Both report at the same moment: whichever comes last must not undo the other
      it("reports only its own field, as the writing sample does", async () => {
        const onChange = vi.fn();
        hydrateAfter(
          (page) => {
            main(page).value = "A sample of mine";
            box(page).checked = true;
          },
          <RewriteOptions value={DEFAULT_OPTIONS} onChange={onChange} />,
        );
        await waitFor(() =>
          expect(onChange.mock.calls.length).toBeGreaterThanOrEqual(2),
        );
        const [first, second] = onChange.mock.calls.map(([update]) => update);
        for (const updates of [
          [first, second],
          [second, first],
        ]) {
          expect(
            updates.reduce((state, update) => update(state), DEFAULT_OPTIONS),
          ).toEqual({
            ...DEFAULT_OPTIONS,
            voice: "A sample of mine",
            keep: false,
          });
        }
      });

      it("keeps a box ticked early through the next change", async () => {
        const { container } = hydrateAfter(
          (page) => {
            box(page).checked = true;
          },
          <Page />,
        );
        await userEvent.type(main(container), "x");
        expect(box(container)).toBeChecked();
        expect(summary(container)).toHaveTextContent("Not kept");
      });

      it("takes in a tick the browser puts back after the page has loaded", async () => {
        const state = vi
          .spyOn(document, "readyState", "get")
          .mockReturnValue("interactive");
        const { container } = hydrateAfter(() => {}, <Page />);
        await new Promise((resolve) => setTimeout(resolve, 5));
        box(container).checked = true;
        state.mockReturnValue("complete");
        window.dispatchEvent(new Event("load"));
        await waitFor(() =>
          expect(summary(container)).toHaveTextContent("Not kept"),
        );
        state.mockRestore();
      });
    });

    it("keep iOS from zooming on the sample, with a placeholder that reads", () => {
      renderWithIntl(<Page />);
      const box = screen.getByLabelText(/Your own writing/);
      expect(box).toHaveClass("max-sm:text-base", "placeholder:text-muted");
      expect(box.className).not.toContain("placeholder:text-muted/70");
    });
  });

  it("hides the sample button once there is text", () => {
    renderWithIntl(
      <TextEditor value="typed" onChange={vi.fn()} onExample={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Try an example" })).toBeNull();
  });

  // The review takes its place under the pointer: the second click of a double click lands there
  it("does not open the sample on the second click of a double click", () => {
    const onExample = vi.fn();
    renderWithIntl(
      <TextEditor value="" onChange={vi.fn()} onExample={onExample} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try an example" }), {
      detail: 2,
    });
    expect(onExample).not.toHaveBeenCalled();
  });

  describe("the free check", () => {
    const check = () => screen.getByRole("button", { name: "Free check" });
    const rewrite = () => screen.getByRole("button", { name: "Rewrite" });
    const editor = (value: string, props = {}) => (
      <TextEditor
        value={value}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCheck={vi.fn()}
        {...props}
      />
    );

    it("is not offered where the page does not handle it", () => {
      renderWithIntl(
        <TextEditor value="typed" onChange={vi.fn()} onSubmit={vi.fn()} />,
      );
      expect(screen.queryByRole("button", { name: "Free check" })).toBeNull();
    });

    it.each(["", "   \n "])("has nothing to look at in %j", (value) => {
      renderWithIntl(editor(value));
      expect(check()).toBeDisabled();
    });

    it("runs on anything in the box", async () => {
      const onCheck = vi.fn();
      renderWithIntl(editor("typed", { onCheck }));
      expect(check()).toBeEnabled();
      await userEvent.click(check());
      expect(onCheck).toHaveBeenCalledTimes(1);
    });

    it("does not send the form: it is not a rewrite", async () => {
      const onSubmit = vi.fn();
      renderWithIntl(editor("typed", { onSubmit }));
      await userEvent.click(check());
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // It costs nothing, so the limit on what the model gets does not apply
    it("still works where a rewrite no longer does", () => {
      renderWithIntl(editor("a".repeat(MAX_CHARS + 1)));
      expect(rewrite()).toBeDisabled();
      expect(check()).toBeEnabled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This text is too long",
      );
    });

    it("works up to its own limit", () => {
      renderWithIntl(editor("a".repeat(MAX_CHECK_CHARS)));
      expect(check()).toBeEnabled();
    });

    it("stops past its own limit, and says that it is its own", () => {
      renderWithIntl(editor("a".repeat(MAX_CHECK_CHARS + 1)));
      expect(check()).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /even for the free check.*50,000 characters/,
      );
    });

    it("says it in French too", () => {
      renderWithIntl(
        <TextEditor
          value={"a".repeat(MAX_CHECK_CHARS + 1)}
          onChange={vi.fn()}
          onCheck={vi.fn()}
        />,
        "fr",
      );
      expect(screen.getByRole("alert")).toHaveTextContent(
        /même pour la vérification gratuite/,
      );
    });

    it("waits for a rewrite under way", () => {
      renderWithIntl(editor("typed", { status: "loading" }));
      expect(check()).toBeDisabled();
    });

    // The next click would act on a text the review is about to replace
    it("cannot be pressed twice, and blocks a rewrite, while it loads", () => {
      renderWithIntl(editor("typed", { status: "checking" }));
      expect(check()).toBeDisabled();
      expect(rewrite()).toBeDisabled();
    });

    it("spins only for readers who have not asked for less motion", () => {
      const { container } = renderWithIntl(
        editor("typed", { status: "checking" }),
      );
      expect(container.querySelector(".lucide-loader-circle")).toHaveClass(
        "motion-safe:animate-spin",
      );
    });

    it("holds the text still while it loads", () => {
      renderWithIntl(editor("typed", { status: "checking" }));
      expect(screen.getByLabelText("Your text")).toHaveAttribute("readonly");
    });

    it("does not send on Ctrl+Enter while it loads", async () => {
      const onSubmit = vi.fn();
      renderWithIntl(editor("typed", { status: "checking", onSubmit }));
      screen.getByLabelText("Your text").focus();
      await userEvent.keyboard("{Control>}{Enter}{/Control}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("ignores the second click of a double click", () => {
      const onCheck = vi.fn();
      renderWithIntl(editor("typed", { onCheck }));
      fireEvent.click(check(), { detail: 2 });
      expect(onCheck).not.toHaveBeenCalled();
    });
  });
});
