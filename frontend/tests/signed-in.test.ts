import { describe, expect, it, vi } from "vitest";
import { announceSignedIn, onSignedIn } from "@/lib/signed-in";

describe("the news that a session has arrived", () => {
  it("reaches whoever listens, until they stop", () => {
    const listener = vi.fn();
    const stop = onSignedIn(listener);
    announceSignedIn();
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    announceSignedIn();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
