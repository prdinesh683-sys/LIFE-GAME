#!/usr/bin/env node
/**
 * Phase 6 invariant guard.
 *
 * Unit tests cover behaviour; this script covers the structural product and
 * architecture decisions that must not regress silently.
 *
 * Exits non-zero (blocking the merge) if any invariant fails.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const failures = [];
const passes = [];

const read = (relPath) => readFileSync(join(root, relPath), "utf8");

function check(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) passes.push(name);
    else failures.push(`${name}\n        ${result}`);
  } catch (error) {
    failures.push(`${name}\n        threw: ${error.message}`);
  }
}

function collectTsx(dir, acc = []) {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      collectTsx(rel, acc);
    } else if (entry.endsWith(".tsx")) {
      acc.push(rel);
    }
  }
  return acc;
}

// --- Persistence / sync versions -------------------------------------------

check("DB_VERSION is 6", () => {
  const match = read("src/lib/data/indexeddb-repository.ts").match(
    /const DB_VERSION\s*=\s*(\d+)/,
  );
  if (!match) return "DB_VERSION declaration not found";
  return match[1] === "6" || `expected 6, found ${match[1]}`;
});

check("SYNC_SCHEMA_VERSION is 1", () => {
  const match = read("src/lib/sync/types.ts").match(
    /export const SYNC_SCHEMA_VERSION\s*=\s*(\d+)/,
  );
  if (!match) return "SYNC_SCHEMA_VERSION declaration not found";
  return match[1] === "1" || `expected 1, found ${match[1]}`;
});

// --- Product shape: exactly four primary destinations -----------------------

const PRIMARY_DESTINATIONS = ["Today", "Quests", "Chat", "Settings"];

check("exactly 4 primary destinations (Today, Quests, Chat, Settings)", () => {
  const src = read("src/components/app/app-shell.tsx");
  const block = src.match(/const PRIMARY_NAV\s*:[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) return "PRIMARY_NAV declaration not found";
  const labels = [
    ...block[1].matchAll(/\{\s*to:\s*"[^"]*",\s*label:\s*"([^"]+)"/g),
  ].map((m) => m[1]);
  if (labels.length !== 4) {
    return `expected 4 nav items, found ${labels.length}: ${labels.join(", ") || "none"}`;
  }
  const missing = PRIMARY_DESTINATIONS.filter((d) => !labels.includes(d));
  return missing.length === 0 || `missing destinations: ${missing.join(", ")}`;
});

// --- Phase 6A: time & rhythm ------------------------------------------------

check("time windows are morning / afternoon / evening", () => {
  const src = read("src/lib/game/time-window.ts");
  const missing = ["morning", "afternoon", "evening"].filter(
    (w) => !src.includes(`"${w}"`),
  );
  return missing.length === 0 || `missing window(s): ${missing.join(", ")}`;
});

check("miss recovery module is present", () => {
  read("src/lib/game/miss-recovery.ts");
  return true;
});

// --- Phase 6B: visible learning ---------------------------------------------

check("deterministic 'because' selector is present", () => {
  read("src/lib/advisor/because.ts");
  return true;
});

check("follow-through projection is present", () => {
  read("src/lib/memory/follow-through.ts");
  return true;
});

// --- Phase 5 terminology ----------------------------------------------------

const BANNED_UI_TERMS = ["Blueprint", "blueprint", "provenance", "stateHash", "economy"];

check("no internal terminology leaks into user-facing screens", () => {
  const files = [...collectTsx("src/routes"), ...collectTsx("src/components/app")];
  const offenders = [];
  for (const file of files) {
    const src = read(file);
    for (const term of BANNED_UI_TERMS) {
      // Match JSX text nodes only: >...term...<
      const pattern = new RegExp(`>[^<>{}]*\\b${term}\\b[^<>{}]*<`, "m");
      if (pattern.test(src)) offenders.push(`${file}: "${term}"`);
    }
  }
  return (
    offenders.length === 0 ||
    `visible terminology leak:\n        ${offenders.join("\n        ")}`
  );
});

// --- Report -----------------------------------------------------------------

for (const name of passes) console.log(`  PASS  ${name}`);
for (const name of failures) console.error(`  FAIL  ${name}`);
console.log(`\n${passes.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.error("\nPhase 6 invariants violated — blocking merge.");
  process.exit(1);
}
