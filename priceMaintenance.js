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

  return { applyPriceUpdates };
});
