import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import LocaleError from "@/app/[locale]/error";
import NotFound from "@/app/[locale]/not-found";
import { renderWithIntl } from "./render";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("the error page", () => {
  // `reset` alone would render the same server answer again
  it("fetches the page again when asked to try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    renderWithIntl(<LocaleError error={new Error("broken")} retry={retry} />);
    await userEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  // Next renders both pages inside the layout, which already holds the main
  it("has no main of its own, like the page for a missing address", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const error = renderWithIntl(
      <LocaleError error={new Error("broken")} retry={() => {}} />,
    );
    expect(error.container.querySelector("main")).toBeNull();
    error.unmount();

    const missing = renderWithIntl(<NotFound />);
    expect(missing.container.querySelector("main")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to home" })).toBeVisible();
  });
});
