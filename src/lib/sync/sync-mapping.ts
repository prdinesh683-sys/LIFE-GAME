import type { StoreName } from "../data/repository";
import { createSyncEvent } from "./sync-events";
import type { SyncEvent, SyncEventPayloadFile } from "./types";

/**
 * Which local stores participate in Drive sync, and how a record's last-touch
 * time is derived. Entities differ, so each store declares its own accessor.
 */
export interface SyncableStore {
  store: StoreName;
  eventType: string;
  touchedAt: (record: Record<string, unknown>) => string;
  label: (record: Record<string, unknown>) => string;
  /**
   * Outbound filter. Runs before upload so device-local or secret fields
   * (API keys, device ids) never reach the vault.
   */
  sanitize?: (record: Record<string, unknown>) => Record<string, unknown>;
  /**
   * Inbound merge. Returns the record to write locally, or null to skip.
   * Stores that only share part of their shape merge instead of overwriting.
   */
  mergeInbound?: (
    remote: Record<string, unknown>,
    local: Record<string, unknown> | null,
  ) => Record<string, unknown> | null;
}

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

/**
 * Authoritative configuration. Deterministic engines validate quests, advice and
 * plans against the blueprint and the economy config, so a second device that
 * ran on a materially different configuration would produce different verdicts
 * from the same game data. These therefore ride live sync, not backup only.
 */
export const SYNCABLE_STORES: SyncableStore[] = [
  {
    store: "blueprint",
    eventType: "upsert.blueprint",
    // updatedAt is the conflict-engine touch time; approvals are never silently undone.
    touchedAt: (r) => str(r["updatedAt"]) || str(r["approvedAt"]) || str(r["createdAt"]),
    label: () => "Personal blueprint",
  },
  {
    store: "settings",
    eventType: "upsert.gameConfig",
    touchedAt: (r) => str(r["updatedAt"]),
    label: () => "Game configuration",
    // Only the deterministic economy travels. Device id, theme, and every AI
    // provider setting (including keys) stay on this device.
    sanitize: (r) => ({ id: "settings", economy: r["economy"], updatedAt: str(r["updatedAt"]) }),
    // Merge, never overwrite: a remote config must not wipe local AI settings,
    // and with no local settings row yet there is nothing safe to merge into.
    mergeInbound: (remote, local) =>
      local ? { ...local, economy: remote["economy"], updatedAt: str(remote["updatedAt"]) } : null,
  },
  {
    store: "quests",
    eventType: "upsert.quest",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => str(r["name"], "Quest"),
  },
  {
    store: "questRuns",
    eventType: "upsert.questRun",
    touchedAt: (r) => str(r["endedAt"]) || str(r["startedAt"]),
    label: (r) => `Run · ${str(r["questName"], "quest")}`,
  },
  {
    store: "dailyStates",
    eventType: "upsert.dailyState",
    touchedAt: (r) => str(r["updatedAt"]),
    label: (r) => `Day ${str(r["id"])}`,
  },
  {
    store: "events",
    eventType: "append.activityEvent",
    touchedAt: (r) => str(r["timestamp"]),
    label: (r) => `Activity · ${str(r["type"], "event")}`,
  },
  {
    store: "boosts",
    eventType: "upsert.boost",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => str(r["name"], "Boost"),
  },
  {
    store: "drains",
    eventType: "upsert.drain",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => str(r["name"], "Drain"),
  },
  {
    store: "destinations",
    eventType: "upsert.destination",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => str(r["name"], "Destination"),
  },
  {
    store: "milestones",
    eventType: "upsert.milestone",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => str(r["name"], "Milestone"),
  },
  {
    store: "trophies",
    eventType: "upsert.trophy",
    touchedAt: (r) => str(r["earnedAt"]) || str(r["createdAt"]),
    label: (r) => str(r["name"], "Trophy"),
  },
  {
    store: "profile",
    eventType: "upsert.profile",
    touchedAt: (r) => str(r["updatedAt"]) || str(r["createdAt"]),
    label: () => "Player profile",
  },
  {
    store: "recommendations",
    eventType: "upsert.recommendation",
    // updatedAt is the local touch time the conflict engine reads, so a remote
    // event can never silently overwrite a decision made on this device.
    touchedAt: (r) => str(r["updatedAt"]) || str(r["decidedAt"]) || str(r["createdAt"]),
    label: (r) => `Advice · ${str(r["title"], "recommendation")}`,
  },
  {
    store: "recommendationHistory",
    eventType: "append.recommendationHistory",
    touchedAt: (r) => str(r["at"]),
    label: (r) => `Advice history · ${str(r["event"], "event")}`,
  },
  {
    store: "recommendationOutcomes",
    eventType: "upsert.recommendationOutcome",
    touchedAt: (r) => str(r["measuredAt"]),
    label: (r) => `Outcome · ${str(r["result"], "measured")}`,
  },
  {
    store: "memories",
    eventType: "upsert.memory",
    // updatedAt is the conflict-engine touch time; edits never silently overwrite.
    touchedAt: (r) => str(r["updatedAt"]) || str(r["createdAt"]),
    label: (r) => `Memory · ${str(r["kind"], "memory")}`,
  },
  {
    store: "memoryLinks",
    eventType: "upsert.memoryLink",
    touchedAt: (r) => str(r["updatedAt"]) || str(r["createdAt"]),
    label: (r) => `Memory link · ${str(r["relation"], "related_to")}`,
  },
  /* Phase 4C — Agent plans, tasks, actions and outcomes ride the same event log. */
  {
    store: "plans",
    eventType: "upsert.plan",
    // updatedAt is what the conflict engine compares: a stale remote copy can
    // never overwrite an approval, rejection or cancellation made here.
    touchedAt: (r) => str(r["updatedAt"]) || str(r["createdAt"]),
    label: (r) => `Plan · ${str(r["title"], "plan")}`,
  },
  {
    store: "tasks",
    eventType: "upsert.task",
    touchedAt: (r) => str(r["updatedAt"]) || str(r["createdAt"]),
    label: (r) => `Task · ${str(r["title"], "task")}`,
  },
  {
    store: "actionRecords",
    eventType: "upsert.actionRecord",
    touchedAt: (r) => str(r["updatedAt"]) || str(r["startedAt"]),
    label: (r) => `Agent action · ${str(r["actionType"], "action")}`,
  },
  {
    store: "agentRuns",
    eventType: "upsert.agentRun",
    touchedAt: (r) => str(r["updatedAt"]) || str(r["startedAt"]),
    label: () => "Agent run",
  },
  {
    store: "agentOutcomes",
    eventType: "upsert.agentOutcome",
    touchedAt: (r) => str(r["measuredAt"]),
    label: (r) => `Plan outcome · ${str(r["result"], "measured")}`,
  },
  {
    store: "agentFeedback",
    eventType: "upsert.agentFeedback",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => `Plan feedback · ${str(r["kind"], "feedback")}`,
  },
  {
    store: "decisionFeedback",
    eventType: "upsert.decisionFeedback",
    touchedAt: (r) => str(r["createdAt"]),
    label: (r) => `Decision · ${str(r["decision"], "recorded")}`,
  },
];

export function storeForEventType(eventType: string): SyncableStore | null {
  return SYNCABLE_STORES.find((entry) => entry.eventType === eventType) ?? null;
}

/** Records touched after the last successful sync become outbound events. */
export function buildOutboundEvents(input: {
  deviceId: string;
  since: string | null;
  records: { store: StoreName; rows: Record<string, unknown>[] }[];
}): SyncEvent[] {
  const events: SyncEvent[] = [];
  for (const group of input.records) {
    const config = SYNCABLE_STORES.find((entry) => entry.store === group.store);
    if (!config) continue;
    for (const row of group.rows) {
      const touched = config.touchedAt(row);
      if (input.since && touched && touched <= input.since) continue;
      const payloadRecord = config.sanitize ? config.sanitize(row) : row;
      events.push(
        createSyncEvent({
          deviceId: input.deviceId,
          eventType: config.eventType,
          timestamp: touched || new Date().toISOString(),
          eventId: `${input.deviceId}:${group.store}:${str(row["id"])}:${touched}`,
          payload: { store: group.store, id: str(row["id"]), record: payloadRecord },
        }),
      );
    }
  }
  return events;
}

export function describeEventEntity(event: SyncEventPayloadFile): {
  store: string;
  id: string;
  label: string;
} {
  const store = str(event.payload["store"], "unknown");
  const id = str(event.payload["id"], "unknown");
  const record = event.payload["record"];
  const config = storeForEventType(event.event_type);
  const label =
    config && record && typeof record === "object"
      ? config.label(record as Record<string, unknown>)
      : `${store} ${id}`;
  return { store, id, label };
}

/**
 * Prepare a remote record for local write. Stores with a partial contract merge
 * into the local row; everything else is written as-is.
 */
export function prepareInbound(
  eventType: string,
  remote: Record<string, unknown>,
  local: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const config = storeForEventType(eventType);
  if (!config) return null;
  return config.mergeInbound ? config.mergeInbound(remote, local) : remote;
}

/**
 * Fingerprint of the configuration deterministic engines validate against.
 * Two devices that agree on this agree on every deterministic verdict; if they
 * differ, the difference is visible instead of silent.
 */
export function configFingerprint(input: {
  blueprint: Record<string, unknown> | null | undefined;
  economy: unknown;
}): string {
  const bp = input.blueprint ?? {};
  const parts = JSON.stringify([
    bp["direction"] ?? "",
    bp["goals"] ?? [],
    bp["priorities"] ?? [],
    bp["constraints"] ?? [],
    bp["antiGoals"] ?? [],
    bp["preferredDifficulty"] ?? "",
    bp["approved"] ?? false,
    input.economy ?? {},
  ]);
  let hash = 0;
  for (let i = 0; i < parts.length; i += 1) {
    hash = (hash * 31 + parts.charCodeAt(i)) | 0;
  }
  return `cfg_${(hash >>> 0).toString(36)}`;
}
