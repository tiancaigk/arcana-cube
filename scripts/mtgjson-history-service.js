"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  INDEX_FORMAT,
  INDEX_VERSION,
  buildPriceSeries,
  mergeSeries,
  validateIndex
} = require("../mtgjsonPrices.js");
const {
  downloadFile,
  fetchEurUsdRates,
  streamSelectedPrices
} = require("./build-mtgjson-price-index.js");

const apiRoot = "https://mtgjson.com/api/v5";

function normalizeIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)))];
}

function historyRange(cards) {
  const dates = Object.values(cards).flatMap((entry) => [
    ...(entry.foil || []),
    ...(entry.nonfoil || [])
  ].map((point) => point[0])).sort();
  return { from: dates[0] || "", to: dates[dates.length - 1] || "" };
}

function createMtgjsonHistoryService(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const indexFile = options.indexFile || path.join(rootDir, "mtgjson-price-index.json");
  const cacheRoot = options.cacheRoot || path.join(rootDir, ".cache", "mtgjson");
  const download = options.downloadFile || downloadFile;
  const fetchRates = options.fetchEurUsdRates || fetchEurUsdRates;
  const streamPrices = options.streamSelectedPrices || streamSelectedPrices;
  let queue = Promise.resolve();

  async function readIndex() {
    const index = JSON.parse(await fsp.readFile(indexFile, "utf8"));
    if (!validateIndex(index)) throw new Error("MTGJSON 价格索引格式无效");
    return index;
  }

  async function loadCachedEntry(cacheDir, legacyCacheDir, scryfallId) {
    try {
      const payload = JSON.parse(await fsp.readFile(path.join(cacheDir, `${scryfallId}.json`), "utf8"));
      if (payload.entry) return payload.entry;
    } catch (_error) {
      // Try the former per-version cache location.
    }
    try {
      const payload = JSON.parse(await fsp.readFile(path.join(legacyCacheDir, `${scryfallId}.json`), "utf8"));
      return payload.entry || null;
    } catch (_error) {
      return null;
    }
  }

  async function saveCachedEntry(cacheDir, scryfallId, sourceVersion, entry) {
    const file = path.join(cacheDir, `${scryfallId}.json`);
    const temporary = `${file}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify({ sourceVersion, entry }));
    await fsp.rename(temporary, file);
  }

  async function loadHistory(scryfallIds) {
    const ids = normalizeIds(scryfallIds);
    if (!ids.length) throw new Error("没有需要补全历史的卡牌版本");
    if (ids.length > 100) throw new Error("单次最多补全 100 个卡牌版本");

    const index = await readIndex();
    const sourceVersion = String(index.source && index.source.version || "").trim();
    if (!sourceVersion) throw new Error("MTGJSON 索引缺少版本信息");
    const versionDir = path.join(cacheRoot, sourceVersion.replace(/[^a-z0-9._+-]/gi, "_"));
    const historyCacheDir = path.join(cacheRoot, "history");
    const legacyCacheDir = path.join(versionDir, "history");
    await fsp.mkdir(versionDir, { recursive: true });
    await fsp.mkdir(historyCacheDir, { recursive: true });

    const cards = {};
    const unresolved = [];
    const missing = new Map();
    for (const scryfallId of ids) {
      const indexed = index.cards[scryfallId] || index.printingPrices && index.printingPrices[scryfallId];
      const uuid = String(indexed && indexed.uuid || "");
      if (!uuid) {
        unresolved.push(scryfallId);
        continue;
      }
      const cached = await loadCachedEntry(historyCacheDir, legacyCacheDir, scryfallId);
      if (cached) {
        const entry = {
          uuid,
          foil: mergeSeries(cached.foil, indexed.foil, index.providers).slice(-90),
          nonfoil: mergeSeries(cached.nonfoil, indexed.nonfoil, index.providers).slice(-90)
        };
        cards[scryfallId] = entry;
        await saveCachedEntry(historyCacheDir, scryfallId, sourceVersion, entry);
      } else {
        missing.set(scryfallId, uuid);
      }
    }

    if (missing.size) {
      const priceFile = path.join(versionDir, "AllPrices.json.gz");
      await download(`${apiRoot}/AllPrices.json.gz`, priceFile);
      const priceEntries = await streamPrices(priceFile, new Set(missing.values()));
      const exchange = await fetchRates(priceEntries);
      for (const [scryfallId, uuid] of missing) {
        const priceEntry = priceEntries.get(uuid);
        const entry = {
          uuid,
          foil: buildPriceSeries(priceEntry, "foil", index.providers, exchange.rates),
          nonfoil: buildPriceSeries(priceEntry, "nonfoil", index.providers, exchange.rates)
        };
        cards[scryfallId] = entry;
        await saveCachedEntry(historyCacheDir, scryfallId, sourceVersion, entry);
      }
    }

    const range = historyRange(cards);
    return {
      format: INDEX_FORMAT,
      version: INDEX_VERSION,
      generatedAt: new Date().toISOString(),
      providers: index.providers,
      source: {
        ...(index.source || {}),
        historyFrom: range.from,
        historyTo: range.to || index.source && index.source.date || ""
      },
      stats: {
        requestedCards: ids.length,
        indexedCards: Object.keys(cards).length,
        unresolvedCards: unresolved.length
      },
      cards
    };
  }

  function getHistory(scryfallIds) {
    const task = queue.then(() => loadHistory(scryfallIds));
    queue = task.catch(() => {});
    return task;
  }

  return { getHistory };
}

module.exports = { createMtgjsonHistoryService, historyRange, normalizeIds };
