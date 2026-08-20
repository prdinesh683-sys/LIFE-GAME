/**
 * Human terminology layer (Phase 5, item 2).
 *
 * Internal identifiers never change — this module is the single place that
 * turns them into the words a normal person reads. Anything technical
 * (state hashes, provider error codes, schema ids, lifecycle vocabulary)
 * belongs behind a "Details" affordance, never in default copy.
 */

const RECOMMENDATION_STATUS: Record<string, string> = {
  pending: "Waiting for you",
  needs_reapproval: "Needs an update",
  approved: "Approved",
  applied: "Done",
  rejected: "Declined",
  expired: "No longer relevant",
  superseded: "Replaced by newer advice",
};

const PLAN_STATUS: Record<string, string> = {
  draft: "Draft",
  proposed: "Waiting for you",
  awaiting_approval: "Waiting for you",
  approved: "Ready to run",
  running: "In progress",
  paused: "Paused",
  completed: "Done",
  cancelled: "Stopped",
  rejected: "Declined",
  superseded: "Replaced by a newer plan",
  needs_replan: "Needs an update",
  failed: "Needs attention",
};

const TASK_STATUS: Record<string, string> = {
  pending: "Next step",
  blocked: "Waiting on an earlier step",
  waiting: "Waiting on an earlier step",
  ready: "Ready",
  awaiting_approval: "Needs your approval",
  running: "In progress",
  completed: "Done",
  done: "Done",
  skipped: "Skipped",
  cancelled: "Stopped",
  failed: "Needs attention",
  needs_replan: "Needs an update",
  stale: "Needs an update",
};

const CONCEPTS: Record<string, string> = {
  provenance: "Why I remember this",
  blueprint: "Game setup",
  economy: "Rewards & balance",
  stateHash: "State check",
  state_changed: "Your situation changed",
  expired: "No longer relevant",
  advisor: "Recommendations",
  agent: "Plans",
};

function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export function recommendationStatusLabel(status: string): string {
  return RECOMMENDATION_STATUS[status] ?? humanise(status);
}

export function planStatusLabel(status: string): string {
  return PLAN_STATUS[status] ?? humanise(status);
}

export function taskStatusLabel(status: string): string {
  return TASK_STATUS[status] ?? humanise(status);
}

export function conceptLabel(key: string): string {
  return CONCEPTS[key] ?? humanise(key);
}

/**
 * Strips machine detail out of an error before it reaches default UI. The raw
 * text stays available for a Details panel.
 */
export function friendlyError(raw: unknown, fallback = "That didn't work. Nothing was changed."): string {
  const text = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  if (!text) return fallback;
  const technical =
    /\b(stack|schema|hash|undefined|null|TypeError|SyntaxError|ECONN|HTTP \d{3}|\d{3} [A-Z][a-z]+ Error|\{|\})/i;
  if (technical.test(text) || text.length > 160) return fallback;
  return text;
}
