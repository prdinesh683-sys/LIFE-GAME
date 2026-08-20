import { describe, expect, it } from "vitest";

import { SYNC_SCHEMA_VERSION } from "../types";
import { createSyncEvent, toUploadPayload } from "../sync-events";
import { SYNCABLE_STORES, buildOutboundEvents, prepareInbound, configFingerprint } from "../sync-mapping";

/**
 * The wire contract. SYNC_SCHEMA_VERSION describes the shape below, and nothing
 * else. Adding a syncable store reuses this envelope and must NOT bump it;
 * changing the envelope must.
 */
describe("sync schema version", () => {
  it("is separate from the local database version", () => {
    // Deliberately asserted as a literal: DB_VERSION has moved to 6 across
    // phases while the wire envelope never changed shape.
    expect(SYNC_SCHEMA_VERSION).toBe(1);
  });

  it("stamps every uploaded event with the wire version, not the db version", () => {
    const event = createSyncEvent({
      deviceId: "device-a",
      eventType: "upsert.quest",
      payload: { store: "quests", id: "q1", record: { id: "q1" } },
    });
    expect(event.schema_version).toBe(SYNC_SCHEMA_VERSION);
    expect(toUploadPayload(event).schema_version).toBe(SYNC_SCHEMA_VERSION);
  });

  it("keeps the { store, id, record } envelope for every syncable store", () => {
    for (const config of SYNCABLE_STORES) {
      const events = buildOutboundEvents({
        deviceId: "device-a",
        since: null,
        records: [
          { store: config.store, rows: [{ id: "x1", updatedAt: new Date().toISOString() }] },
        ],
      });

      for (const event of events) {
        expect(Object.keys(event.payload).sort()).toEqual(["id", "record", "store"]);
        expect(event.schema_version).toBe(SYNC_SCHEMA_VERSION);
      }
    }
  });
});

describe("authoritative configuration sync", () => {
  it("syncs the blueprint and the economy settings", () => {
    const stores = SYNCABLE_STORES.map((s) => s.store);
    expect(stores).toContain("blueprint");
    expect(stores).toContain("settings");
  });

  it("never puts AI provider settings or the device id on the wire", () => {
    const config = SYNCABLE_STORES.find((s) => s.store === "settings")!;
    const sanitized = config.sanitize!({
      id: "settings",
      deviceId: "device-a",
      theme: "dark",
      economy: { sparkBase: 10 },
      updatedAt: "2026-01-01T00:00:00.000Z",
      ai: { cloud: { apiKey: "secret-key" } },
    });
    const wire = JSON.stringify(sanitized);
    expect(wire).not.toContain("secret-key");
    expect(wire).not.toContain("device-a");
    expect(sanitized["economy"]).toEqual({ sparkBase: 10 });
  });

  it("merges inbound config instead of overwriting local AI settings", () => {
    const merged = prepareInbound(
      "upsert.gameConfig",
      { id: "settings", economy: { sparkBase: 20 }, updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "settings", deviceId: "device-b", economy: { sparkBase: 10 }, ai: { mode: "off" } },
    );
    expect(merged).toMatchObject({
      deviceId: "device-b",
      ai: { mode: "off" },
      economy: { sparkBase: 20 },
    });
  });

  it("refuses to create a settings row from a remote event alone", () => {
    expect(
      prepareInbound("upsert.gameConfig", { id: "settings", economy: {} }, null),
    ).toBeNull();
  });

  it("fingerprints configuration deterministically and notices drift", () => {
    const a = configFingerprint({ blueprint: { direction: "health" }, economy: { sparkBase: 10 } });
    const b = configFingerprint({ blueprint: { direction: "health" }, economy: { sparkBase: 10 } });
    const c = configFingerprint({ blueprint: { direction: "health" }, economy: { sparkBase: 11 } });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
