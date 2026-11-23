import { get, set, del, createStore, type UseStore } from 'idb-keyval';

const store: UseStore = createStore('splice-db', 'keyval');

export const db = {
  get: <T>(key: string) => get<T>(key, store),
  set: (key: string, value: unknown) => set(key, value, store),
  del: (key: string) => del(key, store),
};

/** Zustand persist-compatible async storage. */
export const asyncStorage = {
  getItem: async (name: string) => (await db.get<string>(name)) ?? null,
  setItem: async (name: string, value: string) => { await db.set(name, value); },
  removeItem: async (name: string) => { await db.del(name); },
};

export function bytesUsed(): Promise<number> {
  return new Promise((resolve) => {
    if (navigator.storage?.estimate) navigator.storage.estimate().then((e) => resolve(e.usage ?? 0)).catch(() => resolve(0));
    else resolve(0);
  });
}
