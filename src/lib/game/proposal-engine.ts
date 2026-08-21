import type { AuditEntry, ChangeProposal, GameSnapshot } from "./types";

/**
 * ProposalEngine — Deterministic governance for state modifications.
 *
 * Enforces the boundary:
 * LLM -> Structured Change Proposal -> Deterministic Validation -> User/Gate Approval -> Apply + Audit Log.
 */

export interface ValidationOutcome {
  valid: boolean;
  reason?: string;
  sanitizedDiff?: Record<string, unknown>;
}

export function validateChangeProposal(
  snapshot: GameSnapshot,
  proposal: ChangeProposal,
): ValidationOutcome {
  if (!proposal.summary || proposal.summary.trim().length < 3) {
    return { valid: false, reason: "Proposal summary is too short or empty." };
  }
  if (!proposal.rationale || proposal.rationale.trim().length < 3) {
    return { valid: false, reason: "Proposal must provide a concrete rationale." };
  }

  // Validate target existence for updates
  if (proposal.changeType === "update" || proposal.changeType === "resize") {
    if (!proposal.targetId) {
      return { valid: false, reason: "Target ID required for update/resize operations." };
    }
    if (proposal.targetType === "destination") {
      const exists = snapshot.destinations.some((d) => d.id === proposal.targetId);
      if (!exists) return { valid: false, reason: `Target destination ${proposal.targetId} not found.` };
    } else if (proposal.targetType === "quest") {
      const exists = snapshot.quests.some((q) => q.id === proposal.targetId);
      if (!exists) return { valid: false, reason: `Target quest ${proposal.targetId} not found.` };
    }
  }

  return { valid: true, sanitizedDiff: proposal.diffPayload };
}

export function createAuditEntry(
  proposal: ChangeProposal,
  previousState: Record<string, unknown> | null,
  newState: Record<string, unknown> | null,
): AuditEntry {
  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    proposalId: proposal.id,
    actor: proposal.proposedBy,
    action: `${proposal.changeType}_${proposal.targetType}`,
    target: proposal.targetId || proposal.targetType,
    reason: proposal.rationale,
    previousState,
    newState,
    timestamp: new Date().toISOString(),
  };
}
