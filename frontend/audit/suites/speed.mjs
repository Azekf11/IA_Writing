// Is it fluid? Page vitals, interaction cost, and the route's own overhead.
import { openPage, readVitals, vitalsInit, frameStats } from "../browser.mjs";
import {
  check,
  createUser,
  deleteUser,
  expect,
  median,
  percentile,
  sessionCookies,
  warn,
} from "../lib.mjs";

const TEXT =
  "The mayor spoke for an hour. Nobody in the room moved at all until the very end of it.";

export async function run(t) {
  const { env, mock } = t;

  // ---- page vitals, three cold loads each, median reported ----
  for (const path of ["/en", "/en/history", "/en/privacy"]) {
    await check("speed", `${path}: loads fast and does not shift`, async () => {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        const ctx = await t.browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        await ctx.addInitScript(vitalsInit);
        const page = await openPage(ctx, "speed");
        await page.goto(`${t.base}${path}`, { waitUntil: "load" });
        await page.waitForTimeout(600);
        runs.push(await readVitals(page));
        await ctx.close();
      }
      const pick = (key) => median(runs.map((r) => r[key]));
      const v = {
        ttfb: pick("ttfb"),
        fcp: pick("fcp"),
        lcp: pick("lcp"),
        cls: Math.max(...runs.map((r) => r.cls)),
        tasks: pick("longTasks"),
      };
      expect(v.cls <= 0.1, `layout shift ${v.cls}`);
      expect(v.lcp <= 2500, `largest paint at ${v.lcp} ms`);
      return `ttfb ${v.ttfb} ms, first paint ${v.fcp} ms, largest paint ${v.lcp} ms, shift ${v.cls}, long tasks ${v.tasks}`;
    });
  }

  await check(
    "speed",
    "no blocking script: the page is interactive soon after load",
    async () => {
      const ctx = await t.browser.newContext();
      await ctx.addInitScript(vitalsInit);
      const page = await openPage(ctx, "speed");
      await page.goto(`${t.base}/en`, { waitUntil: "load" });
      await page.waitForTimeout(800);
      const v = await readVitals(page);
      await ctx.close();
      expect(v.worstTask <= 200, `longest main-thread task ${v.worstTask} ms`);
      return `longest task ${v.worstTask} ms`;
    },
  );

  await check(
    "speed",
    "a phone on a slow 4G connection still gets the page in a few seconds",
    async () => {
      const ctx = await t.browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
      });
      const page = await ctx.newPage();
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      const started = Date.now();
      await page.goto(`${t.base}/en`, { waitUntil: "load" });
      await page.getByLabel("Your text").waitFor();
      const ms = Date.now() - started;
      await ctx.close();
      if (ms > 5000) warn(`${ms} ms`);
      return `${ms} ms with a 4x slower CPU`;
    },
  );

  // ---- the route's own overhead: model answers instantly, so what remains is ours ----
  const user = await createUser(env, "speed");
  try {
    const ctx = await t.browser.newContext();
    await ctx.addCookies(await sessionCookies(env, user));
    // The daily limit is 20, so stay under it
    await check(
      "speed",
      "route overhead without the model (18 requests, model answers at once)",
      async () => {
        mock.state.delayMs = 0;
        const prep = [];
        const total = [];
        let cold = "";
        for (let i = 0; i < 18; i++) {
          const response = await ctx.request.post(`${t.base}/api/rewrite`, {
            data: { text: `${TEXT} Run ${i}.`, locale: "en" },
          });
          expect(
            response.status() === 200,
            `run ${i} gave ${response.status()}`,
          );
          const header = response.headers()["server-timing"];
          const p = Number(/prep;dur=(\d+)/.exec(header)[1]);
          const all = Number(/total;dur=(\d+)/.exec(header)[1]);
          if (i === 0) cold = `first request ${all} ms (prep ${p} ms)`;
          else {
            prep.push(p);
            total.push(all);
          }
          await new Promise((r) => setTimeout(r, 450));
        }
        mock.state.delayMs = 400;
        const p95 = percentile(total, 95);
        expect(p95 <= 400, `p95 of our own time is ${p95} ms`);
        return `warm: median ${median(total)} ms, p95 ${p95} ms (quota + style search ${median(prep)} ms); ${cold}`;
      },
    );
    await ctx.close();
  } finally {
    await deleteUser(env, user);
  }

  await check("speed", "opening the appearance panel is instant", async () => {
    const ctx = await t.browser.newContext();
    const page = await openPage(ctx, "speed");
    await page.goto(`${t.base}/en`, { waitUntil: "networkidle" });
    const stats = await frameStats(page, async () => {
      for (let i = 0; i < 4; i++) {
        await page.getByRole("button", { name: "Appearance" }).click();
        await page.getByRole("radio", { name: "Night" }).click();
        await page.getByRole("radio", { name: "Day" }).click();
        await page.keyboard.press("Escape");
      }
    });
    await ctx.close();
    expect(
      stats.slow <= 3,
      `${stats.slow} slow frames, worst ${stats.worst} ms`,
    );
    return `worst frame ${stats.worst} ms`;
  });
}
