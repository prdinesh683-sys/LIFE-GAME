import type { GameSnapshot } from "../game/types";
import { STORE_NAMES, type LocalRepository, type StoreMap, type StoreName } from "./repository";

/**
 * IndexedDB implementation of LocalRepository. Browser-only: it is constructed
 * lazily from client code, never during SSR.
 */

const DB_NAME = "personal-life-rpg";
const DB_VERSION = 6;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open local database"));
  });
}

function tx<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error("Local database error"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Local database aborted"));
    void Promise.resolve(run(transaction)).then((value) => {
      result = value;
    });
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database request failed"));
  });
}

export class IndexedDbRepository implements LocalRepository {
  readonly kind = "indexeddb";
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (!this.db) this.db = await openDb();
  }

  private async database(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) throw new Error("Local database unavailable");
    return this.db;
  }

  async list<K extends StoreName>(store: K): Promise<StoreMap[K][]> {
    const db = await this.database();
    return tx(db, [store], "readonly", (transaction) =>
      req(transaction.objectStore(store).getAll() as IDBRequest<StoreMap[K][]>),
    );
  }

  async get<K extends StoreName>(store: K, id: string): Promise<StoreMap[K] | null> {
    const db = await this.database();
    const value = await tx(db, [store], "readonly", (transaction) =>
      req(transaction.objectStore(store).get(id) as IDBRequest<StoreMap[K] | undefined>),
    );
    return value ?? null;
  }

  async put<K extends StoreName>(store: K, value: StoreMap[K]): Promise<void> {
    const db = await this.database();
    await tx(db, [store], "readwrite", (transaction) => {
      transaction.objectStore(store).put(value);
    });
  }

  async putMany<K extends StoreName>(store: K, values: StoreMap[K][]): Promise<void> {
    if (!values.length) return;
    const db = await this.database();
    await tx(db, [store], "readwrite", (transaction) => {
      const objectStore = transaction.objectStore(store);
      for (const value of values) objectStore.put(value);
    });
  }

  async remove(store: StoreName, id: string): Promise<void> {
    const db = await this.database();
    await tx(db, [store], "readwrite", (transaction) => {
      transaction.objectStore(store).delete(id);
    });
  }

  async clear(store: StoreName): Promise<void> {
    const db = await this.database();
    await tx(db, [store], "readwrite", (transaction) => {
      transaction.objectStore(store).clear();
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.database();
    await tx(db, STORE_NAMES, "readwrite", (transaction) => {
      for (const name of STORE_NAMES) transaction.objectStore(name).clear();
    });
  }

  async loadSnapshot(): Promise<GameSnapshot | null> {
    const profile = await this.get("profile", "profile");
    const settings = await this.get("settings", "settings");
    if (!profile || !settings) return null;

    const [
      blueprint,
      destinations,
      milestones,
      boosts,
      drains,
      quests,
      questRuns,
      dailyStates,
      events,
      attributes,
      trophies,
    ] = await Promise.all([
      this.get("blueprint", "blueprint"),
      this.list("destinations"),
      this.list("milestones"),
      this.list("boosts"),
      this.list("drains"),
      this.list("quests"),
      this.list("questRuns"),
      this.list("dailyStates"),
      this.list("events"),
      this.list("attributes"),
      this.list("trophies"),
    ]);

    return {
      profile,
      settings,
      blueprint,
      destinations,
      milestones,
      boosts,
      drains,
      quests,
      questRuns,
      dailyStates,
      events,
      attributes,
      trophies,
    };
  }

  async exportAll(): Promise<Record<string, unknown[]>> {
    const out: Record<string, unknown[]> = {};
    for (const name of STORE_NAMES) {
      out[name] = await this.list(name);
    }
    return out;
  }

  async importAll(data: Record<string, unknown[]>): Promise<void> {
    await this.clearAll();
    for (const name of STORE_NAMES) {
      const rows = data[name];
      if (Array.isArray(rows) && rows.length) {
        await this.putMany(name, rows as StoreMap[typeof name][]);
      }
    }
  }
}

let instance: IndexedDbRepository | null = null;

export function getLocalRepository(): IndexedDbRepository {
  if (typeof indexedDB === "undefined") {
    throw new Error("Local storage is only available in the browser.");
  }
  if (!instance) instance = new IndexedDbRepository();
  return instance;
}