import type { ActionRecordRow } from "./agent-types";

/**
 * PHASE 4C — executed-action ledger.
 *
 * Idempotency guard: a retry, a re-approval or a cross-device convergence event
 * can never execute the same action twice. The ledger is the single source of
 * truth for "did this already happen".
 */

export function completedEntry(
  records: ActionRecordRow[],
  idempotencyKey: string,
): ActionRecordRow | null {
  return (
    records.find((row) => row.idempotencyKey === idempotencyKey && row.status === "completed") ??
    null
  );
}

export function alreadyExecuted(records: ActionRecordRow[], idempotencyKey: string): boolean {
  return completedEntry(records, idempotencyKey) !== null;
}

export function attemptsFor(records: ActionRecordRow[], idempotencyKey: string): number {
  return records.filter((row) => row.idempotencyKey === idempotencyKey).length;
}

/** Deterministic dedupe used when remote events land through Phase 3 sync. */
export function dedupeByKey(records: ActionRecordRow[]): ActionRecordRow[] {
  const best = new Map<string, ActionRecordRow>();
  for (const row of records) {
    const current = best.get(row.idempotencyKey);
    if (!current) {
      best.set(row.idempotencyKey, row);
      continue;
    }
    // A completed record always wins over a pending/failed duplicate.
    if (current.status !== "completed" && row.status === "completed") {
      best.set(row.idempotencyKey, row);
    } else if (current.status === row.status && row.updatedAt > current.updatedAt) {
      best.set(row.idempotencyKey, row);
    }
  }
  return [...best.values()];
}
