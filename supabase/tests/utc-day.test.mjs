// The wait that keeps a test on one UTC day. Needs no stack.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearOfMidnight,
  PAST_MIDNIGHT_MS,
  untilMidnight,
} from "./utc-day.mjs";

const at = (iso) => Date.parse(iso);
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

// A clock that moves only when the wait sleeps, and keeps what the wait said
function clock(iso) {
  let time = at(iso);
  const lines = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    log: (line) => lines.push(line),
    lines,
    get iso() {
      return new Date(time).toISOString();
    },
  };
}

describe("the time left in the UTC day", () => {
  it("runs to the next midnight UTC", () => {
    assert.equal(untilMidnight(at("2026-11-14T23:59:59.270Z")), 730);
    assert.equal(untilMidnight(at("2026-11-14T12:00:00.000Z")), DAY / 2);
  });

  it("is a whole day at midnight itself", () => {
    assert.equal(untilMidnight(at("2026-11-15T00:00:00.000Z")), DAY);
  });

  it("ends a month, a year and a 28 February like any other day", () => {
    assert.equal(untilMidnight(at("2026-11-30T23:59:00.000Z")), MINUTE);
    assert.equal(untilMidnight(at("2026-12-31T23:59:00.000Z")), MINUTE);
    assert.equal(untilMidnight(at("2028-02-28T23:00:00.000Z")), 60 * MINUTE);
  });
});

describe("the wait before a test", () => {
  it("is none while more than the margin is left", async () => {
    const time = clock("2026-11-14T23:57:59.999Z");
    assert.equal(await clearOfMidnight(2 * MINUTE, time), 0);
    assert.equal(time.iso, "2026-11-14T23:57:59.999Z");
    assert.deepEqual(time.lines, []);
  });

  // When the check that failed in CI started, a second before midnight
  it("lasts until just past midnight when less is left, and says so", async () => {
    const time = clock("2026-11-14T23:59:59.270Z");
    assert.equal(
      await clearOfMidnight(2 * MINUTE, time),
      730 + PAST_MIDNIGHT_MS,
    );
    assert.equal(time.iso, "2026-11-15T00:00:05.000Z");
    assert.equal(time.lines.length, 1);
    assert.match(time.lines[0], /^waiting 6 s for midnight UTC/);
  });

  it("leaves more than the margin of the next day, in a new month too", async () => {
    const time = clock("2026-11-30T23:58:30.000Z");
    await clearOfMidnight(5 * MINUTE, time);
    assert.equal(time.iso, "2026-12-01T00:00:05.000Z");
    assert.ok(untilMidnight(time.now()) > 5 * MINUTE);
  });

  it("waits at the margin itself", async () => {
    const time = clock("2026-11-14T23:58:00.000Z");
    assert.equal(
      await clearOfMidnight(2 * MINUTE, time),
      2 * MINUTE + PAST_MIDNIGHT_MS,
    );
  });
});
