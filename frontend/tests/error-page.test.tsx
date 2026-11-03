import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import LocaleError from "@/app/[locale]/error";
import { renderWithIntl } from "./render";

describe("the error page", () => {
  // `reset` alone would render the same server answer again
  it("fetches the page again when asked to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    renderWithIntl(<LocaleError error={new Error("broken")} retry={retry} />);
    await userEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
