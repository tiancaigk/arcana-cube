(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeMtgjsonPrices = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INDEX_FORMAT = "arcana-cube-mtgjson-prices";
  const INDEX_VERSION = 2;
  const PROVIDER_ORDER = ["tcgplayer", "manapool", "cardkingdom", "cardmarket"];
  const FINISH_KEYS = { foil: "foil", nonfoil: "nonfoil" };

  function normalizeFinish(value) {
    return value === "nonfoil" ? "nonfoil" : "foil";
  }

  function normalizeUsd(value) {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100) / 100;
  }

  function normalizeExchangeRate(value) {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) return null;
    return Math.round(rate * 1000000) / 1000000;
  }

  function exchangeRateForDate(rates, date) {
    const entries = rates instanceof Map ? [...rates.entries()] : Object.entries(rates || {});
    return entries
      .filter(([rateDate, rate]) => rateDate <= date && normalizeExchangeRate(rate) !== null)
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([rateDate, rate]) => ({ date: rateDate, rate: normalizeExchangeRate(rate) }))[0] || null;
  }

  function validateIndex(payload) {
    return Boolean(
      payload
      && payload.format === INDEX_FORMAT
      && Number(payload.version) === INDEX_VERSION
      && Array.isArray(payload.providers)
      && payload.cards
      && typeof payload.cards === "object"
    );
  }

  function normalizeSeries(series, providers = PROVIDER_ORDER) {
    if (!Array.isArray(series)) return [];
    const byDate = new Map();
    series.forEach((point) => {
      if (!Array.isArray(point) || !/^\d{4}-\d{2}-\d{2}$/.test(String(point[0] || ""))) return;
      const usd = normalizeUsd(point[1]);
      const providerIndex = Number(point[2]);
      if (usd === null || !Number.isInteger(providerIndex) || !providers[providerIndex]) return;
      const exchangeRate = normalizeExchangeRate(point[3]);
      byDate.set(point[0], [
        point[0],
        usd,
        providerIndex,
        ...(providers[providerIndex] === "cardmarket" && exchangeRate !== null
          ? [exchangeRate, /^\d{4}-\d{2}-\d{2}$/.test(String(point[4] || "")) ? point[4] : point[0]]
          : [])
      ]);
    });
    return [...byDate.values()].sort(([dateA], [dateB]) => dateA.localeCompare(dateB));
  }

  function mergeSeries(existing, incoming, providers = PROVIDER_ORDER) {
    return normalizeSeries([...(existing || []), ...(incoming || [])], providers);
  }

  function buildPriceSeries(priceEntry, finish, providers = PROVIDER_ORDER, exchangeRates = {}) {
    const priceKey = normalizeFinish(finish) === "foil" ? "foil" : "normal";
    const paper = priceEntry && priceEntry.paper || {};
    const dates = new Set();
    providers.forEach((provider) => {
      const list = paper[provider];
      if (list && (list.currency === "USD" || provider === "cardmarket" && list.currency === "EUR")) {
        Object.keys(list.retail && list.retail[priceKey] || {}).forEach((date) => dates.add(date));
      }
    });
    return [...dates].sort().flatMap((date) => {
      for (let providerIndex = 0; providerIndex < providers.length; providerIndex += 1) {
        const provider = providers[providerIndex];
        const list = paper[provider];
        if (!list) continue;
        const rawPrice = list.retail && list.retail[priceKey] && list.retail[priceKey][date];
        if (list.currency === "USD") {
          const usd = normalizeUsd(rawPrice);
          if (usd !== null) return [[date, usd, providerIndex]];
        }
        if (provider === "cardmarket" && list.currency === "EUR") {
          const eur = normalizeUsd(rawPrice);
          const exchange = exchangeRateForDate(exchangeRates, date);
          const usd = eur !== null && exchange ? normalizeUsd(eur * exchange.rate) : null;
          if (usd !== null) return [[date, usd, providerIndex, exchange.rate, exchange.date]];
        }
      }
      return [];
    });
  }

  function cardEntry(index, card) {
    if (!validateIndex(index)) return null;
    const scryfallId = String(card && card.scryfallId || "").trim();
    return scryfallId ? index.cards[scryfallId] || null : null;
  }

  function priceSeries(index, card, finish = card && card.finish) {
    const entry = cardEntry(index, card);
    if (!entry) return [];
    const providers = index.providers;
    return normalizeSeries(entry[FINISH_KEYS[normalizeFinish(finish)]], providers).map(([date, usd, providerIndex, exchangeRate, exchangeRateDate]) => {
      const provider = providers[providerIndex];
      return {
        date,
        usd,
        provider,
        providerIndex,
        origin: "mtgjson",
        currency: "USD",
        ...(provider === "cardmarket" ? {
          convertedFrom: "EUR",
          exchangeRate,
          exchangeRateDate
        } : {})
      };
    });
  }

  function lookupPrice(index, card, finish = card && card.finish, date = index && index.source && index.source.date) {
    const series = priceSeries(index, card, finish);
    if (!series.length) return null;
    if (date) {
      const eligible = series.filter((point) => point.date <= date);
      return eligible[eligible.length - 1] || null;
    }
    return series[series.length - 1];
  }

  function providerLabel(provider) {
    return ({
      tcgplayer: "TCGplayer",
      manapool: "ManaPool",
      cardkingdom: "Card Kingdom",
      cardmarket: "Cardmarket"
    })[provider] || String(provider || "");
  }

  function buildIndexScript(index) {
    const serialized = JSON.stringify(index)
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
    return `(function (root) { root.CubeMtgjsonPriceIndex = ${serialized}; })(typeof globalThis !== "undefined" ? globalThis : this);\n`;
  }

  function createMtgjsonPriceCatalog(options = {}) {
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
    const indexUrl = options.indexUrl || "mtgjson-price-index.json";
    const loadFallback = typeof options.loadFallback === "function" ? options.loadFallback : null;
    const preferFallback = Boolean(options.preferFallback);
    if (!fetchImpl && !loadFallback) throw new Error("当前环境不支持 MTGJSON 价格查询");
    let indexPromise;

    async function validatePayload(payload) {
      if (!validateIndex(payload)) throw new Error("MTGJSON 价格索引格式无效");
      return payload;
    }

    async function fetchIndex() {
      if (!fetchImpl) throw new Error("当前环境不支持 MTGJSON 价格网络查询");
      const response = await fetchImpl(indexUrl, { cache: "no-cache", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`MTGJSON 价格索引加载失败 (${response.status})`);
      return validatePayload(await response.json());
    }

    async function loadFallbackIndex() {
      if (!loadFallback) throw new Error("MTGJSON 本地价格索引不可用");
      return validatePayload(await loadFallback());
    }

    function loadIndex() {
      if (!indexPromise) {
        indexPromise = (preferFallback && loadFallback
          ? loadFallbackIndex()
          : fetchIndex().catch((error) => {
            if (!loadFallback) throw error;
            return loadFallbackIndex();
          }))
          .catch((error) => {
            indexPromise = null;
            throw error;
          });
      }
      return indexPromise;
    }

    async function lookup(card, finish = card && card.finish) {
      const index = await loadIndex();
      return {
        price: lookupPrice(index, card, finish),
        entry: cardEntry(index, card),
        source: index.source || null
      };
    }

    function clearCache() {
      indexPromise = null;
    }

    return { clearCache, loadIndex, lookup };
  }

  return {
    INDEX_FORMAT,
    INDEX_VERSION,
    PROVIDER_ORDER,
    buildIndexScript,
    buildPriceSeries,
    cardEntry,
    createMtgjsonPriceCatalog,
    exchangeRateForDate,
    lookupPrice,
    mergeSeries,
    normalizeSeries,
    priceSeries,
    providerLabel,
    validateIndex
  };
});
