// The one switch for the style excerpts, read by the route and by the pages that talk about them.
// Pages built ahead of time read it at build time, so changing it takes a deployment. Case and the
// spaces around it do not matter, and false, 0 and no mean off too.
const OFF = new Set(["off", "false", "0", "no"]);

export const referencesEnabled = () =>
  !OFF.has((process.env.STYLE_REFERENCES ?? "").trim().toLowerCase());
