import { PROJECT_STORAGE_DB_VERSION } from "./constants";

export function openProjectStorageDatabase(
  factory: IDBFactory,
  dbName: string,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(dbName, PROJECT_STORAGE_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.createObjectStore(storeName, { keyPath: "namespaceKey" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName)) {
        database.close();
        reject(new DOMException(`Missing object store ${storeName}`, "InvalidStateError"));
        return;
      }
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB failed to open"));
    request.onblocked = () => reject(new DOMException("IndexedDB open was blocked", "BlockedError"));
  });
}
