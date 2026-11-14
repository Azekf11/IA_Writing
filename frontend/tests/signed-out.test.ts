import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readReopen, stashReopen } from "@/lib/rewrite/reopen";
import {
  announceSignedOut,
  leaveSession,
  onSignedOutElsewhere,
} from "@/lib/signed-out";
import {
  FakeChannel,
  RefusedChannel,
  otherTab,
  settle,
  withFakeChannels,
} from "./fake-channel";

afterEach(() => vi.unstubAllGlobals());

describe("the news that the session has ended", () => {
  withFakeChannels();

  it("reaches the browser's other tabs", async () => {
    const heard = vi.fn();
    onSignedOutElsewhere(heard);
    (await otherTab()).announceSignedOut();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
  });

  it("is not taken up by the tab that gives it, which is leaving already", async () => {
    const heard = vi.fn();
    onSignedOutElsewhere(heard);
    announceSignedOut();
    await settle();
    expect(FakeChannel.said).toHaveLength(1);
    expect(heard).not.toHaveBeenCalled();
  });

  it("is heard no more once the listener stops, and leaves no channel open", async () => {
    const heard = vi.fn();
    const stop = onSignedOutElsewhere(heard);
    stop();
    (await otherTab()).announceSignedOut();
    await settle();
    expect(heard).not.toHaveBeenCalled();
    expect(FakeChannel.open.size).toBe(0);
  });

  it.each([
    ["has no channel", undefined],
    ["refuses one", RefusedChannel],
  ])("is neither given nor awaited where the browser %s", (_case, Channel) => {
    vi.stubGlobal("BroadcastChannel", Channel);
    expect(() => announceSignedOut()).not.toThrow();
    expect(() => onSignedOutElsewhere(vi.fn())()).not.toThrow();
  });
});

describe("leaving a session", () => {
  const assign = vi.fn();
  beforeEach(() => {
    assign.mockReset();
    vi.stubGlobal("location", { ...window.location, assign });
  });

  it("forgets the text kept for a sign-in and a rewrite on its way to the editor, then loads the home page anew", () => {
    localStorage.setItem("rewrity:sign-in-draft", "kept");
    expect(stashReopen("A text", [])).toBe(true);
    leaveSession("fr");
    expect(localStorage.getItem("rewrity:sign-in-draft")).toBeNull();
    expect(readReopen()).toBeNull();
    expect(String(assign.mock.calls[0][0])).toBe(
      `${window.location.origin}/fr`,
    );
  });
});
