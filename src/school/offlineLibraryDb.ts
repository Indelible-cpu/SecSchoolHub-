import type { DigitalResourceCategory, DigitalResourceFormLevel } from './types';

export interface OfflineDigitalResourceRecord {
  id: string;
  schoolId: string;
  title: string;
  author: string;
  subject: string;
  formLevel: DigitalResourceFormLevel;
  category: DigitalResourceCategory;
  examYear: string;
  summary: string;
  content: string;
  allowOffline: boolean;
  savedAt: string;
}

const DB_NAME = 'SecSchoolHubOfflineLibrary';
const DB_VERSION = 1;
const STORE_NAME = 'resources';

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('schoolId', 'schoolId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveDigitalResourceOffline(
  resource: OfflineDigitalResourceRecord
): Promise<boolean> {
  const database = await openOfflineDb();
  if (!database) return false;

  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        ...resource,
        savedAt: resource.savedAt || new Date().toISOString(),
      });
      tx.oncomplete = () => {
        database.close();
        resolve(true);
      };
      tx.onerror = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}

export async function saveDigitalResourcesBatchOffline(
  resources: OfflineDigitalResourceRecord[]
): Promise<number> {
  const database = await openOfflineDb();
  if (!database || resources.length === 0) return 0;

  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      let count = 0;
      for (const item of resources) {
        if (!item.allowOffline) continue;
        store.put({
          ...item,
          savedAt: item.savedAt || new Date().toISOString(),
        });
        count += 1;
      }
      tx.oncomplete = () => {
        database.close();
        resolve(count);
      };
      tx.onerror = () => {
        database.close();
        resolve(0);
      };
    } catch {
      database.close();
      resolve(0);
    }
  });
}

export async function getOfflineDigitalResources(
  schoolId?: string
): Promise<OfflineDigitalResourceRecord[]> {
  const database = await openOfflineDb();
  if (!database) return [];

  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = schoolId ? store.index('schoolId').getAll(schoolId) : store.getAll();
      req.onsuccess = () => {
        const list = (Array.isArray(req.result) ? req.result : []) as OfflineDigitalResourceRecord[];
        list.sort((a, b) => a.title.localeCompare(b.title));
        database.close();
        resolve(list);
      };
      req.onerror = () => {
        database.close();
        resolve([]);
      };
    } catch {
      database.close();
      resolve([]);
    }
  });
}

export async function removeOfflineDigitalResource(id: string): Promise<boolean> {
  const database = await openOfflineDb();
  if (!database) return false;

  return new Promise((resolve) => {
    try {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => {
        database.close();
        resolve(true);
      };
      tx.onerror = () => {
        database.close();
        resolve(false);
      };
    } catch {
      database.close();
      resolve(false);
    }
  });
}
