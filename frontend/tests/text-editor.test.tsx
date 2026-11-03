import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS } from "@/components/rewrite-options";
import { TextEditor } from "@/components/text-editor";
import { MAX_CHARS } from "@/lib/text";
import { hydrateAfter, renderWithIntl } from "./render";

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
  it("shows the word and character count", () => {
    renderWithIntl(<TextEditor value="hello big world" onChange={vi.fn()} />);
    expect(screen.getByText(/3 words/)).toBeInTheDocument();
    expect(
      screen.getByText(`15 / ${MAX_CHARS} characters`),
    ).toBeInTheDocument();
  });

  it("renders in French", () => {
    renderWithIntl(<TextEditor value="un" onChange={vi.fn()} />, "fr");
    expect(screen.getByLabelText("Votre texte")).toBeInTheDocument();
    expect(screen.getByText(/1 mot/)).toBeInTheDocument();
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
      expect(screen.getByText(/16 \/ 1500/)).toBeInTheDocument(),
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
      expect(screen.getByText(/16 \/ 1500/)).toBeInTheDocument();
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
    expect(screen.getByText(/16 \/ 1500/)).toBeInTheDocument();
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
    expect(
      screen.getByText(`4500 / ${MAX_CHARS} characters`),
    ).toBeInTheDocument();
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

  it("hides the sample button once there is text", () => {
    renderWithIntl(
      <TextEditor value="typed" onChange={vi.fn()} onExample={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Try an example" })).toBeNull();
  });
});
