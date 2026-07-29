(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubePriceMaintenance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function applyPriceUpdates(targets, cardsByPrinting, options = {}) {
    const source = Array.isArray(targets) ? targets : [];
    const printingKey = options.printingKey;
    const findCardLocation = options.findCardLocation;
    const replacePrinting = options.replacePrinting;
    const needsPriceRefresh = options.needsPriceRefresh;
    if ([printingKey, findCardLocation, replacePrinting, needsPriceRefresh].some((value) => typeof value !== "function")) {
      throw new Error("价格维护缺少必要依赖");
    }
    const result = { checked: source.length, matched: 0, updated: 0, missing: 0, skipped: 0 };
    source.forEach((target) => {
      const printing = cardsByPrinting.get(printingKey(target.set, target.collectorNumber));
      if (!printing) {
        result.missing += 1;
        return;
      }
      result.matched += 1;
      const location = findCardLocation(target.id);
      if (!location) {
        result.skipped += 1;
        return;
      }
      const current = location.cards[location.index];
      const samePrinting = current.scryfallId
        ? current.scryfallId === target.scryfallId
        : current.set === target.set && current.collectorNumber === target.collectorNumber;
      if (!samePrinting || (!options.force && !needsPriceRefresh(current))) {
        result.skipped += 1;
        return;
      }
      location.cards[location.index] = replacePrinting(current, printing);
      result.updated += 1;
    });
    return result;
  }

  function priceSource(point) {
    return point ? {
      origin: "mtgjson",
      provider: point.provider,
      currency: "USD",
      date: point.date,
      ...(point.convertedFrom ? {
        convertedFrom: point.convertedFrom,
        exchangeRate: point.exchangeRate,
        exchangeRateDate: point.exchangeRateDate
      } : {})
    } : null;
  }

  function applyIndexedPriceUpdates(targets, index, options = {}) {
    const source = Array.isArray(targets) ? targets : [];
    const lookupPrice = options.lookupPrice;
    const findCardLocation = options.findCardLocation;
    const needsPriceRefresh = options.needsPriceRefresh;
    if ([lookupPrice, findCardLocation, needsPriceRefresh].some((value) => typeof value !== "function")) {
      throw new Error("MTGJSON 价格维护缺少必要依赖");
    }
    const now = options.now instanceof Date ? options.now : new Date();
    const result = { checked: source.length, matched: 0, updated: 0, missing: 0, skipped: 0, fallback: 0, converted: 0, unresolvedIds: [], updatedIds: [] };
    source.forEach((target) => {
      const location = findCardLocation(target.id);
      if (!location) {
        result.skipped += 1;
        return;
      }
      const current = location.cards[location.index];
      const samePrinting = current.scryfallId
        ? current.scryfallId === target.scryfallId
        : current.set === target.set && current.collectorNumber === target.collectorNumber;
      if (!samePrinting || (!options.force && !needsPriceRefresh(current, now.getTime()))) {
        result.skipped += 1;
        return;
      }
      const foil = lookupPrice(index, current, "foil");
      const nonfoil = lookupPrice(index, current, "nonfoil");
      const selectedFinish = current.finish === "nonfoil" ? "nonfoil" : "foil";
      const selected = selectedFinish === "foil" ? foil : nonfoil;
      if (foil || nonfoil) result.matched += 1;
      if (!selected) {
        result.missing += 1;
        result.unresolvedIds.push(current.id);
      } else if (selected.providerIndex > 0) {
        result.fallback += 1;
      }
      if (selected && selected.provider === "cardmarket") result.converted += 1;
      if (!foil && !nonfoil) return;
      const prices = { ...(current.prices || {}) };
      const priceSources = { ...(current.priceSources || {}) };
      if (foil) {
        prices.usdFoil = foil.usd.toFixed(2);
        priceSources.foil = priceSource(foil);
      }
      if (nonfoil) {
        prices.usd = nonfoil.usd.toFixed(2);
        priceSources.nonfoil = priceSource(nonfoil);
      }
      location.cards[location.index] = {
        ...current,
        prices,
        priceSources,
        priceSource: selected ? priceSource(selected) : current.priceSource,
        priceDataDate: String(index && index.source && index.source.date || ""),
        priceUpdatedAt: now.toISOString()
      };
      result.updated += 1;
      result.updatedIds.push(current.id);
    });
    return result;
  }

  return { applyIndexedPriceUpdates, applyPriceUpdates };
});
