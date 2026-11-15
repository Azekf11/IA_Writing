import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThemeControls } from "@/components/theme-controls";
import { renderWithIntl } from "./render";

const trigger = () => screen.getByRole("button", { name: "Appearance" });

describe("ThemeControls", () => {
  // The panel goes, and the control that held the focus with it: the focus would fall to the page,
  // and the next Tab would start again from the top
  it("gives the focus back to its button on Escape from inside the panel", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ThemeControls />);
    await user.click(trigger());
    await user.tab();
    expect(screen.getByRole("dialog")).toContainElement(
      document.activeElement as HTMLElement,
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("leaves the focus where it is on Escape from elsewhere", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <>
        <ThemeControls />
        <button type="button">Elsewhere</button>
      </>,
    );
    await user.click(trigger());
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(elsewhere).toHaveFocus();
  });
});
