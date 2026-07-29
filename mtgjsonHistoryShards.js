(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeMtgjsonHistoryShards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function shardKeyForEntry(entry) {
    const setCode = String(entry && entry.set || "").trim().toLowerCase();
    return setCode.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function shardFileNameForKey(key) {
    let hash = 0;
    for (const character of String(key || "")) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `mtgjson-history-${(hash % 16).toString(16)}.js`;
  }

  function sourceFamily(version) {
    return String(version || "").split("+")[0];
  }

  function createHistoryShardCatalog(options = {}) {
    const documentObject = options.documentObject || root.document;
    const registry = options.registry || (root.CubeMtgjsonHistoryShardData = root.CubeMtgjsonHistoryShardData || {});
    const scriptRoot = String(options.scriptRoot || "").replace(/\/+$/, "");
    const loaders = new Map();

    function loadShard(key) {
      if (registry[key]) return Promise.resolve(registry[key]);
      if (!key || !documentObject || !documentObject.createElement) return Promise.resolve(null);
      const fileName = shardFileNameForKey(key);
      if (!loaders.has(fileName)) {
        const task = new Promise((resolve) => {
          const script = documentObject.createElement("script");
          script.async = true;
          script.src = `${scriptRoot ? `${scriptRoot}/` : ""}${fileName}`;
          script.onload = () => {
            script.remove();
            resolve();
          };
          script.onerror = () => {
            script.remove();
            resolve();
          };
          (documentObject.head || documentObject.documentElement).appendChild(script);
        });
        loaders.set(fileName, task);
      }
      return loaders.get(fileName).then(() => registry[key] || null);
    }

    async function load(index, scryfallIds) {
      const ids = [...new Set((Array.isArray(scryfallIds) ? scryfallIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean))];
      const byShard = new Map();
      ids.forEach((scryfallId) => {
        const entry = index && index.printingPrices && index.printingPrices[scryfallId];
        const key = shardKeyForEntry(entry);
        if (!key) return;
        const values = byShard.get(key) || [];
        values.push(scryfallId);
        byShard.set(key, values);
      });

      await Promise.all([...byShard.keys()].map(loadShard));
      const cards = {};
      let historyFrom = "";
      let historyTo = "";
      byShard.forEach((shardIds, key) => {
        const shard = registry[key];
        if (!shard || sourceFamily(shard.sourceVersion) !== sourceFamily(index && index.source && index.source.version)) return;
        if (shard.historyFrom && (!historyFrom || shard.historyFrom < historyFrom)) historyFrom = shard.historyFrom;
        if (shard.historyTo && shard.historyTo > historyTo) historyTo = shard.historyTo;
        shardIds.forEach((scryfallId) => {
          if (shard.cards && shard.cards[scryfallId]) cards[scryfallId] = shard.cards[scryfallId];
        });
      });
      return { cards, historyFrom, historyTo };
    }

    return { load };
  }

  return { createHistoryShardCatalog, shardFileNameForKey, shardKeyForEntry, sourceFamily };
});
