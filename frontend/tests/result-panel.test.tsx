import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultPanel, type ResultPanelHandle } from "@/components/result-panel";
import { renderWithIntl } from "./render";

const blockClipboard = () =>
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("no"));

// userEvent replaces the clipboard with its own on setup, so these go through fireEvent
const copyButton = () => screen.getByRole("button", { name: "Copy text" });

afterEach(() => {
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe("ResultPanel", () => {
  // A sample's review takes the place of the button that opened it, under the same pointer
  describe("the second click of a double click", () => {
    it("copies nothing", () => {
      userEvent.setup();
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(copyButton(), { detail: 2 });
      expect(write).not.toHaveBeenCalled();
    });

    it("downloads nothing", () => {
      const create = vi.fn(() => "blob:result");
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create }));
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(screen.getByRole("button", { name: "Download .txt" }), {
        detail: 2,
      });
      expect(create).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("when the text cannot be copied", () => {
    it.each([
      ["en", "Copy text", "Could not copy the text"],
      ["fr", "Copier le texte", "Impossible de copier le texte"],
    ] as const)("says so, in %s", async (locale, name, message) => {
      userEvent.setup();
      blockClipboard();
      renderWithIntl(
        <ResultPanel original="Before" result="The result" />,
        locale,
      );
      fireEvent.click(screen.getByRole("button", { name }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    });

    it("selects the text, ready to copy by hand", async () => {
      userEvent.setup();
      blockClipboard();
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(copyButton());
      await screen.findByRole("alert");
      expect(window.getSelection()?.toString()).toBe("The result");
    });

    it("works without the clipboard API, as on a page that is not secure", async () => {
      vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(copyButton());
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      vi.unstubAllGlobals();
    });

    it("does not claim that the copy worked", async () => {
      userEvent.setup();
      blockClipboard();
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(copyButton());
      await screen.findByRole("alert");
      expect(screen.queryByText("Copied")).toBeNull();
    });

    it("takes the message back once the result has changed", async () => {
      userEvent.setup();
      blockClipboard();
      const page = renderWithIntl(
        <ResultPanel original="Before" result="The result" />,
      );
      fireEvent.click(copyButton());
      await screen.findByRole("alert");
      page.rerender(<ResultPanel original="Before" result="Another result" />);
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("takes the message back when a later copy works", async () => {
      userEvent.setup();
      const write = blockClipboard();
      renderWithIntl(<ResultPanel original="Before" result="The result" />);
      fireEvent.click(copyButton());
      await screen.findByRole("alert");
      write.mockResolvedValue();
      fireEvent.click(copyButton());
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  describe("the button that carries the result into the editor", () => {
    const edit = () =>
      screen.queryByRole("button", { name: "Edit this result" });

    it("is there when the page offers it", async () => {
      const onEdit = vi.fn();
      renderWithIntl(
        <ResultPanel original="Before" result="Result" onEdit={onEdit} />,
      );
      await userEvent.click(edit()!);
      expect(onEdit).toHaveBeenCalledTimes(1);
    });

    it("is not there otherwise", () => {
      renderWithIntl(<ResultPanel original="Before" result="Result" />);
      expect(edit()).toBeNull();
    });

    // The editor takes the place of the review under the pointer
    it("does not count the second click of a double click", () => {
      const onEdit = vi.fn();
      renderWithIntl(
        <ResultPanel original="Before" result="Result" onEdit={onEdit} />,
      );
      fireEvent.click(edit()!, { detail: 2 });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("says so in French", () => {
      renderWithIntl(
        <ResultPanel original="Before" result="Result" onEdit={vi.fn()} />,
        "fr",
      );
      expect(
        screen.getByRole("button", { name: "Modifier ce résultat" }),
      ).toBeInTheDocument();
    });
  });

  describe("the length of the result", () => {
    const length = () => screen.getByTestId("result-length");

    it.each([
      [
        "longer",
        "one two",
        "one two three",
        "3 words (+1) · 13 characters (+6)",
      ],
      ["shorter", "one two three", "one", "1 word (-2) · 3 characters (-10)"],
      ["the same", "one two", "two one", "2 words · 7 characters"],
      [
        "longer in letters only",
        "a bc",
        "a bcd",
        "2 words · 5 characters (+1)",
      ],
      ["emptied", "one two", "", "0 words (-2) · 0 characters (-7)"],
    ])(
      "gives the difference when it is %s",
      (_, original, result, expected) => {
        renderWithIntl(<ResultPanel original={original} result={result} />);
        expect(length()).toHaveTextContent(expected);
      },
    );

    it("reads as French reads", () => {
      renderWithIntl(
        <ResultPanel original="a" result={`un ${"b".repeat(1498)}`} />,
        "fr",
      );
      // The thousands take a thin space that cannot break, and French counts 0 and 1 in the singular
      expect(length().textContent).toBe(
        "2 mots (+1) · 1\u202f501 caractères (+1\u202f500)",
      );
    });

    it("counts an accent pasted as a separate character once", () => {
      renderWithIntl(<ResultPanel original={"cafe\u0301"} result="café" />);
      expect(length()).toHaveTextContent(/^1 word · 4 characters$/);
    });

    // The status line says what each decision did; a second voice would talk over it
    it("is not read out as it changes", () => {
      renderWithIntl(<ResultPanel original="a b" result="a" />);
      expect(
        length().closest(
          "[aria-live], [role=status], [role=alert], [role=log]",
        ),
      ).toBeNull();
    });
  });

  describe("the list of edits", () => {
    const LIST = "The list\n\n1. Before: a\nAfter: b\nWhy: c\n";
    const copyList = () =>
      screen.getByRole("button", { name: "Copy the list" });
    const downloadList = () =>
      screen.getByRole("button", { name: "Download the list" });

    // What a click on a download link would have saved
    function catchDownloads() {
      const saved: { name: string; blob: Blob }[] = [];
      const urls = new Map<string, Blob>();
      vi.stubGlobal(
        "URL",
        Object.assign(URL, {
          createObjectURL: (blob: Blob) => {
            const url = `blob:${urls.size}`;
            urls.set(url, blob);
            return url;
          },
          revokeObjectURL: () => {},
        }),
      );
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          saved.push({ name: this.download, blob: urls.get(this.href)! });
        },
      );
      return saved;
    }

    const read = (blob: Blob) =>
      new Promise<string>((done) => {
        const reader = new FileReader();
        reader.onload = () => done(reader.result as string);
        reader.readAsText(blob);
      });

    afterEach(() => vi.unstubAllGlobals());

    it("is offered only when there is one", () => {
      renderWithIntl(<ResultPanel original="a" result="b" />);
      expect(
        screen.queryByRole("button", { name: "Copy the list" }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Download the list" }),
      ).toBeNull();
    });

    it("says in French what it is", () => {
      renderWithIntl(
        <ResultPanel original="a" result="b" changes={LIST} />,
        "fr",
      );
      expect(
        screen.getByRole("button", { name: "Copier la liste" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Télécharger la liste" }),
      ).toBeInTheDocument();
    });

    it("reaches the clipboard, and says so", async () => {
      userEvent.setup();
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      renderWithIntl(<ResultPanel original="a" result="b" changes={LIST} />);
      fireEvent.click(copyList());
      expect(write).toHaveBeenCalledExactlyOnceWith(LIST);
      expect(await screen.findByText("Copied")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Copy text" })).toBeVisible();
    });

    // The page says it on its status line, in the words for the one that was copied
    it("tells the page which one reached the clipboard", async () => {
      userEvent.setup();
      vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
      const onCopied = vi.fn();
      renderWithIntl(
        <ResultPanel
          original="a"
          result="b"
          changes={LIST}
          onCopied={onCopied}
        />,
      );
      fireEvent.click(copyList());
      await waitFor(() =>
        expect(onCopied).toHaveBeenCalledExactlyOnceWith("list"),
      );
      fireEvent.click(copyButton());
      await waitFor(() => expect(onCopied).toHaveBeenLastCalledWith("text"));
      expect(onCopied).toHaveBeenCalledTimes(2);
    });

    it("says when it could not be copied", async () => {
      userEvent.setup();
      blockClipboard();
      renderWithIntl(<ResultPanel original="a" result="b" changes={LIST} />);
      fireEvent.click(copyList());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Could not copy the list",
      );
      expect(window.getSelection()?.toString()).toBe("");
    });

    it("takes the message back once the list has changed", async () => {
      userEvent.setup();
      blockClipboard();
      const page = renderWithIntl(
        <ResultPanel original="a" result="b" changes={LIST} />,
      );
      fireEvent.click(copyList());
      await screen.findByRole("alert");
      page.rerender(
        <ResultPanel original="a" result="b" changes={`${LIST}more`} />,
      );
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("downloads under its own name, apart from the result", async () => {
      const saved = catchDownloads();
      renderWithIntl(<ResultPanel original="a" result="b" changes={LIST} />);
      fireEvent.click(downloadList());
      fireEvent.click(screen.getByRole("button", { name: "Download .txt" }));
      expect(saved.map(({ name }) => name)).toEqual([
        "rewrite-edits.txt",
        "rewrite.txt",
      ]);
      expect(await read(saved[0].blob)).toBe(LIST);
      expect(await read(saved[1].blob)).toBe("b");
    });
  });

  // The review's sticky row copies from far above the panel
  describe("a copy asked for from elsewhere on the page", () => {
    const openPanel = () => {
      const handle = createRef<ResultPanelHandle>();
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      renderWithIntl(
        <ResultPanel ref={handle} original="a" result="The result" />,
      );
      return { handle, scroll };
    };

    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it("copies the result, and stays where it is", async () => {
      userEvent.setup();
      const write = vi
        .spyOn(navigator.clipboard, "writeText")
        .mockResolvedValue();
      const { handle, scroll } = openPanel();
      await act(async () => {
        expect(await handle.current!.copy()).toBe(true);
      });
      expect(write).toHaveBeenCalledExactlyOnceWith("The result");
      expect(scroll).not.toHaveBeenCalled();
    });

    it("on failure, shows the panel with its message and the text selected", async () => {
      userEvent.setup();
      blockClipboard();
      const { handle, scroll } = openPanel();
      await act(async () => {
        expect(await handle.current!.copy()).toBe(false);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Could not copy the text",
      );
      expect(window.getSelection()?.toString()).toBe("The result");
      expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    });
  });
});
