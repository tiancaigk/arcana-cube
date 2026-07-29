(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MtgchClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API_ROOT = "https://mtgch.com/api/v1/card";

  function frontName(value) {
    return String(value || "").split(/\s*\/\/\s*/, 1)[0].trim();
  }

  function isSimplifiedChineseName(value) {
    return /[\u3400-\u9fff]/.test(value);
  }

  function extractSimplifiedChineseName(card) {
    const fullNameLayout = card && (card.layout === "split" || card.layout === "aftermath");
    const candidates = fullNameLayout
      ? [
          card && card.full_official_name,
          card && card.full_translated_name,
          card && card.zhs_name,
          card && card.atomic_official_name,
          card && card.atomic_translated_name,
          card && card.zhs_face_name
        ]
      : [
          card && card.atomic_official_name,
          card && card.atomic_translated_name,
          card && card.zhs_face_name,
          card && card.zhs_name,
          card && card.full_official_name,
          card && card.full_translated_name
        ];
    for (const candidate of candidates) {
      const name = fullNameLayout ? String(candidate || "").trim() : frontName(candidate);
      if (name && isSimplifiedChineseName(name)) return name;
    }
    return "";
  }

  function buildCardUrl(setCode, collectorNumber) {
    const set = String(setCode || "").trim().toUpperCase();
    const number = String(collectorNumber || "").trim();
    if (!set || !number) return "";
    return `${API_ROOT}/${encodeURIComponent(set)}/${encodeURIComponent(number)}/`;
  }

  function createMtgchClient(options = {}) {
    const fetchImpl = options.fetchImpl || (typeof fetch === "function" ? fetch : null);
    if (!fetchImpl) throw new Error("当前环境不支持 MTGCH 查询");

    async function lookupSimplifiedChineseName(card, signal) {
      const url = buildCardUrl(card && card.set, card && card.collectorNumber);
      if (!url) return "";
      const response = await fetchImpl(url, {
        signal,
        headers: { Accept: "application/json" }
      });
      if (response.status === 404) return "";
      if (!response.ok) {
        const error = new Error(`MTGCH 请求失败 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return extractSimplifiedChineseName(await response.json());
    }

    return { lookupSimplifiedChineseName };
  }

  return { API_ROOT, buildCardUrl, createMtgchClient, extractSimplifiedChineseName };
});
