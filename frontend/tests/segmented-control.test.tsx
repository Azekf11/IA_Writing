import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "@/components/segmented-control";

const SEGMENTS = [
  { value: "a", content: "Alpha" },
  { value: "b", content: "Beta" },
  { value: "c", content: "Gamma" },
];

function Picker({
  start,
  onChange,
}: {
  start?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <SegmentedControl
      label="Letter"
      segments={SEGMENTS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("SegmentedControl", () => {
  it("is one group, named by its label, with the chosen segment checked", () => {
    render(<Picker start="b" />);
    expect(screen.getByRole("radiogroup", { name: "Letter" })).toBeVisible();
    expect(radio("Beta")).toBeChecked();
    expect(radio("Alpha")).not.toBeChecked();
  });

  it("takes a click", async () => {
    render(<Picker start="a" />);
    await userEvent.click(radio("Gamma"));
    expect(radio("Gamma")).toBeChecked();
    expect(radio("Alpha")).not.toBeChecked();
  });

  it("is a single stop for Tab: the chosen segment", async () => {
    render(
      <>
        <Picker start="b" />
        <button>After</button>
      </>,
    );
    await userEvent.tab();
    expect(radio("Beta")).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  // The server cannot know the theme, so the first render has nothing chosen
  it("can still be reached with Tab while nothing is chosen", async () => {
    render(<Picker />);
    await userEvent.tab();
    expect(radio("Alpha")).toHaveFocus();
    expect(radio("Alpha")).not.toBeChecked();
  });

  it("moves the choice and the focus with the arrow keys, around the ends", async () => {
    const onChange = vi.fn();
    render(<Picker start="a" onChange={onChange} />);
    radio("Alpha").focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(radio("Beta")).toHaveFocus();
    expect(radio("Beta")).toBeChecked();
    await userEvent.keyboard("{ArrowDown}");
    expect(radio("Gamma")).toBeChecked();
    await userEvent.keyboard("{ArrowRight}");
    expect(radio("Alpha")).toHaveFocus();
    expect(radio("Alpha")).toBeChecked();
    await userEvent.keyboard("{ArrowLeft}");
    expect(radio("Gamma")).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}");
    expect(radio("Beta")).toBeChecked();
    expect(onChange.mock.calls.flat()).toEqual(["b", "c", "a", "c", "b"]);
  });

  it("leaves other keys and browser shortcuts alone", async () => {
    const onChange = vi.fn();
    render(<Picker start="a" onChange={onChange} />);
    radio("Alpha").focus();
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await userEvent.keyboard("{Control>}{ArrowLeft}{/Control}");
    await userEvent.keyboard("{Meta>}{ArrowLeft}{/Meta}");
    await userEvent.keyboard("x");
    expect(onChange).not.toHaveBeenCalled();
    expect(radio("Alpha")).toHaveFocus();
  });

  it("names a segment that shows no words", () => {
    render(
      <SegmentedControl
        label="Colour"
        look="swatches"
        segments={[{ value: "blue", content: null, label: "Blue" }]}
        value="blue"
        onChange={() => {}}
      />,
    );
    expect(radio("Blue")).toBeChecked();
  });

  // Its fill and its word alone are under 3:1 against the other segments, by day and by night
  it("draws a ring around the chosen segment only", () => {
    render(<Picker start="b" />);
    expect(radio("Beta")).toHaveClass("ring-1", "ring-muted");
    expect(radio("Alpha")).not.toHaveClass("ring-1");
    expect(radio("Alpha").className).not.toMatch(/\bring-/);
  });

  // Backgrounds and shadows are what marks the choice, and forced colours remove them
  it("marks the choice with the system's own colours in forced colours", () => {
    render(<Picker start="a" />);
    expect(radio("Alpha").className).toMatch(/forced-colors:bg-\[Highlight\]/);
    expect(radio("Beta").className).not.toMatch(/Highlight/);
  });

  it("keeps a swatch's own colour in forced colours", () => {
    render(
      <SegmentedControl
        label="Colour"
        look="swatches"
        segments={[{ value: "blue", content: null, label: "Blue" }]}
        onChange={() => {}}
      />,
    );
    expect(radio("Blue").className).toContain(
      "forced-colors:forced-color-adjust-none",
    );
  });
});
