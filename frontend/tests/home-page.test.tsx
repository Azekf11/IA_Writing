import { act, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/[locale]/page";
import { renderWithIntl } from "./render";

vi.mock("next-intl/server", () => ({ setRequestLocale: () => {} }));
vi.mock("@/i18n/navigation", () => ({}));
vi.mock("@/components/rewrite-workspace", () => ({
  RewriteWorkspace: () => <form aria-label="The editor" />,
}));

// The session that is still being read
const waiting = new Promise(() => {});
vi.mock("@/components/account-section", async (original) => ({
  ...(await original<typeof import("@/components/account-section")>()),
  AccountSection: () => {
    throw waiting;
  },
}));

async function home() {
  const params = Promise.resolve({ locale: "en" });
  let view!: ReturnType<typeof renderWithIntl>;
  await act(async () => {
    view = renderWithIntl(
      <Suspense>
        <Home params={params} searchParams={Promise.resolve({})} />
      </Suspense>,
    );
  });
  return view.container;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ allowance: { limit: 5, used: null, open: true } }),
    ),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("the home page", () => {
  it("says what is allowed between the account and the editor", async () => {
    const page = await home();
    const line = await screen.findByText(/Up to 5 free rewrites/);
    const account = page.querySelector(".skeleton")!.parentElement!;
    const editor = screen.getByRole("form", { name: "The editor" });
    expect(
      account.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      line.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts the editor above the example", async () => {
    await home();
    const editor = screen.getByRole("form", { name: "The editor" });
    const example = screen.getByRole("region", { name: "An example" });
    expect(
      editor.compareDocumentPosition(example) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps the account's place above the editor while the session is read", async () => {
    const page = await home();
    const placeholder = page.querySelector(".skeleton")!.parentElement!;
    expect(
      placeholder.compareDocumentPosition(
        screen.getByRole("form", { name: "The editor" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing for a screen reader to stop on
    expect(placeholder).toHaveAttribute("aria-hidden", "true");
  });

  it("has no main of its own: the layout holds it", async () => {
    expect((await home()).querySelector("main")).toBeNull();
  });
});
