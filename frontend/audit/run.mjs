// Site audit: `npm run audit`
// Builds the production site, runs it against the local Supabase stack and a stand-in for the
// model, drives it with a real browser, and writes audit/report.md and audit/report.json.
//
// Needs: `supabase start` (database, auth, mailbox) and a Playwright browser.
// Costs nothing: the model is a local stand-in, no API key is used.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { startMockAnthropic } from "./mock-anthropic.mjs";
import { issues, localEnv, results, sleep } from "./lib.mjs";
import { writeReport } from "./report.mjs";

const PORT = 3300;
const MOCK_PORT = 4310;
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const SUITES = [
  "pages",
  "look",
  "buttons",
  "auth",
  "rewrite",
  "limits",
  "concurrency",
  "speed",
];

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
  const mock = await startMockAnthropic(MOCK_PORT);

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

  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    env: serverEnv,
    stdio: "ignore",
  });
  const base = `http://localhost:${PORT}`;
  const browser = await chromium.launch();

  try {
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
    await browser.close();
    server.kill();
    await mock.close();
    spawnSync("pkill", ["-f", `next start -p ${PORT}`]);
  }

  mkdirSync(new URL("./", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("./report.json", import.meta.url),
    JSON.stringify({ results, issues }, null, 2),
  );
  writeFileSync(
    new URL("./report.md", import.meta.url),
    writeReport(results, issues),
  );

  const count = (status) => results.filter((r) => r.status === status).length;
  console.log(
    `\n${results.length} checks: ${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed, ${issues.length} browser issues`,
  );
  process.exitCode = count("fail") ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
