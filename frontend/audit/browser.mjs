// Browser-side helpers: pages that report their own problems, web vitals, frame timing.
import { issues } from "./lib.mjs";

// Requests the audit makes fail on purpose; their console echo is not a finding
const EXPECTED_CONSOLE = /Failed to load resource/;

export async function openPage(context, label) {
  const page = await context.newPage();
  const where = () =>
    `${label} @ ${new URL(page.url() || "http://x/").pathname}`;
  page.on("pageerror", (error) =>
    issues.push({ where: where(), kind: "exception", text: error.message }),
  );
  page.on("console", (message) => {
    if (message.type() === "error" && !EXPECTED_CONSOLE.test(message.text())) {
      issues.push({
        where: where(),
        kind: "console",
        text: message.text().slice(0, 200),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(reason)) {
      issues.push({
        where: where(),
        kind: "request",
        text: `${request.url()} ${reason}`,
      });
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (response.status() < 400 || url.includes("/api/rewrite")) return;
    if (url.includes("/nope")) return;
    issues.push({
      where: where(),
      kind: `http ${response.status()}`,
      text: url,
    });
  });
  return page;
}

// Registers observers before any page script runs
export const vitalsInit = () => {
  window.__v = { cls: 0, lcp: 0, longTasks: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      if (!entry.hadRecentInput) window.__v.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__v.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__v.longTasks.push(entry.duration);
  }).observe({ type: "longtask", buffered: true });
};

export async function readVitals(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      ttfb: Math.round(nav.responseStart),
      fcp: Math.round(fcp?.startTime ?? -1),
      lcp: Math.round(window.__v.lcp),
      cls: Number(window.__v.cls.toFixed(4)),
      domReady: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      longTasks: window.__v.longTasks.length,
      worstTask: Math.round(Math.max(0, ...window.__v.longTasks)),
    };
  });
}

// Samples frame-to-frame time while `action` runs; a frame over 50 ms is a visible stutter
export async function frameStats(page, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__sampling) requestAnimationFrame(tick);
    };
    window.__sampling = true;
    requestAnimationFrame(tick);
  });
  await action();
  const frames = await page.evaluate(() => {
    window.__sampling = false;
    return window.__frames.slice(2);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    frames: frames.length,
    p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
    worst: Math.round(sorted.at(-1) ?? 0),
    slow: frames.filter((ms) => ms > 50).length,
  };
}

export async function overflowX(page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}
