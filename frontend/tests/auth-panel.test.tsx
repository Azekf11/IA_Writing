import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthPanel } from "@/components/auth-panel";
import { hydrateAfter, renderWithIntl } from "./render";

const signOut = vi.fn();
const signInWithOtp = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({ auth: { signOut, signInWithOtp } }),
}));

beforeEach(() => {
  search = "";
  signOut.mockReset().mockResolvedValue({ error: null });
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllGlobals());

const askForLink = async () => {
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
};

describe("AuthPanel", () => {
  const typedEarly = (page: HTMLElement) => {
    page.querySelector("input")!.value = "early@example.com";
  };

  it("sends an address typed before the scripts arrived", async () => {
    hydrateAfter(typedEarly, <AuthPanel email={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "early@example.com" }),
    );
  });

  it("sends what the box holds when the state is a moment behind", () => {
    renderWithIntl(<AuthPanel email={null} />);
    const box = screen.getByLabelText<HTMLInputElement>("Email");
    box.value = "early@example.com";
    fireEvent.submit(box.closest("form")!);
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "early@example.com" }),
    );
  });

  it("keeps that address when sending fails", async () => {
    signInWithOtp.mockResolvedValue({ error: new Error("too many") });
    hydrateAfter(typedEarly, <AuthPanel email={null} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("early@example.com");
  });

  it("signs out with a full load, so nothing of the session stays on the page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderWithIntl(<AuthPanel email="a@example.com" />, "fr");
    await userEvent.click(
      screen.getByRole("button", { name: "Se déconnecter" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(String(assign.mock.calls[0][0])).toBe(
      `${window.location.origin}/fr`,
    );
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("tells the reader to open the link in this browser", async () => {
    renderWithIntl(<AuthPanel email={null} />);
    await askForLink();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Open it in this browser.",
    );
  });

  it("says why a link can fail, without blaming its age alone", () => {
    search = "auth_error=1";
    renderWithIntl(<AuthPanel email={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "in the browser that asked for it",
    );
  });

  it("does not put a sending failure down to the address alone", async () => {
    signInWithOtp.mockResolvedValue({ error: { status: 429 } });
    renderWithIntl(<AuthPanel email={null} />);
    await askForLink();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "try again in a few minutes",
    );
  });
});
