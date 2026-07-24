(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeMigrations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CURRENT_DATA_VERSION = 3;

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function isRemotePath(value) {
    return /^https?:\/\//i.test(String(value || ""));
  }

  function isThumbnailPath(value) {
    return String(value || "").startsWith("images/thumbnails/");
  }

  function isOriginalPath(value) {
    return String(value || "").startsWith("images/") && !isThumbnailPath(value);
  }

  function migrateCardToVersion1(source) {
    const card = source && typeof source === "object" ? source : {};
    const localImage = isOriginalPath(card.localImage) ? card.localImage : (isOriginalPath(card.image) ? card.image : "");
    const localThumbnail = isThumbnailPath(card.localThumbnail) ? card.localThumbnail : (isThumbnailPath(card.image) ? card.image : "");
    const remoteImage = isRemotePath(card.remoteImage) ? card.remoteImage : (isRemotePath(card.image) ? card.image : "");
    const localBackImage = isOriginalPath(card.localBackImage) ? card.localBackImage : (isOriginalPath(card.backImage) ? card.backImage : "");
    const localBackThumbnail = isThumbnailPath(card.localBackThumbnail) ? card.localBackThumbnail : (isThumbnailPath(card.backImage) ? card.backImage : "");
    const remoteBackImage = isRemotePath(card.remoteBackImage) ? card.remoteBackImage : (isRemotePath(card.backImage) ? card.backImage : "");
    return {
      ...card,
      localizedNames: card.localizedNames && typeof card.localizedNames === "object" && !Array.isArray(card.localizedNames) ? card.localizedNames : {},
      prices: card.prices && typeof card.prices === "object" && !Array.isArray(card.prices) ? card.prices : {},
      localImage,
      localThumbnail,
      remoteImage,
      image: localImage || remoteImage || localThumbnail || "",
      localBackImage,
      localBackThumbnail,
      remoteBackImage,
      backImage: localBackImage || remoteBackImage || localBackThumbnail || "",
      JapanPrint: card.JapanPrint === true,
      finish: card.finish === "nonfoil" ? "nonfoil" : "foil"
    };
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (const char of String(value || "")) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function legacyCubeId(source) {
    const meta = source && source.meta || {};
    const cards = [...(source && source.cards || []), ...(source && source.basicLands || [])];
    const cardKeys = cards.map((card) => card.scryfallId || card.id || `${card.name || ""}|${card.set || ""}|${card.collectorNumber || ""}`).sort();
    return `cube-${stableHash([meta.name || "", ...cardKeys].join("\u0000"))}`;
  }

  const migrations = {
    1(data) {
      const source = data && typeof data === "object" ? data : {};
      return {
        ...source,
        meta: source.meta && typeof source.meta === "object" ? source.meta : { name: "" },
        notes: typeof source.notes === "string" ? source.notes : "",
        cards: Array.isArray(source.cards) ? source.cards.map(migrateCardToVersion1) : []
      };
    },
    2(data) {
      const source = data && typeof data === "object" ? data : {};
      return {
        ...source,
        basicLands: Array.isArray(source.basicLands) ? source.basicLands.map(migrateCardToVersion1) : []
      };
    },
    3(data) {
      const source = data && typeof data === "object" ? data : {};
      const meta = source.meta && typeof source.meta === "object" ? source.meta : { name: "" };
      return {
        ...source,
        meta: {
          ...meta,
          id: typeof meta.id === "string" && meta.id.trim() ? meta.id.trim() : legacyCubeId(source)
        }
      };
    }
  };

  function migrateCubeData(data, fromVersion = 0) {
    const parsedVersion = Number(fromVersion);
    if (!Number.isInteger(parsedVersion) || parsedVersion < 0) throw new Error("Cube 数据版本无效");
    if (parsedVersion > CURRENT_DATA_VERSION) throw new Error(`此文件由较新版本的 Arcana Cube 创建（数据版本 ${parsedVersion}）`);
    let version = parsedVersion;
    let migrated = clone(data);
    while (version < CURRENT_DATA_VERSION) {
      version += 1;
      migrated = migrations[version](migrated);
    }
    return migrated;
  }

  return { CURRENT_DATA_VERSION, migrateCubeData };
});
