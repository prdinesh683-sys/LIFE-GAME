import type { PermissionClass } from "../agent/agent-types";

/**
 * Remembered trust for repeated low-risk actions (Phase 5, item 13).
 *
 * Rules that cannot be bent:
 * - only action types on the eligible list may ever be trusted;
 * - HIGH_IMPACT is never eligible;
 * - trust removes a *repeat confirmation*, never deterministic validation;
 * - trust is scoped to one action type and is revocable at any time.
 */

/** Action types a player may streamline. Everything else always asks. */
export const TRUSTABLE_ACTION_TYPES = [
  "create_quest",
  "schedule_quest",
  "adjust_quest",
  "log_state",
] as const;

export type TrustableActionType = (typeof TRUSTABLE_ACTION_TYPES)[number];

/** Approvals of the same action type required before trust is offered. */
export const TRUST_THRESHOLD = 3;

export interface TrustGrant {
  actionType: string;
  grantedAt: string;
}

export function isTrustable(actionType: string, permission: PermissionClass): boolean {
  if (permission === "HIGH_IMPACT") return false;
  return (TRUSTABLE_ACTION_TYPES as readonly string[]).includes(actionType);
}

export function isTrusted(
  grants: TrustGrant[] | undefined,
  actionType: string,
  permission: PermissionClass,
): boolean {
  if (!isTrustable(actionType, permission)) return false;
  return (grants ?? []).some((g) => g.actionType === actionType);
}

/** Deterministic offer rule — never auto-grants; the player must accept. */
export function shouldOfferTrust(input: {
  actionType: string;
  permission: PermissionClass;
  approvalsOfType: number;
  grants: TrustGrant[] | undefined;
}): boolean {
  if (!isTrustable(input.actionType, input.permission)) return false;
  if (isTrusted(input.grants, input.actionType, input.permission)) return false;
  return input.approvalsOfType >= TRUST_THRESHOLD;
}

export function grantTrust(
  grants: TrustGrant[] | undefined,
  actionType: string,
  permission: PermissionClass,
  now: string = new Date().toISOString(),
): TrustGrant[] {
  if (!isTrustable(actionType, permission)) return grants ?? [];
  const existing = grants ?? [];
  if (existing.some((g) => g.actionType === actionType)) return existing;
  return [...existing, { actionType, grantedAt: now }];
}

export function revokeTrust(grants: TrustGrant[] | undefined, actionType: string): TrustGrant[] {
  return (grants ?? []).filter((g) => g.actionType !== actionType);
}

export function trustLabel(actionType: string): string {
  switch (actionType) {
    case "create_quest":
      return "Creating a quest";
    case "schedule_quest":
      return "Scheduling a quest";
    case "adjust_quest":
      return "Adjusting a quest";
    case "log_state":
      return "Logging how you feel";
    default:
      return actionType.replace(/_/g, " ");
  }
}

/**
 * Runtime wiring helpers (Phase 5 completion).
 *
 * These are the only functions the advisor runtime uses to decide whether an
 * approval may be streamlined. They never speak about validation: deterministic
 * validation and state-freshness checks run on every approval regardless.
 */

/** Counts previously applied approvals per action type. */
export function approvalsByActionType(
  records: { status: string; action: { type: string } }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    if (record.status !== "applied") continue;
    const type = record.action?.type;
    if (!type) continue;
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export interface StreamlineDecision {
  /** True only when the *repeat confirmation* may be skipped. */
  streamlined: boolean;
  /** Always true — trust never removes deterministic validation. */
  requiresValidation: true;
  /** Always true — trust never removes the freshness re-check. */
  requiresFreshState: true;
  reason: string;
}

export function streamlineDecision(input: {
  actionType: string;
  permission: PermissionClass;
  grants: TrustGrant[] | undefined;
  /** Deterministic staleness verdict for this recommendation right now. */
  stale: boolean;
}): StreamlineDecision {
  const base = { requiresValidation: true, requiresFreshState: true } as const;
  if (input.permission === "HIGH_IMPACT") {
    return { ...base, streamlined: false, reason: "High-impact actions always ask." };
  }
  if (!isTrusted(input.grants, input.actionType, input.permission)) {
    return { ...base, streamlined: false, reason: "You haven't streamlined this action type." };
  }
  if (input.stale) {
    return { ...base, streamlined: false, reason: "Your situation changed, so this asks again." };
  }
  return { ...base, streamlined: true, reason: `${trustLabel(input.actionType)} is streamlined.` };
}
