// Turns the audit's results into audit/report.md.

export const SIMULATED =
  "Simulated: the model in this run is a local stand-in, so its edits, timings and token counts are not Claude's.";

const firstLine = (detail) => String(detail).split("\n")[0];

function summary(results, issues) {
  const count = (status) => results.filter((r) => r.status === status).length;
  return `${results.length} checks: ${count("pass")} passed, ${count("warn")} warnings, ${count("fail")} failed, ${issues.length} browser issues`;
}

function needsAttention(results, issues) {
  if (results.length === 0) return ["Everything: no check ran."];
  const open = results.filter((r) => r.status !== "pass");
  if (open.length === 0 && issues.length === 0) {
    return ["Nothing: every check passed and the browser stayed quiet."];
  }
  const listed = open.flatMap((r) => [
    `- **${r.status.toUpperCase()}** [${r.area}] ${r.name}`,
    ...String(r.detail)
      .split("\n")
      .filter(Boolean)
      .map((line) => `  - ${line}`),
  ]);
  return issues.length > 0
    ? [...listed, `- **FAIL** ${issues.length} browser issues, listed below`]
    : listed;
}

// The same problem repeats across pages, so each one is listed once
function browserIssues(issues) {
  if (issues.length === 0) {
    return ["No exception, console error or broken request."];
  }
  const seen = new Map();
  for (const { kind, text, where } of issues) {
    const key = `${kind}|${text}`;
    if (!seen.has(key)) seen.set(key, { kind, text, where, times: 0 });
    seen.get(key).times++;
  }
  return [...seen.values()].map(
    ({ kind, text, where, times }) =>
      `- ${kind} (${times}x, first at ${where}): ${firstLine(text)}`,
  );
}

function byArea(results) {
  const areas = [...new Set(results.map((r) => r.area))];
  return [
    "| Area | Passed | Warnings | Failed |",
    "| ---- | -----: | -------: | -----: |",
    ...areas.map((area) => {
      const of = (status) =>
        results.filter((r) => r.area === area && r.status === status).length;
      return `| ${area} | ${of("pass")} | ${of("warn")} | ${of("fail")} |`;
    }),
  ];
}

function everyCheck(results) {
  return results.map(({ status, area, name, detail, ms }) => {
    const note = detail ? `: ${firstLine(detail)}` : "";
    return `- ${status} [${area}] ${name} (${ms} ms)${note}`;
  });
}

export function writeReport(results, issues, only = []) {
  return [
    "# Site audit",
    "",
    SIMULATED,
    "",
    ...(only.length
      ? [`**Partial run: only ${only.join(", ")}.** Run it whole to judge.`, ""]
      : []),
    summary(results, issues),
    "",
    "## Needs attention",
    "",
    ...needsAttention(results, issues),
    "",
    "## Seen in the browser",
    "",
    ...browserIssues(issues),
    "",
    "## By area",
    "",
    ...byArea(results),
    "",
    "## Every check",
    "",
    ...everyCheck(results),
    "",
  ].join("\n");
}
