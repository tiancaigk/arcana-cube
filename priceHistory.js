(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubePriceHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRICE_HISTORY_FORMAT = "arcana-cube-price-history";
  const PRICE_HISTORY_VERSION = 1;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function dateKey(date = new Date()) {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) return dateKey(new Date());
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function normalizeFinish(finish) {
    return finish === "nonfoil" ? "nonfoil" : "foil";
  }

  function normalizeUsd(value) {
    if (value === null || value === undefined || value === "") return null;
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) return null;
    return Math.round(amount * 100) / 100;
  }

  function getUsdPrice(card, finish) {
    const prices = card && card.prices ? card.prices : {};
    return normalizeFinish(finish) === "foil" ? prices.usdFoil || prices.usdEtched || "" : prices.usd || "";
  }

  function getPriceNumber(card, finish) {
    return normalizeUsd(getUsdPrice(card, finish));
  }

  function cardPriceKey(card, finish = card && card.finish) {
    const normalizedFinish = normalizeFinish(finish);
    const scryfallId = String(card && card.scryfallId || "").trim();
    if (scryfallId) return `${scryfallId}|${normalizedFinish}`;
    const set = String(card && card.set || "").trim().toUpperCase();
    const collectorNumber = String(card && card.collectorNumber || card && card.collector_number || "").trim();
    if (set && collectorNumber) return `${set}:${collectorNumber}|${normalizedFinish}`;
    const fallback = String(card && (card.id || card.name) || "unknown").trim();
    return `${fallback}|${normalizedFinish}`;
  }

  function emptyPriceHistory() {
    return {
      version: PRICE_HISTORY_VERSION,
      currency: "USD",
      updatedAt: "",
      snapshots: {}
    };
  }

  function normalizeSnapshot(date, snapshot) {
    const source = snapshot && typeof snapshot === "object" ? snapshot : {};
    const cards = {};
    Object.entries(source.cards || {}).forEach(([key, value]) => {
      const price = normalizeUsd(value);
      if (key && price !== null) cards[key] = price;
    });
    const totalUsd = normalizeUsd(source.totalUsd);
    const computedTotal = normalizeUsd(Object.values(cards).reduce((sum, value) => sum + value, 0)) || 0;
    const pricedCount = Number.isFinite(Number(source.pricedCount)) ? Number(source.pricedCount) : Object.keys(cards).length;
    const cardCount = Number.isFinite(Number(source.cardCount)) ? Number(source.cardCount) : pricedCount;
    return {
      date,
      totalUsd: totalUsd === null ? computedTotal : totalUsd,
      cardCount,
      pricedCount,
      missingCount: Math.max(0, Number.isFinite(Number(source.missingCount)) ? Number(source.missingCount) : cardCount - pricedCount),
      cards
    };
  }

  function normalizePriceHistory(value) {
    const source = value && typeof value === "object" ? value : {};
    const snapshots = {};
    Object.entries(source.snapshots || {}).forEach(([date, snapshot]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      snapshots[date] = normalizeSnapshot(date, snapshot);
    });
    return {
      version: PRICE_HISTORY_VERSION,
      currency: "USD",
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
      snapshots
    };
  }

  function sortedSnapshots(history) {
    const normalized = normalizePriceHistory(history);
    return Object.entries(normalized.snapshots).sort(([a], [b]) => a.localeCompare(b));
  }

  function recordDailySnapshot(history, cards, options = {}) {
    const date = options.date || dateKey(options.now || new Date());
    const next = normalizePriceHistory(history);
    const snapshotCards = {};
    let totalUsd = 0;
    let pricedCount = 0;
    (cards || []).forEach((card) => {
      const price = getPriceNumber(card, card && card.finish);
      if (price === null) return;
      snapshotCards[cardPriceKey(card, card.finish)] = price;
      totalUsd += price;
      pricedCount += 1;
    });
    next.snapshots[date] = {
      date,
      totalUsd: normalizeUsd(totalUsd) || 0,
      cardCount: (cards || []).length,
      pricedCount,
      missingCount: Math.max(0, (cards || []).length - pricedCount),
      cards: snapshotCards
    };
    next.updatedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
    return next;
  }

  function cardSeries(history, card, finish = card && card.finish) {
    const key = cardPriceKey(card, finish);
    return sortedSnapshots(history)
      .map(([date, snapshot]) => ({ date, usd: normalizeUsd(snapshot.cards && snapshot.cards[key]) }))
      .filter((point) => point.usd !== null);
  }

  function totalSeries(history) {
    return sortedSnapshots(history)
      .map(([date, snapshot]) => ({ date, usd: normalizeUsd(snapshot.totalUsd) }))
      .filter((point) => point.usd !== null);
  }

  function priceTrend(points) {
    const series = (points || []).filter((point) => normalizeUsd(point && point.usd) !== null);
    if (series.length < 2) return null;
    const previous = series[series.length - 2];
    const latest = series[series.length - 1];
    const previousUsd = normalizeUsd(previous.usd);
    const latestUsd = normalizeUsd(latest.usd);
    const delta = Math.round((latestUsd - previousUsd) * 100) / 100;
    if (!delta) return null;
    return {
      direction: delta > 0 ? "up" : "down",
      delta,
      previousUsd,
      latestUsd,
      previousDate: previous.date,
      latestDate: latest.date,
      percent: previousUsd ? Math.round(delta / previousUsd * 10000) / 100 : null
    };
  }

  function wrapPriceHistoryData(history) {
    return {
      format: PRICE_HISTORY_FORMAT,
      version: PRICE_HISTORY_VERSION,
      savedAt: new Date().toISOString(),
      data: clone(normalizePriceHistory(history))
    };
  }

  function parsePriceHistoryData(text) {
    const payload = JSON.parse(text);
    if (payload && payload.format === PRICE_HISTORY_FORMAT) return normalizePriceHistory(payload.data);
    return normalizePriceHistory(payload);
  }

  return {
    PRICE_HISTORY_FORMAT,
    PRICE_HISTORY_VERSION,
    cardPriceKey,
    cardSeries,
    dateKey,
    emptyPriceHistory,
    normalizePriceHistory,
    parsePriceHistoryData,
    priceTrend,
    recordDailySnapshot,
    totalSeries,
    wrapPriceHistoryData
  };
});
