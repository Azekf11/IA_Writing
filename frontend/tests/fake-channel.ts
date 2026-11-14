import { beforeEach, vi } from "vitest";

// The browser's BroadcastChannel, for the tabs a test plays: what one channel says, the others of
// its name hear a moment later, if they are still open by then. jsdom has none of its own.
export class FakeChannel {
  static open = new Set<FakeChannel>();
  static said: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(readonly name: string) {
    FakeChannel.open.add(this);
  }

  postMessage(data: unknown) {
    FakeChannel.said.push(data);
    const hearers = [...FakeChannel.open].filter(
      (channel) => channel !== this && channel.name === this.name,
    );
    setTimeout(() => {
      for (const channel of hearers)
        if (FakeChannel.open.has(channel)) channel.onmessage?.({ data });
    });
  }

  close() {
    FakeChannel.open.delete(this);
  }
}

export function withFakeChannels() {
  beforeEach(() => {
    FakeChannel.open.clear();
    FakeChannel.said = [];
    vi.stubGlobal("BroadcastChannel", FakeChannel);
  });
}

// A browser that refuses a channel, as it can refuse storage
export class RefusedChannel {
  constructor() {
    throw new DOMException("The operation is insecure.", "SecurityError");
  }
}

// Another tab of the same browser: the same code, loaded on its own
export async function otherTab() {
  vi.resetModules();
  return import("@/lib/signed-out");
}

// Long enough for what was said to arrive
export const settle = () => new Promise((done) => setTimeout(done, 20));
