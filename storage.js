(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
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

  return { createStorage, isCubeData };
});
