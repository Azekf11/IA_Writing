import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextEditor } from "@/components/text-editor";
import { MAX_CHARS } from "@/lib/text";
import { renderWithIntl } from "./render";

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
