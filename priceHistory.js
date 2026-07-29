(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubePriceHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRICE_HISTORY_FORMAT = "arcana-cube-price-history";
  const PRICE_HISTORY_VERSION = 3;

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

  function emptyPriceHistory(cubeId = "") {
    return {
      version: PRICE_HISTORY_VERSION,
      cubeId: String(cubeId || ""),
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
    const refresh = source.refresh && typeof source.refresh === "object" ? {
      checked: Math.max(0, Number(source.refresh.checked) || 0),
      updated: Math.max(0, Number(source.refresh.updated) || 0),
      missing: Math.max(0, Number(source.refresh.missing) || 0),
      ...(Number(source.refresh.fallback) > 0 ? { fallback: Math.max(0, Number(source.refresh.fallback) || 0) } : {})
    } : null;
    const sourceSummary = {};
    Object.entries(source.sourceSummary || {}).forEach(([key, value]) => {
      const count = Math.max(0, Math.floor(Number(value) || 0));
      if (key && count) sourceSummary[key] = count;
    });
    const backfillSource = source.backfill && typeof source.backfill === "object" ? source.backfill : null;
    const backfill = backfillSource ? {
      origin: String(backfillSource.origin || "mtgjson"),
      added: Math.max(0, Math.floor(Number(backfillSource.added) || 0)),
      providers: Object.fromEntries(Object.entries(backfillSource.providers || {}).flatMap(([key, value]) => {
        const count = Math.max(0, Math.floor(Number(value) || 0));
        return key && count ? [[key, count]] : [];
      }))
    } : null;
    const syncSource = source.sync && typeof source.sync === "object" ? source.sync : null;
    const sync = syncSource ? {
      origin: String(syncSource.origin || "mtgjson"),
      mode: "replace",
      windowDays: Math.max(1, Math.floor(Number(syncSource.windowDays) || 90)),
      providers: Object.fromEntries(Object.entries(syncSource.providers || {}).flatMap(([key, value]) => {
        const count = Math.max(0, Math.floor(Number(value) || 0));
        return key && count ? [[key, count]] : [];
      }))
    } : null;
    return {
      date,
      totalUsd: totalUsd === null ? computedTotal : totalUsd,
      cardCount,
      pricedCount,
      missingCount: Math.max(0, Number.isFinite(Number(source.missingCount)) ? Number(source.missingCount) : cardCount - pricedCount),
      cards,
      ...(refresh ? { refresh } : {}),
      ...(Object.keys(sourceSummary).length ? { sourceSummary } : {}),
      ...(backfill && backfill.added ? { backfill } : {}),
      ...(sync ? { sync } : {})
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
      cubeId: typeof source.cubeId === "string" ? source.cubeId : "",
      currency: "USD",
      updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : "",
      snapshots
    };
  }

  function sortedSnapshots(history) {
    const normalized = normalizePriceHistory(history);
    return Object.entries(normalized.snapshots).sort(([a], [b]) => a.localeCompare(b));
  }

  function hasDailySnapshot(history, date = new Date()) {
    const key = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dateKey(date);
    return Object.prototype.hasOwnProperty.call(normalizePriceHistory(history).snapshots, key);
  }

  function recordDailySnapshot(history, cards, options = {}) {
    const date = options.date || dateKey(options.now || new Date());
    const next = normalizePriceHistory(history);
    const snapshotCards = {};
    let totalUsd = 0;
    let pricedCount = 0;
    const sourceSummary = {};
    (cards || []).forEach((card) => {
      const price = getPriceNumber(card, card && card.finish);
      if (price === null) return;
      snapshotCards[cardPriceKey(card, card.finish)] = price;
      totalUsd += price;
      pricedCount += 1;
      const finish = normalizeFinish(card && card.finish);
      const priceSource = card && card.priceSources && card.priceSources[finish] || card && card.priceSource || {};
      const sourceKey = priceSource.origin && priceSource.provider
        ? `${priceSource.origin}:${priceSource.provider}`
        : "legacy";
      sourceSummary[sourceKey] = (sourceSummary[sourceKey] || 0) + 1;
    });
    next.snapshots[date] = {
      date,
      totalUsd: normalizeUsd(totalUsd) || 0,
      cardCount: (cards || []).length,
      pricedCount,
      missingCount: Math.max(0, (cards || []).length - pricedCount),
      cards: snapshotCards,
      sourceSummary,
      ...(options.refresh ? { refresh: {
        checked: Math.max(0, Number(options.refresh.checked) || 0),
        updated: Math.max(0, Number(options.refresh.updated) || 0),
        missing: Math.max(0, Number(options.refresh.missing) || 0),
        ...(Number(options.refresh.fallback) > 0 ? { fallback: Math.max(0, Number(options.refresh.fallback) || 0) } : {})
      } } : {})
    };
    next.updatedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
    return next;
  }

  function offsetDateKey(date, days) {
    const value = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(value.getTime())) return "";
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  }

  function syncPriceHistoryWindow(history, cards, getSeries, options = {}) {
    if (typeof getSeries !== "function") throw new Error("价格历史同步缺少价格序列");
    const next = normalizePriceHistory(history);
    const sourceCards = Array.isArray(cards) ? cards : [];
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(options.endDate || ""))
      ? String(options.endDate)
      : dateKey(options.now || new Date());
    const windowDays = Math.max(1, Math.floor(Number(options.windowDays) || 90));
    const cutoffDate = offsetDateKey(endDate, -(windowDays - 1));
    const pointsByDate = new Map();
    const providers = {};

    sourceCards.forEach((card) => {
      const finish = normalizeFinish(card && card.finish);
      const key = cardPriceKey(card, finish);
      (getSeries(card, finish) || []).forEach((point) => {
        const date = String(point && point.date || "");
        const usd = normalizeUsd(point && point.usd);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < cutoffDate || date > endDate || usd === null) return;
        const datePoints = pointsByDate.get(date) || new Map();
        datePoints.set(key, { key, usd, provider: String(point.provider || "unknown") });
        pointsByDate.set(date, datePoints);
      });
    });

    let pricePoints = 0;
    let removedLocalPoints = 0;
    let createdSnapshots = 0;
    let replacedSnapshots = 0;
    const touchedDates = [];
    [...pointsByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([date, pointsByKey]) => {
      const previous = next.snapshots[date] ? normalizeSnapshot(date, next.snapshots[date]) : null;
      const snapshotCards = {};
      const sourceSummary = {};
      const providersForDate = {};
      pointsByKey.forEach((point) => {
        snapshotCards[point.key] = point.usd;
        const sourceKey = `mtgjson:${point.provider}`;
        sourceSummary[sourceKey] = (sourceSummary[sourceKey] || 0) + 1;
        providersForDate[point.provider] = (providersForDate[point.provider] || 0) + 1;
        providers[point.provider] = (providers[point.provider] || 0) + 1;
        pricePoints += 1;
      });
      const values = Object.values(snapshotCards);
      if (previous) {
        removedLocalPoints += Object.keys(previous.cards).filter((key) => !Object.prototype.hasOwnProperty.call(snapshotCards, key)).length;
        replacedSnapshots += 1;
      } else {
        createdSnapshots += 1;
      }
      next.snapshots[date] = {
        date,
        totalUsd: normalizeUsd(values.reduce((sum, value) => sum + value, 0)) || 0,
        cardCount: sourceCards.length,
        pricedCount: values.length,
        missingCount: Math.max(0, sourceCards.length - values.length),
        cards: snapshotCards,
        sourceSummary,
        sync: {
          origin: String(options.origin || "mtgjson"),
          mode: "replace",
          windowDays,
          providers: providersForDate
        }
      };
      touchedDates.push(date);
    });
    if (touchedDates.length) next.updatedAt = (options.now instanceof Date ? options.now : new Date()).toISOString();
    return {
      history: next,
      windowDays,
      cutoffDate,
      endDate,
      syncedSnapshots: touchedDates.length,
      pricePoints,
      removedLocalPoints,
      createdSnapshots,
      replacedSnapshots,
      providers,
      firstDate: touchedDates[0] || "",
      lastDate: touchedDates[touchedDates.length - 1] || ""
    };
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

  function buildPriceTrendIndex(history) {
    const latestPoints = new Map();
    const totals = [];
    sortedSnapshots(history).forEach(([date, snapshot]) => {
      const totalUsd = normalizeUsd(snapshot.totalUsd);
      if (totalUsd !== null) totals.push({ date, usd: totalUsd });
      Object.entries(snapshot.cards || {}).forEach(([key, value]) => {
        const usd = normalizeUsd(value);
        if (usd === null) return;
        const points = latestPoints.get(key) || [];
        points.push({ date, usd });
        if (points.length > 2) points.shift();
        latestPoints.set(key, points);
      });
    });
    return {
      byKey: new Map([...latestPoints.entries()].map(([key, points]) => [key, priceTrend(points)])),
      totalSeries: totals,
      totalTrend: priceTrend(totals)
    };
  }

  function compareSnapshotPrices(normalized, cards, previousDate, targetDate) {
    if (!previousDate || !targetDate || previousDate === targetDate) return [];
    const latest = normalized.snapshots[targetDate];
    const previous = normalized.snapshots[previousDate];
    if (!latest || !previous) return [];
    return (cards || []).map((card) => {
      const key = cardPriceKey(card, card && card.finish);
      const previousUsd = normalizeUsd(previous.cards && previous.cards[key]);
      const latestUsd = normalizeUsd(latest.cards && latest.cards[key]);
      if (previousUsd === null || latestUsd === null) return null;
      const delta = Math.round((latestUsd - previousUsd) * 100) / 100;
      if (!delta) return null;
      return {
        card: clone(card),
        key,
        direction: delta > 0 ? "up" : "down",
        delta,
        previousUsd,
        latestUsd,
        previousDate,
        latestDate: targetDate,
        percent: previousUsd ? Math.round(delta / previousUsd * 10000) / 100 : null
      };
    }).filter(Boolean).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || String(a.card && a.card.name || "").localeCompare(String(b.card && b.card.name || "")));
  }

  function periodStartDate(date, period) {
    const value = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(value.getTime())) return "";
    if (period === "week") {
      const mondayOffset = (value.getUTCDay() + 6) % 7;
      value.setUTCDate(value.getUTCDate() - mondayOffset);
    } else if (period === "month") {
      value.setUTCDate(1);
    }
    return value.toISOString().slice(0, 10);
  }

  function priceChangesForPeriod(history, cards, period = "today", date = dateKey()) {
    const normalized = normalizePriceHistory(history);
    const selectedPeriod = ["today", "week", "month", "history"].includes(period) ? period : "today";
    const dates = Object.keys(normalized.snapshots).filter((snapshotDate) => snapshotDate <= date).sort();
    const targetDate = selectedPeriod === "today" ? (dates.includes(date) ? date : "") : dates[dates.length - 1] || "";
    if (!targetDate) return { period: selectedPeriod, previousDate: "", latestDate: "", changes: [] };
    let previousDate = "";
    if (selectedPeriod === "today") {
      const targetIndex = dates.indexOf(targetDate);
      previousDate = targetIndex > 0 ? dates[targetIndex - 1] : "";
    } else if (selectedPeriod === "history") {
      previousDate = dates[0] || "";
    } else {
      const startDate = periodStartDate(targetDate, selectedPeriod);
      previousDate = dates.find((snapshotDate) => snapshotDate >= startDate && snapshotDate <= targetDate) || "";
    }
    return {
      period: selectedPeriod,
      previousDate,
      latestDate: targetDate,
      changes: compareSnapshotPrices(normalized, cards, previousDate, targetDate)
    };
  }

  function topPriceMovers(changes, direction, limit = 20) {
    const maximum = Math.max(0, Math.floor(Number(limit) || 0));
    return (changes || [])
      .filter((change) => change && change.direction === direction)
      .sort((a, b) => {
        const percentA = a.percent === null ? -1 : Math.abs(a.percent);
        const percentB = b.percent === null ? -1 : Math.abs(b.percent);
        return percentB - percentA
          || Math.abs(b.delta) - Math.abs(a.delta)
          || String(a.card && a.card.name || "").localeCompare(String(b.card && b.card.name || ""));
      })
      .slice(0, maximum);
  }

  function dailyPriceChanges(history, cards, date = dateKey()) {
    return priceChangesForPeriod(history, cards, "today", date).changes;
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
    buildPriceTrendIndex,
    cardPriceKey,
    cardSeries,
    dailyPriceChanges,
    dateKey,
    emptyPriceHistory,
    hasDailySnapshot,
    normalizePriceHistory,
    parsePriceHistoryData,
    periodStartDate,
    priceTrend,
    priceChangesForPeriod,
    recordDailySnapshot,
    syncPriceHistoryWindow,
    topPriceMovers,
    totalSeries,
    wrapPriceHistoryData
  };
});
