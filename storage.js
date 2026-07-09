(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const WORKSPACE_FORMAT = "arcana-cube-workspace";
  const WORKSPACE_VERSION = 1;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isCubeData(value) {
    return Boolean(value && typeof value === "object" && value.meta && typeof value.meta.name === "string" && Array.isArray(value.cards));
  }

  function createStorage(storage, key) {
    return {
      load(fallback) {
        try {
          const saved = JSON.parse(storage.getItem(key));
          return isCubeData(saved) ? saved : clone(fallback);
        } catch (error) {
          return clone(fallback);
        }
      },
      save(data) {
        if (!isCubeData(data)) throw new Error("Cube 数据格式无效");
        storage.setItem(key, JSON.stringify(data));
      }
    };
  }

  function createSerialWriteQueue(onError = () => {}) {
    let tail = Promise.resolve();
    return {
      enqueue(task, context) {
        tail = tail
          .then(() => task())
          .catch((error) => Promise.resolve(onError(error, context)).catch(() => {}));
        return tail;
      },
      flush() {
        return tail;
      }
    };
  }

  function wrapWorkspaceData(data) {
    if (!isCubeData(data)) throw new Error("Cube 数据格式无效");
    return {
      format: WORKSPACE_FORMAT,
      version: WORKSPACE_VERSION,
      savedAt: new Date().toISOString(),
      data: clone(data)
    };
  }

  function parseWorkspaceData(text) {
    const payload = JSON.parse(text);
    if (isCubeData(payload)) return payload;
    if (payload && payload.format === WORKSPACE_FORMAT && isCubeData(payload.data)) return payload.data;
    throw new Error("Cube 文件格式无效");
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 请求失败"));
    });
  }

  function createHandleStore(indexedDB, dbName = "arcana-cube-storage", storeName = "handles") {
    if (!indexedDB) {
      return {
        supported: false,
        async load() { return null; },
        async save() { return false; },
        async clear() { return false; }
      };
    }

    let dbPromise;

    function openDatabase() {
      if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(dbName, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error || new Error("IndexedDB 打开失败"));
        });
      }
      return dbPromise;
    }

    async function withStore(mode, task) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        Promise.resolve()
          .then(() => task(store))
          .then(resolve, reject);
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 事务失败"));
      });
    }

    return {
      supported: true,
      async load(key) {
        return withStore("readonly", (store) => requestToPromise(store.get(key)));
      },
      async save(key, value) {
        return withStore("readwrite", (store) => requestToPromise(store.put(value, key)));
      },
      async clear(key) {
        return withStore("readwrite", (store) => requestToPromise(store.delete(key)));
      }
    };
  }

  return { WORKSPACE_FORMAT, WORKSPACE_VERSION, createStorage, createSerialWriteQueue, createHandleStore, isCubeData, parseWorkspaceData, wrapWorkspaceData };
});
