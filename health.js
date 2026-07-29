(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeHealth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EXAMPLE_LIMIT = 5;

  function normalizePath(value) {
    return String(value || "").trim().replace(/\\/g, "/");
  }

  function selectedPrice(card) {
    const prices = card && card.prices || {};
    const finish = String(card && card.finish || "foil").toLowerCase();
    const value = finish === "foil"
      ? prices.usdFoil ?? prices.usd_foil
      : finish === "etched"
        ? prices.usdEtched ?? prices.usd_etched
        : prices.usd;
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function duplicates(values) {
    const counts = new Map();
    values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    return [...counts.entries()].filter(([, count]) => count > 1);
  }

  function analyzeWorkspaceHealth(input = {}) {
    const cards = Array.isArray(input.cards) ? input.cards : [];
    const originalFiles = new Set((input.originalFiles || []).map(normalizePath).filter(Boolean));
    const thumbnailFiles = new Set((input.thumbnailFiles || []).map(normalizePath).filter(Boolean));
    const originalReferences = [];
    const thumbnailReferences = [];
    const missingOriginals = [];
    const missingThumbnails = [];
    const uncachedOriginals = [];

    cards.forEach((card, index) => {
      const label = String(card && card.name || `第 ${index + 1} 张牌`);
      [
        { face: "正面", original: card && card.localImage, thumbnail: card && card.localThumbnail, available: true },
        { face: "背面", original: card && card.localBackImage, thumbnail: card && card.localBackThumbnail, available: Boolean(card && (card.backImage || card.remoteBackImage || card.localBackImage)) }
      ].forEach((entry) => {
        if (!entry.available) return;
        const original = normalizePath(entry.original);
        const thumbnail = normalizePath(entry.thumbnail);
        if (!original) {
          uncachedOriginals.push(`${label}（${entry.face}）`);
          return;
        }
        originalReferences.push(original);
        if (!originalFiles.has(original)) missingOriginals.push(original);
        if (thumbnail) thumbnailReferences.push(thumbnail);
        if (!thumbnail || !thumbnailFiles.has(thumbnail)) missingThumbnails.push(`${label}（${entry.face}）`);
      });
    });

    const referencedOriginals = new Set(originalReferences);
    const referencedThumbnails = new Set(thumbnailReferences);
    const orphanOriginals = [...originalFiles].filter((path) => !referencedOriginals.has(path));
    const orphanThumbnails = [...thumbnailFiles].filter((path) => !referencedThumbnails.has(path));
    const duplicateImageReferences = duplicates([...originalReferences, ...thumbnailReferences]);
    const duplicateCardIds = duplicates(cards.map((card) => String(card && card.id || "").trim()));
    const invalidCards = cards.filter((card) => !card || !String(card.id || "").trim() || !String(card.name || "").trim());
    const missingIdentifiers = cards.filter((card) => !String(card && card.scryfallId || "").trim() || !String(card && card.oracleId || "").trim());
    const missingPrices = cards.filter((card) => selectedPrice(card) === null);
    const issues = [];

    function addIssue(code, severity, title, values, description) {
      if (!values.length) return;
      issues.push({
        code,
        severity,
        title,
        count: values.length,
        description,
        examples: values.slice(0, EXAMPLE_LIMIT).map((value) => Array.isArray(value) ? `${value[0]}（${value[1]} 次引用）` : String(value))
      });
    }

    addIssue("missing-originals", "error", "本地原图引用丢失", [...new Set(missingOriginals)], "牌表记录指向的原图文件不存在。重新补全卡图前请先确认文件是否被移动。");
    addIssue("duplicate-card-ids", "error", "卡牌内部 ID 重复", duplicateCardIds, "重复 ID 会让删除、换版本等操作定位到错误的牌。");
    addIssue("invalid-cards", "error", "卡牌记录不完整", invalidCards.map((card, index) => card && card.name || `记录 ${index + 1}`), "这些记录缺少内部 ID 或卡牌名称。");
    addIssue("missing-thumbnails", "warning", "WebP 缩略图未补齐", missingThumbnails, "点击“补全本地卡图”可从现有原图生成，不会降低 PNG 原图质量。");
    addIssue("duplicate-image-references", "warning", "图片被多张牌重复引用", duplicateImageReferences, "可能是正常的重复牌，也可能是版本图片关联错误。");
    addIssue("missing-scryfall-identifiers", "warning", "Scryfall 标识不完整", missingIdentifiers.map((card) => card && card.name || "未命名卡牌"), "缺少印刷或 Oracle 标识会影响价格历史、版本切换与去重。");
    addIssue("orphan-originals", "info", "未被牌表引用的原图", orphanOriginals, "这些文件不会显示在当前牌表中；检查确认后可在文件管理器中自行归档。");
    addIssue("orphan-thumbnails", "info", "未被牌表引用的缩略图", orphanThumbnails, "通常来自已删除或已换版本的牌。");
    addIssue("uncached-originals", "info", "尚未保存到本地的卡图", uncachedOriginals, "这些牌仍可能使用网络图片，离线时无法显示。");
    addIssue("missing-selected-prices", "info", "当前表面工艺缺少价格", missingPrices.map((card) => card && card.name || "未命名卡牌"), "MTGJSON 的实体卡零售来源未必为所有版本和表面工艺提供价格。");

    const severityCounts = issues.reduce((counts, issue) => {
      counts[issue.severity] += 1;
      return counts;
    }, { error: 0, warning: 0, info: 0 });
    return {
      healthy: issues.length === 0,
      summary: {
        cards: cards.length,
        originalFiles: originalFiles.size,
        thumbnailFiles: thumbnailFiles.size,
        errors: severityCounts.error,
        warnings: severityCounts.warning,
        info: severityCounts.info
      },
      issues
    };
  }

  return { analyzeWorkspaceHealth };
});
