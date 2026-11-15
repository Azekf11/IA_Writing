// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { maxDuration as accountMaxDuration } from "@/app/api/account/route";
import { maxDuration } from "@/app/api/rewrite/route";
import { CALL_MS } from "@/lib/rewrite/claude";
import { SEARCH_MS } from "@/lib/style/retrieve";
import { AUTH_MS } from "@/lib/supabase/auth-down";
import { DATABASE_MS } from "@/lib/supabase/service";
import vercel from "../vercel.json";

// The lowest ticket_ttl_seconds the column's check accepts. The value in force is a database row
// that can change with no deployment, so the function has to end before any ticket can run out.
// The last migration that touches the check decides, read without its comments, in any case and
// spacing. When it states no plain `check (ticket_ttl_seconds >= N)`, as with a range, another
// operator or a dropped constraint, there is no floor, and the test fails until it learns the new
// form rather than trust an older one.
function ticketTtlFloor(migrations: string[]) {
  const touching = migrations
    .map((text) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/--.*/g, "")
        .split(";")
        .filter(
          (statement) =>
            /ticket_ttl_seconds/i.test(statement) &&
            /\b(check|constraint)\b/i.test(statement),
        ),
    )
    .filter((statements) => statements.length > 0)
    .at(-1);
  const floor = touching
    ?.flatMap((statement) => [
      ...statement.matchAll(
        /\bcheck\s*\(+\s*"?ticket_ttl_seconds"?\s*>=\s*(\d+)\s*\)/gi,
      ),
    ])
    .at(-1);
  return floor && Number(floor[1]);
}

const MIGRATIONS = path.join(__dirname, "../../supabase/migrations");
const LOWEST_TICKET_TTL_S = ticketTtlFloor(
  readdirSync(MIGRATIONS)
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS, file), "utf8")),
);

const [[file, settings]] = Object.entries(vercel.functions);

describe("the deadlines of a rewrite", () => {
  it("are set on the route's real file", () => {
    expect(existsSync(path.join(__dirname, "..", file))).toBe(true);
  });

  it("give the function one limit, in the platform's settings and in the route", () => {
    expect(settings.maxDuration).toBe(maxDuration);
  });

  it("end the model call before the function, with time left to close the ticket", () => {
    expect(CALL_MS).toBeLessThan(settings.maxDuration * 1000);
  });

  it("still leave a database call time to close the ticket after the model's deadline", () => {
    expect(CALL_MS + DATABASE_MS).toBeLessThan(settings.maxDuration * 1000);
  });

  // The model's deadline counts from the request's arrival, so whatever comes before it is taken
  // from the model's time, never added to the function's
  it("leave the model time after the session check, the reservation, the start and the search, each at its limit", () => {
    expect(AUTH_MS + 2 * DATABASE_MS + SEARCH_MS).toBeLessThan(CALL_MS);
  });

  it("end the function before any ticket can run out", () => {
    expect(
      LOWEST_TICKET_TTL_S,
      "the last migration that touches the check on ticket_ttl_seconds states no `check (ticket_ttl_seconds >= N)`",
    ).toBeTypeOf("number");
    expect(settings.maxDuration).toBeLessThan(LOWEST_TICKET_TTL_S!);
  });

  it("let the route hear that the reader left", () => {
    expect(settings.supportsCancellation).toBe(true);
  });
});

describe("the ticket lifetime's floor, as read from the migrations", () => {
  const SHIPPED = `create table public.quota_limits (
  max_in_flight integer not null check (max_in_flight >= 1),
  -- Must stay above the route's 60 s maximum duration
  ticket_ttl_seconds integer not null check (ticket_ttl_seconds >= 75)
);`;
  const TABLE = "alter table public.quota_limits";
  const DROP = `${TABLE} drop constraint quota_limits_ticket_ttl_seconds_check;\n`;

  it.each([
    [
      "in upper case",
      `${DROP}${TABLE} ADD CONSTRAINT c CHECK (ticket_ttl_seconds >= 30);`,
      30,
    ],
    [
      "the way Postgres prints it",
      `${DROP}${TABLE} add constraint c CHECK ((ticket_ttl_seconds >= 30)) not valid;\n${TABLE} validate constraint c;`,
      30,
    ],
    [
      "over several lines",
      `${DROP}${TABLE}\n  add constraint c\n  check (\n    ticket_ttl_seconds >= 120\n  );`,
      120,
    ],
    [
      "above a comment that quotes the old one",
      `${DROP}${TABLE} add constraint c check (ticket_ttl_seconds >= 30);\n-- was check (ticket_ttl_seconds >= 75)`,
      30,
    ],
    [
      "as a range, which leaves no floor to read",
      `${DROP}${TABLE} add constraint c check (ticket_ttl_seconds between 30 and 600);`,
      undefined,
    ],
    [
      "as a floor joined to a ceiling, which leaves none to read either",
      `${DROP}${TABLE} add constraint c check (ticket_ttl_seconds >= 30 and ticket_ttl_seconds <= 600);`,
      undefined,
    ],
    [
      "with another operator",
      `${DROP}${TABLE} add constraint c check (ticket_ttl_seconds > 30);`,
      undefined,
    ],
    ["as a drop with nothing after it", DROP, undefined],
    [
      "for another column, which keeps the shipped floor",
      `${TABLE} drop constraint quota_limits_max_in_flight_check;\n${TABLE} add constraint quota_limits_max_in_flight_check check (max_in_flight between 1 and 10);`,
      75,
    ],
    [
      "in a comment only, which keeps the shipped floor",
      "/* check (ticket_ttl_seconds >= 30) */\n-- check (ticket_ttl_seconds >= 30)",
      75,
    ],
    [
      "in a function that reads the column, which keeps the shipped floor",
      "create function public.expire() returns void language sql as $$\n  select make_interval(secs => lim.ticket_ttl_seconds) from public.quota_limits lim;\n$$;",
      75,
    ],
  ])("follows a later change written %s", (_, later, floor) => {
    expect(ticketTtlFloor([SHIPPED, later])).toBe(floor);
  });
});

describe("the deadlines of an account deletion", () => {
  it("let the session check and the two calls to Auth after it each take all their time", () => {
    expect(3 * AUTH_MS).toBeLessThan(accountMaxDuration * 1000);
  });
});
