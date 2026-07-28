(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeProductSources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INDEX_FORMAT = "arcana-cube-product-sources";
  const INDEX_VERSION = 1;
  const BOOSTER_CATEGORIES = new Set(["booster_pack", "booster_box", "booster_case"]);
  const TYPE_ORDER = ["precon", "collector", "play", "set", "draft", "booster", "prerelease", "bundle", "promo", "other"];

  function normalizeFinish(value) {
    return value === "nonfoil" ? "nonfoil" : "foil";
  }

  function sourceKeysForFinish(finish) {
    return normalizeFinish(finish) === "nonfoil" ? ["nonfoil"] : ["foil", "etched"];
  }

  function sourceFinishLabel(key) {
    if (key === "etched") return "Etched Foil";
    return key === "nonfoil" ? "Non-Foil" : "Foil";
  }

  function isPaperProduct(product) {
    const category = String(product && product.category || "").toLocaleLowerCase();
    const subtype = String(product && product.subtype || "").toLocaleLowerCase();
    const name = String(product && product.name || "");
    if (["digital", "digital_only", "online"].includes(category)) return false;
    if (["digital", "digital_only", "mtgo"].includes(subtype)) return false;
    return !/\b(?:MTGO|Magic Online)\s+Redemption\b/i.test(name);
  }

  function productType(product) {
    const category = String(product && product.category || "").toLocaleLowerCase();
    const subtype = String(product && product.subtype || "").toLocaleLowerCase();
    const name = String(product && product.name || "").toLocaleLowerCase();
    if (category === "deck") return "precon";
    if (BOOSTER_CATEGORIES.has(category)) {
      if (subtype === "collector") return "collector";
      if (subtype === "play") return "play";
      if (subtype === "set") return "set";
      if (subtype === "draft") return "draft";
      return "booster";
    }
    if (subtype === "prerelease_kit" || /prerelease/.test(name)) return "prerelease";
    if (category === "bundle") return "bundle";
    if (/promo|buy-a-box|box topper/.test(name)) return "promo";
    return "other";
  }

  function productTypeLabel(type) {
    return ({
      precon: "预组",
      collector: "聚珍补充包",
      play: "常规补充包",
      set: "系列补充包",
      draft: "轮抽补充包",
      booster: "补充包",
      prerelease: "售前组合",
      bundle: "礼盒",
      promo: "促销产品",
      other: "其他产品"
    })[type] || "其他产品";
  }

  function availabilityLabel(type) {
    if (type === "precon") return "固定收录";
    if (["collector", "play", "set", "draft", "booster"].includes(type)) return "随机可能开出";
    return "产品收录";
  }

  function productRank(product) {
    const category = String(product && product.category || "").toLocaleLowerCase();
    const name = String(product && product.name || "").toLocaleLowerCase();
    if (category === "booster_pack" && !/hanger|sleeved/.test(name)) return 0;
    if (category === "booster_pack") return 1;
    if (category === "booster_box") return 2;
    if (category === "booster_case") return 3;
    return 0;
  }

  function mergeFinishLabels(target, source) {
    const values = new Set([...(target || []), ...(source || [])]);
    return ["Non-Foil", "Foil", "Etched Foil"].filter((label) => values.has(label));
  }

  function collapseProducts(products) {
    const source = (products || []).filter((product) => product && product.uuid && product.name && isPaperProduct(product));
    const deckSubtypes = new Set(source.filter((product) => product.category === "deck").map((product) => product.subtype || ""));
    const filtered = source.filter((product) => !(product.category === "subset" && deckSubtypes.has(product.subtype || "")));
    const groups = new Map();
    filtered.forEach((product) => {
      const type = productType(product);
      const key = ["collector", "play", "set", "draft", "booster"].includes(type)
        ? `booster:${type}`
        : `${type}:${product.uuid}`;
      const current = groups.get(key);
      if (!current || productRank(product) < productRank(current)) {
        groups.set(key, {
          ...product,
          type,
          typeLabel: productTypeLabel(type),
          availability: availabilityLabel(type),
          finishLabels: mergeFinishLabels(current && current.finishLabels, product.finishLabels)
        });
      } else {
        current.finishLabels = mergeFinishLabels(current.finishLabels, product.finishLabels);
      }
    });
    return [...groups.values()].sort((a, b) => {
      const typeDifference = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      return typeDifference || String(a.name).localeCompare(String(b.name), "en");
    });
  }

  function selectProductSources(entry, finish, productsByUuid = {}) {
    if (!entry || typeof entry !== "object") return [];
    const byUuid = new Map();
    sourceKeysForFinish(finish).forEach((sourceKey) => {
      (entry.sources && entry.sources[sourceKey] || []).forEach((sourceProduct) => {
        const product = typeof sourceProduct === "string"
          ? { ...(productsByUuid[sourceProduct] || {}), uuid: sourceProduct }
          : sourceProduct;
        if (!product || !product.uuid || !product.name) return;
        const current = byUuid.get(product.uuid);
        if (current) {
          current.finishLabels = mergeFinishLabels(current.finishLabels, [sourceFinishLabel(sourceKey)]);
        } else {
          byUuid.set(product.uuid, { ...product, finishLabels: [sourceFinishLabel(sourceKey)] });
        }
      });
    });
    return collapseProducts([...byUuid.values()]);
  }

  function validateIndex(payload) {
    return Boolean(
      payload
      && payload.format === INDEX_FORMAT
      && payload.version === INDEX_VERSION
      && payload.cards
      && typeof payload.cards === "object"
    );
  }

  function createProductSourceCatalog(options = {}) {
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
    const indexUrl = options.indexUrl || "product-source-index.json";
    const loadFallback = typeof options.loadFallback === "function" ? options.loadFallback : null;
    const preferFallback = Boolean(options.preferFallback);
    if (!fetchImpl && !loadFallback) throw new Error("当前环境不支持产品来源查询");
    let indexPromise;

    async function validatePayload(payload) {
      if (!validateIndex(payload)) throw new Error("产品来源索引格式无效");
      return payload;
    }

    async function fetchIndex() {
      if (!fetchImpl) throw new Error("当前环境不支持产品来源网络查询");
      const response = await fetchImpl(indexUrl, { cache: "no-cache", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`产品来源索引加载失败 (${response.status})`);
      return validatePayload(await response.json());
    }

    async function loadFallbackIndex() {
      if (!loadFallback) throw new Error("产品来源本地索引不可用");
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

    async function lookup(card) {
      const index = await loadIndex();
      const scryfallId = String(card && card.scryfallId || "").trim();
      const entry = scryfallId ? index.cards[scryfallId] : null;
      return {
        entry,
        products: selectProductSources(entry, card && card.finish, index.products),
        source: index.source || null
      };
    }

    function clearCache() {
      indexPromise = null;
    }

    return { loadIndex, lookup, clearCache };
  }

  return {
    INDEX_FORMAT,
    INDEX_VERSION,
    availabilityLabel,
    collapseProducts,
    createProductSourceCatalog,
    isPaperProduct,
    productType,
    productTypeLabel,
    selectProductSources,
    sourceKeysForFinish,
    validateIndex
  };
});
