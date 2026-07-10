(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeCatalog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COLLECTION_URL = "https://api.scryfall.com/cards/collection";

  function normalizeCollectorNumber(value) {
    return String(value || "").trim().toLocaleLowerCase().replace(/^0+(?=\d)/, "");
  }

  function printingKey(setCode, collectorNumber) {
    return `${String(setCode || "").trim().toLocaleLowerCase()}/${normalizeCollectorNumber(collectorNumber)}`;
  }

  function createCatalog(options = {}) {
    const requestJson = options.requestJson;
    const core = options.core;
    if (typeof requestJson !== "function") throw new Error("目录服务缺少 requestJson");
    if (!core) throw new Error("目录服务缺少 CubeCore");
    const printingCache = new Map();

    async function lookupNamed(name, signal) {
      try {
        return await requestJson(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`, { signal });
      } catch (error) {
        if (error.status === 404) throw new Error("没有找到这张牌");
        throw error;
      }
    }

    async function searchByName(name, signal) {
      let url = core.buildCardNameSearchUrl(name);
      const cards = [];
      while (url) {
        let page;
        try {
          page = await requestJson(url, { signal });
        } catch (error) {
          if (error.status === 404) return [];
          throw error;
        }
        cards.push(...(page.data || []).filter(core.isPaperPrinting));
        url = page.has_more ? page.next_page : null;
      }
      return cards;
    }

    async function lookupPrinting(setCode, collectorNumber, signal) {
      const set = String(setCode || "").trim().toLocaleLowerCase();
      const number = String(collectorNumber || "").trim();
      try {
        return await requestJson(`https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(number)}`, { signal });
      } catch (error) {
        if (error.status === 404) {
          const notFound = new Error("没有找到这个系列与编号的卡牌");
          notFound.status = 404;
          throw notFound;
        }
        throw error;
      }
    }

    async function lookupById(scryfallId, signal) {
      if (!scryfallId) return null;
      try {
        return await requestJson(`https://api.scryfall.com/cards/${encodeURIComponent(scryfallId)}`, { signal });
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    }

    async function resolvePrintingIdentity(card, signal) {
      if (card && card.set && card.collectorNumber) {
        try {
          return await lookupPrinting(card.set, card.collectorNumber, signal);
        } catch (error) {
          if (error.status !== 404) throw error;
        }
      }
      const printing = await lookupById(card && card.scryfallId, signal);
      if (printing) return printing;
      return lookupNamed(core.getLookupName(card && card.name), signal);
    }

    async function lookupAllPrintings(card, signal) {
      const identity = await resolvePrintingIdentity(card, signal);
      const oracleId = core.getOracleId(identity);
      if (!oracleId) throw new Error("无法确定这张牌的 Oracle ID，不能加载版本");
      if (printingCache.has(oracleId)) return { oracleId, printings: core.filterOraclePrintings(printingCache.get(oracleId), oracleId) };
      let url = core.buildPrintingsUrl(oracleId);
      const printings = [];
      const visitedPages = new Set();
      while (url) {
        if (visitedPages.has(url)) throw new Error("Scryfall 返回了重复分页，版本加载已停止");
        visitedPages.add(url);
        const page = await requestJson(url, { signal });
        printings.push(...core.filterOraclePrintings(page.data || [], oracleId));
        url = page.has_more ? page.next_page : null;
      }
      printingCache.set(oracleId, printings);
      return { oracleId, printings };
    }

    async function lookupPrintingBatch(rows, signal) {
      const results = new Map();
      const source = Array.isArray(rows) ? rows : [];
      for (let start = 0; start < source.length; start += 75) {
        const chunk = source.slice(start, start + 75);
        const payload = await requestJson(COLLECTION_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map((row) => ({ set: String(row.setCode || "").toLocaleLowerCase(), collector_number: String(row.collectorNumber || "") })) }),
          signal
        });
        (payload.data || []).forEach((card) => results.set(printingKey(card.set, card.collector_number), card));
      }
      return results;
    }

    async function lookupCardNameBatch(names, signal) {
      const results = new Map();
      const source = Array.isArray(names) ? names : [];
      for (let start = 0; start < source.length; start += 75) {
        const chunk = source.slice(start, start + 75);
        const payload = await requestJson(COLLECTION_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ identifiers: chunk.map((name) => ({ name })) }),
          signal
        });
        (payload.data || []).forEach((card) => {
          const faces = (card.card_faces || []).map((face) => face.name);
          [card.name, card.printed_name, ...faces].filter(Boolean).forEach((name) => results.set(core.normalizeCardName(name), card));
        });
      }
      return results;
    }

    function clearPrintingCache() {
      printingCache.clear();
    }

    return { lookupNamed, searchByName, lookupPrinting, lookupById, resolvePrintingIdentity, lookupAllPrintings, lookupPrintingBatch, lookupCardNameBatch, clearPrintingCache };
  }

  return { createCatalog, normalizeCollectorNumber, printingKey };
});
