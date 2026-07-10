(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeSelectors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createCubeSelectors(core, priceHistory) {
    if (!core || !priceHistory) throw new Error("派生数据选择器缺少依赖");
    let cardsCache = null;
    let statsCache = null;
    let cardIndexCache = null;
    let analyticsCache = { cardsSource: null, dataRevision: null, values: new Map() };
    let priceIndexCache = null;
    let priceViewCache = null;

    function filterKey(filters = {}) {
      return [filters.query || "", filters.color || "all", filters.type || "all", filters.finish || "all", filters.japanPrint || "all"].join("\u0000");
    }

    function selectCards(cards, dataRevision, filters) {
      const key = filterKey(filters);
      if (cardsCache && cardsCache.cardsSource === cards && cardsCache.dataRevision === dataRevision && cardsCache.filterKey === key) return cardsCache.value;
      const selected = core.sortCards(core.filterCards(cards || [], filters || {}));
      const groups = selected.reduce((result, card) => {
        const bucket = core.getCardBucket(card);
        if (!result.has(bucket)) result.set(bucket, []);
        result.get(bucket).push(card);
        return result;
      }, new Map());
      const value = { cards: selected, groups };
      cardsCache = { cardsSource: cards, dataRevision, filterKey: key, value };
      return value;
    }

    function selectStats(cards, dataRevision) {
      if (statsCache && statsCache.cardsSource === cards && statsCache.dataRevision === dataRevision) return statsCache.value;
      const value = core.computeStats(cards || []);
      statsCache = { cardsSource: cards, dataRevision, value };
      return value;
    }

    function cardIndex(cards, dataRevision) {
      if (cardIndexCache && cardIndexCache.cardsSource === cards && cardIndexCache.dataRevision === dataRevision) return cardIndexCache.value;
      const value = new Map((cards || []).map((card) => [card.id, card]));
      cardIndexCache = { cardsSource: cards, dataRevision, value };
      return value;
    }

    function cardById(cards, dataRevision, id) {
      return cardIndex(cards, dataRevision).get(id) || null;
    }

    function selectPriceIndex(history, historyRevision) {
      if (priceIndexCache && priceIndexCache.historySource === history && priceIndexCache.historyRevision === historyRevision) return priceIndexCache.value;
      const value = priceHistory.buildPriceTrendIndex(history);
      priceIndexCache = { historySource: history, historyRevision, value };
      return value;
    }

    function selectPriceView(cards, dataRevision, history, historyRevision) {
      if (priceViewCache && priceViewCache.cardsSource === cards && priceViewCache.dataRevision === dataRevision && priceViewCache.historySource === history && priceViewCache.historyRevision === historyRevision) return priceViewCache.value;
      let currentTotal = 0;
      let missingCount = 0;
      let latestUpdatedAt = null;
      (cards || []).forEach((card) => {
        const price = core.getPriceNumber(card, card.finish);
        if (price === null) missingCount += 1;
        else currentTotal += price;
        const updatedAt = Date.parse(card.priceUpdatedAt || "");
        if (Number.isFinite(updatedAt) && (latestUpdatedAt === null || updatedAt > latestUpdatedAt)) latestUpdatedAt = updatedAt;
      });
      const index = selectPriceIndex(history, historyRevision);
      const value = { ...index, currentTotal: Math.round(currentTotal * 100) / 100, missingCount, latestUpdatedAt };
      priceViewCache = { cardsSource: cards, dataRevision, historySource: history, historyRevision, value };
      return value;
    }

    function trendForCard(priceView, card, finish = card && card.finish) {
      return priceView && priceView.byKey.get(priceHistory.cardPriceKey(card, finish)) || null;
    }

    function selectAnalytics(cards, dataRevision, color = "all") {
      if (analyticsCache.cardsSource !== cards || analyticsCache.dataRevision !== dataRevision) {
        analyticsCache = { cardsSource: cards, dataRevision, values: new Map() };
      }
      if (analyticsCache.values.has(color)) return analyticsCache.values.get(color);
      const selected = color === "all" ? (cards || []) : (cards || []).filter((card) => core.getCardBucket(card) === color);
      const value = { cards: selected, stats: core.computeStats(selected) };
      analyticsCache.values.set(color, value);
      return value;
    }

    return { selectCards, selectStats, selectPriceView, trendForCard, selectAnalytics, cardById };
  }

  return { createCubeSelectors };
});
