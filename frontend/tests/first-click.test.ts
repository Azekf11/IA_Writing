import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";
import { firstClick } from "@/lib/first-click";

const click = (detail: number) => ({ detail }) as MouseEvent;

describe("firstClick", () => {
  it("runs on a single click and from the keyboard", () => {
    const action = vi.fn();
    firstClick(action)(click(1));
    firstClick(action)(click(0));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("ignores the second click of a double click", () => {
    const action = vi.fn();
    firstClick(action)(click(2));
    firstClick(action)(click(3));
    expect(action).not.toHaveBeenCalled();
  });
});
