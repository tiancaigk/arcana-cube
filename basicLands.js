(function (root, factory) {
  const core = typeof module === "object" && module.exports ? require("./core.js") : root.CubeCore;
  const catalog = typeof module === "object" && module.exports ? require("./catalog.js") : root.CubeCatalog;
  const api = factory(core, catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeBasicLands = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, catalog) {
  "use strict";

  const BASIC_LAND_ORDER = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
  const BASIC_LAND_LABELS = { Plains: "平原", Island: "海岛", Swamp: "沼泽", Mountain: "山脉", Forest: "树林" };

  function parseCollectorNumberRange(value, maxItems = 100) {
    const input = String(value || "").trim();
    if (!input) throw new Error("请输入收藏编号");
    if (!input.includes("-")) return { isRange: false, numbers: [input] };
    const match = input.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!match) throw new Error("编号区间两端必须是纯数字，例如 112-115");
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start > end) throw new Error("起始编号不能大于结束编号");
    const count = end - start + 1;
    if (count > maxItems) throw new Error(`一次最多 ${maxItems} 张基本地`);
    return { isRange: true, numbers: Array.from({ length: count }, (_, index) => String(start + index)) };
  }

  function validReleaseDate(value) {
    const date = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : "";
  }

  function compareCollectorNumbers(left, right) {
    return String(left.collectorNumber || "").localeCompare(String(right.collectorNumber || ""), undefined, { numeric: true, sensitivity: "base" });
  }

  function groupBasicLands(cards, mode = "kind") {
    const source = Array.isArray(cards) ? cards.filter(core.isSupportedBasicLand) : [];
    if (mode !== "set") {
      return BASIC_LAND_ORDER.map((kind) => ({
        key: kind,
        label: BASIC_LAND_LABELS[kind],
        setCode: "",
        releasedAt: "",
        cards: source.filter((card) => core.getBasicLandKind(card) === kind).sort((left, right) => {
          const dateOrder = validReleaseDate(right.releasedAt).localeCompare(validReleaseDate(left.releasedAt));
          return dateOrder || compareCollectorNumbers(left, right);
        })
      }));
    }

    const sets = new Map();
    source.forEach((card) => {
      const setCode = String(card.set || "").trim().toUpperCase();
      const key = setCode || "UNKNOWN";
      if (!sets.has(key)) sets.set(key, { key, label: String(card.setName || "").trim() || (setCode || "未知系列"), setCode, releasedAt: validReleaseDate(card.releasedAt), cards: [] });
      const group = sets.get(key);
      if (!group.releasedAt) group.releasedAt = validReleaseDate(card.releasedAt);
      group.cards.push(card);
    });
    return [...sets.values()].map((group) => ({ ...group, cards: group.cards.sort(compareCollectorNumbers) })).sort((left, right) => {
      if (left.releasedAt && right.releasedAt) return right.releasedAt.localeCompare(left.releasedAt) || left.label.localeCompare(right.label);
      if (left.releasedAt) return -1;
      if (right.releasedAt) return 1;
      return left.label.localeCompare(right.label);
    });
  }

  function classifyBasicLandBatch(targets, cardsByPrinting, existingCards = []) {
    const source = Array.isArray(targets) ? targets : [];
    const results = cardsByPrinting instanceof Map ? cardsByPrinting : new Map();
    const existingIds = new Set((Array.isArray(existingCards) ? existingCards : []).map((card) => card && card.scryfallId).filter(Boolean));
    const counts = { added: 0, missing: 0, unsupported: 0, digital: 0, duplicate: 0 };
    const accepted = [];
    const items = source.map((target) => {
      const result = results.get(catalog.printingKey(target.setCode, target.collectorNumber));
      let status = "added";
      let reason = "已添加";
      if (!result) {
        status = "missing";
        reason = "没有找到这个系列与编号的卡牌";
      } else if (!core.isPaperPrinting(result)) {
        status = "digital";
        reason = "这个编号仅有电子版";
      } else if (!core.isSupportedBasicLand(result)) {
        status = "unsupported";
        reason = "不是平原、海岛、沼泽、山脉或树林";
      } else if (result.id && existingIds.has(result.id)) {
        status = "duplicate";
        reason = "已经收藏了这个基本地版本";
      } else {
        accepted.push(result);
        if (result.id) existingIds.add(result.id);
      }
      counts[status] += 1;
      return { collectorNumber: target.collectorNumber, status, reason };
    });
    return { accepted, counts, items };
  }

  return { BASIC_LAND_LABELS, BASIC_LAND_ORDER, classifyBasicLandBatch, groupBasicLands, parseCollectorNumberRange };
});
