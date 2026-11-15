// The database counts attempts per UTC day and per UTC month by its own clock, and starts each day
// afresh at midnight UTC. A test that sets or reads those counts and then lets the database or the
// route act must do it all on one day: across midnight, it would compare two days. The database
// tests and the site audit both wait here when midnight is too near. Node built-ins only, since the
// database workflow installs nothing.

// Milliseconds from `now` to the next midnight UTC
export function untilMidnight(now = Date.now()) {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return midnight.getTime() - now;
}

// How far past midnight a wait ends, for a database clock a little behind this one
export const PAST_MIDNIGHT_MS = 5000;

// When no more than `margin` milliseconds of the UTC day are left, waits until just past midnight,
// so that what runs next runs on one day if it takes less than `margin`. Returns the time waited.
export async function clearOfMidnight(
  margin,
  {
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (line) => console.log(line),
  } = {},
) {
  const left = untilMidnight(now());
  if (left > margin) return 0;
  const wait = left + PAST_MIDNIGHT_MS;
  log(
    `waiting ${Math.ceil(wait / 1000)} s for midnight UTC, so that nothing runs across it`,
  );
  await sleep(wait);
  return wait;
}
