// Blind comparison of the suggestions with and without excerpts: `npm run compare`, then, once the
// ratings are filled in, `npm run compare -- score`. docs/research/style-references-comparison.md is
// the protocol.
//
// Runs one local server with the excerpts and one with STYLE_REFERENCES=off, and asks each about
// every text. Writes to audit/comparison/ (git-ignored):
//   sheet.md       what the rater reads: both versions of each text, as X and Y
//   ratings.json   what the rater fills in
//   key.json       which of X and Y had the excerpts: not to be opened before the ratings are done
//   measures.json  delay and tokens per attempt, by condition: the same
//
// Costs nothing by default: the model is the local stand-in, a few passages written for the audit
// are added for the run, and sheet.md, measures.json, the console and the score say simulated. Real
// calls need COMPARE_REAL=yes, ANTHROPIC_API_KEY and a corpus in the local database, and localEnv
// refuses any stack that is not local.
import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { applyEdits } from "../lib/rewrite/apply.ts";
import { startMockAnthropic } from "./mock-anthropic.mjs";
import {
  createUser,
  deleteUser,
  expect,
  getLimits,
  globalToday,
  hasPassages,
  localEnv,
  removePassages,
  seedPassages,
  sessionCookies,
  setGlobalToday,
  setLimits,
  until,
} from "./lib.mjs";

const OUT = new URL("./comparison/", import.meta.url);
const TEXTS = new URL(
  "../../docs/research/comparison-texts.json",
  import.meta.url,
);
const PORTS = { on: 3310, off: 3311 };
const MOCK_PORT = 4311;
const SIMULATED =
  "SIMULATED: the model was the local stand-in. These results only show that the tool works; they say nothing about the excerpts.";

// The true median of an even count, unlike the audit's: the rule below depends on it
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return sorted.length % 2
    ? sorted[Math.floor(middle)]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const write = (name, value) =>
  writeFileSync(
    new URL(name, OUT),
    typeof value === "string" ? value : JSON.stringify(value, null, 2),
  );
const read = (name) => JSON.parse(readFileSync(new URL(name, OUT), "utf8"));

function startServer(condition, serverEnv) {
  const port = PORTS[condition];
  const server = spawn("npx", ["next", "start", "-p", String(port)], {
    env: {
      ...serverEnv,
      // Explicit both ways, so that a value in .env.local cannot change the condition
      STYLE_REFERENCES: condition,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => (output += chunk));
  server.stderr.on("data", (chunk) => (output += chunk));
  return {
    base: `http://localhost:${port}`,
    // The route's own account of each attempt, in the order they ended
    attempts: () =>
      [...output.matchAll(/Rewrite attempt (\{.*\})/g)].map((match) =>
        JSON.parse(match[1]),
      ),
    stop() {
      server.kill();
      spawnSync("pkill", ["-f", `next start -p ${port}`]);
    },
  };
}

async function waitForServer(base) {
  const up = await until(
    () =>
      fetch(`${base}/en`).then(
        (response) => response.status < 500,
        () => false,
      ),
    { timeout: 60000, every: 500 },
  );
  expect(up, `${base} did not come up`);
}

async function attempt(server, cookie, { text, locale }) {
  const before = server.attempts().length;
  const response = await fetch(`${server.base}/api/rewrite`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ text, locale, strength: "standard", stream: true }),
  });
  const events = (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const logged = await until(() => server.attempts()[before], {
    timeout: 10000,
  });
  expect(logged, `the server logged nothing, status ${response.status}`);
  // As the page does: a stream delivers the strongest edit first, and applyEdits reads them in order
  const edits = events
    .filter((e) => e.type === "edit")
    .map((e) => e.edit)
    .sort((a, b) => a.start - b.start);
  const accepted = Object.fromEntries(edits.map((e) => [e.id, "accepted"]));
  return {
    ...logged,
    edits,
    result: applyEdits(text, edits, accepted),
  };
}

// The reasons stay out, because one could mention an excerpt, and so do the credits and the timings
function sheetFor(simulated, texts, runs, key) {
  const version = (run) =>
    [
      run.state === "succeeded" ? "" : `(this attempt ended as: ${run.state})`,
      run.result,
      ...run.edits.map(
        (edit) => `- ${edit.original}\n  -> ${edit.replacement}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n");
  const blocks = texts.map(({ id, text, facts }) => {
    const versions = Object.entries(key[id]).map(
      ([label, condition]) => `### ${label}\n\n${version(runs[id][condition])}`,
    );
    const list = facts.map((fact) => `- ${fact}`).join("\n");
    return [`## ${id}`, text, `Facts:\n\n${list}`, ...versions].join("\n\n");
  });
  return [
    simulated ? SIMULATED : "",
    "Rate X and Y for each text in ratings.json, following the protocol.",
    ...blocks,
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

async function run() {
  const real = process.env.COMPARE_REAL === "yes";
  expect(
    !real || process.env.ANTHROPIC_API_KEY,
    "COMPARE_REAL=yes needs ANTHROPIC_API_KEY in the environment",
  );
  const env = localEnv();
  const { texts } = JSON.parse(readFileSync(TEXTS, "utf8"));

  const undo = [];
  const cleanup = async () => {
    for (const step of undo.splice(0).reverse()) {
      await Promise.resolve()
        .then(step)
        .catch((error) => console.error(`clean-up failed: ${error.message}`));
    }
  };
  process.once("SIGINT", () => cleanup().finally(() => process.exit(130)));

  try {
    if (real) {
      expect(
        await hasPassages(env),
        "the local database holds no passages: with excerpts and without would be the same run",
      );
    } else {
      undo.push(() => removePassages(env));
      await seedPassages(env);
      const mock = await startMockAnthropic(MOCK_PORT);
      undo.push(() => mock.close());
    }
    const limits = await getLimits(env);
    const startedAt = await globalToday(env);
    undo.push(async () => {
      await setLimits(env, limits);
      await setGlobalToday(env, startedAt);
    });
    await setLimits(env, {
      user_daily: 1000,
      global_daily: 100000,
      global_monthly: 1000000,
    });

    const serverEnv = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: env.API_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: env.PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: env.SECRET_KEY,
      ...(real
        ? // Empty, not absent: a stand-in's address in .env.local must not pass for the real model
          { ANTHROPIC_BASE_URL: "" }
        : {
            ANTHROPIC_API_KEY: "audit-key-not-real",
            ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
          }),
    };
    console.log("building the production site...");
    const build = spawnSync("npm", ["run", "build"], {
      env: serverEnv,
      encoding: "utf8",
    });
    expect(build.status === 0, `build failed:\n${build.stdout.slice(-1500)}`);

    const servers = {};
    for (const condition of ["on", "off"]) {
      servers[condition] = startServer(condition, serverEnv);
      undo.push(() => servers[condition].stop());
      await waitForServer(servers[condition].base);
    }
    const user = await createUser(env, "compare");
    undo.push(() => deleteUser(env, user));
    const cookie = (await sessionCookies(env, user))
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");

    console.log(
      `${texts.length * 2} attempts, ${real ? "REAL MODEL CALLS" : "simulated model"}`,
    );
    const runs = {};
    let done = 0;
    for (const [index, entry] of texts.entries()) {
      // The order alternates, so that neither condition always goes first
      const order = index % 2 ? ["off", "on"] : ["on", "off"];
      runs[entry.id] = {};
      for (const condition of order) {
        const result = await attempt(servers[condition], cookie, entry);
        expect(
          condition === "on" || result.references === 0,
          `${entry.id}: excerpts were used with STYLE_REFERENCES=off`,
        );
        runs[entry.id][condition] = result;
        // Nothing here tells the conditions apart: the ratings have to stay blind
        console.log(`[${++done}/${texts.length * 2}] ${entry.id}`);
      }
    }

    // A run that compared nothing must not look like a result
    const excerpted = texts.filter(({ id }) => runs[id].on.references > 0);
    expect(excerpted.length > 0, "no attempt used an excerpt");
    console.log(`${excerpted.length}/${texts.length} texts got excerpts`);

    // Drawn per text, and kept nowhere but in the key
    const key = Object.fromEntries(
      texts.map(({ id }) => [
        id,
        randomInt(2) ? { X: "on", Y: "off" } : { X: "off", Y: "on" },
      ]),
    );
    const blank = { fidelity_errors: null, naturalness: null };
    mkdirSync(OUT, { recursive: true });
    write("sheet.md", sheetFor(!real, texts, runs, key));
    write(
      "ratings.json",
      Object.fromEntries(
        texts.map(({ id }) => [id, { X: { ...blank }, Y: { ...blank } }]),
      ),
    );
    write("key.json", key);
    write("measures.json", { simulated: !real, runs });
    console.log(`\nwritten to audit/comparison/. ${real ? "" : SIMULATED}`);
  } finally {
    await cleanup();
  }
}

function score() {
  const { simulated, runs } = read("measures.json");
  const key = read("key.json");
  const ratings = read("ratings.json");
  const rated = { on: {}, off: {} };
  for (const [id, labels] of Object.entries(key)) {
    for (const [label, condition] of Object.entries(labels)) {
      const rating = ratings[id]?.[label];
      expect(
        Number.isInteger(rating?.fidelity_errors) &&
          rating.fidelity_errors >= 0 &&
          [1, 2, 3, 4, 5].includes(rating?.naturalness),
        `${id} ${label} is not rated: fidelity_errors is a count, naturalness 1 to 5`,
      );
      rated[condition][id] = rating;
    }
  }
  const ids = Object.keys(key);
  const row = (name, of) =>
    console.log(name.padEnd(36), String(of("on")).padEnd(10), of("off"));
  const middle = (condition, pick) =>
    median(ids.map((id) => pick(runs[id][condition])).filter(Number.isFinite));
  const errors = (condition) =>
    ids.reduce((sum, id) => sum + rated[condition][id].fidelity_errors, 0);
  const gain = median(
    ids.map((id) => rated.on[id].naturalness - rated.off[id].naturalness),
  );

  if (simulated) console.log(`${SIMULATED}\n`);
  row("", (condition) => (condition === "on" ? "excerpts" : "none"));
  row("fidelity errors, total", errors);
  row("naturalness, median", (condition) =>
    median(ids.map((id) => rated[condition][id].naturalness)),
  );
  row("texts that got excerpts", (condition) =>
    ids.reduce((sum, id) => sum + +(runs[id][condition].references > 0), 0),
  );
  row("attempts not succeeded", (condition) =>
    ids.reduce(
      (sum, id) => sum + +(runs[id][condition].state !== "succeeded"),
      0,
    ),
  );
  row("delay to the first edit, median ms", (condition) =>
    middle(condition, (run) => run.prep_ms + run.first_edit_ms),
  );
  row("input tokens, median", (condition) =>
    middle(condition, (run) => run.input_tokens),
  );
  row("output tokens, median", (condition) =>
    middle(condition, (run) => run.output_tokens),
  );
  console.log(`\nnaturalness gain with excerpts, paired median: ${gain}`);
  const got = ids.filter((id) => runs[id].on.references > 0).length;
  if (got < 10) {
    console.log(
      `decision rule set before the run: no answer, only ${got} of ${ids.length} texts got excerpts`,
    );
    return;
  }
  const kept = errors("on") <= errors("off") && gain >= 0.5;
  console.log(
    `decision rule set before the run: ${kept ? "keep the excerpts" : "leave them off"}`,
  );
}

const main = process.argv[2] === "score" ? score : run;
Promise.resolve()
  .then(main)
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
