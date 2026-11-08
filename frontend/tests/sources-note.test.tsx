import { afterEach, describe, expect, it, vi } from "vitest";
import { SourcesNote } from "@/components/sources-note";
import { renderWithIntl } from "./render";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SourcesNote", () => {
  it("says where the style excerpts come from, and where they go", () => {
    const { container } = renderWithIntl(<SourcesNote />);
    expect(container.textContent).toContain("sent to Anthropic");
  });

  it("shows nothing when the excerpts are off", () => {
    vi.stubEnv("STYLE_REFERENCES", "off");
    const { container } = renderWithIntl(<SourcesNote />);
    expect(container.textContent).toBe("");
  });
});
