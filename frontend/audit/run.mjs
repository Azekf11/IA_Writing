// Site audit: `npm run audit`
// Builds the production site, runs it against the local Supabase stack and a stand-in for the
// model, drives it with a real browser, and writes audit/report.md and audit/report.json.
//
// Needs: `supabase start` (database, auth, mailbox) and a Playwright browser. SUPABASE_WORKDIR
// selects a stack started from another folder. Bare arguments run some suites only, and the report
// then says it is partial: `npm run audit -- limits concurrency`.
//
// Costs nothing: the model is a local stand-in, no API key is used. For the length of the run it
// raises the quota limits, because the audit makes far more rewrites than a demo day allows, and
// adds a few passages, because a local database may hold no corpus. Both are undone at the end,
// also on Ctrl+C. The limits suite sets the values it tests by itself.
import { spawn, spawnSync } from "node:child_process";
import { openSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { startMockAnthropic } from "./mock-anthropic.mjs";
import {
  getLimits,
  globalToday,
  issues,
  localEnv,
  removePassages,
  results,
  seedPassages,
  setGlobalToday,
  setLimits,
  sleep,
} from "./lib.mjs";
import { writeReport } from "./report.mjs";

const PORT = 3300;
const MOCK_PORT = 4310;
const only = process.argv.slice(2);
const SUITES = [
  "pages",
  "look",
  "buttons",
  "auth",
  "rewrite",
  "streaming",
  "limits",
  "concurrency",
  "speed",
];
const unknown = only.filter((name) => !SUITES.includes(name));
if (unknown.length) {
  console.error(
    `no such suite: ${unknown.join(", ")}. The suites are: ${SUITES.join(", ")}`,
  );
  process.exit(2);
}
// In flight stays at the real value: the concurrency suite tests it
const AUDIT_LIMITS = {
  user_daily: 1000,
  global_daily: 100000,
  global_monthly: 1000000,
  max_in_flight: 2,
};

async function waitForServer(url, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`${url} did not come up`);
}

async function main() {
  const env = localEnv();
  // What to undo, last in first out, however the run ends
  const undo = [];
  let cleaning;
  const cleanup = () =>
    (cleaning ??= (async () => {
      for (const step of undo.reverse()) {
        try {
          await step();
        } catch (error) {
          console.error(`clean-up step failed: ${error.message}`);
          process.exitCode = 2;
        }
      }
    })());
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => cleanup().finally(() => process.exit(130)));
  }

  try {
    const limits = await getLimits(env).catch(() => {
      throw new Error(
        "the local database has no quota_limits table: apply the migrations (supabase migration up)",
      );
    });
    const startedAt = await globalToday(env);
    undo.push(async () => {
      await setLimits(env, limits);
      await setGlobalToday(env, startedAt);
    });
    await setLimits(env, AUDIT_LIMITS);

    undo.push(() => removePassages(env));
    await seedPassages(env);

    const mock = await startMockAnthropic(MOCK_PORT);
    undo.push(() => mock.close());

    console.log("building the production site...");
    const serverEnv = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.PUBLISHABLE_KEY,
      ANTHROPIC_API_KEY: "audit-key-not-real",
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
    };
    const build = spawnSync("npm", ["run", "build"], {
      env: serverEnv,
      encoding: "utf8",
    });
    if (build.status !== 0)
      throw new Error(`build failed:\n${build.stdout.slice(-1500)}`);

    // The route's logs land next to the report: a failing check often needs them
    const log = openSync(new URL("./server.log", import.meta.url), "w");
    const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
      env: serverEnv,
      stdio: ["ignore", log, log],
    });
    undo.push(() => {
      server.kill();
      spawnSync("pkill", ["-f", `next start -p ${PORT}`]);
    });

    // Playwright would otherwise end the process on Ctrl+C, before the clean-up runs
    const browser = await chromium.launch({
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    undo.push(() => browser.close());

    const base = `http://localhost:${PORT}`;
    await waitForServer(`${base}/en`);
    const t = { base, env, mock, browser };
    for (const name of SUITES) {
      if (only.length && !only.includes(name)) continue;
      console.log(`\n== ${name}`);
      const { run } = await import(`./suites/${name}.mjs`);
      try {
        await run(t);
      } catch (error) {
        results.push({
          area: name,
          name: "suite crashed",
          status: "fail",
          detail: String(error),
          ms: 0,
        });
        console.log(
          `FAIL [${name}] suite crashed - ${String(error).split("\n")[0]}`,
        );
      }
    }
  } finally {
    await cleanup();
  }

  writeFileSync(
    new URL("./report.json", import.meta.url),
    JSON.stringify({ results, issues }, null, 2),
  );
  writeFileSync(
    new URL("./report.md", import.meta.url),
    writeReport(results, issues, only),
  );

  const count = (status) => results.filter((r) => r.status === status).length;
  console.log(
    `\n${results.length} checks: ${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed, ${issues.length} browser issues`,
  );
  // A page that logs an error fails the run, even when every check passed. So does a run that
  // checked nothing.
  process.exitCode ||=
    results.length === 0 || count("fail") || issues.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
