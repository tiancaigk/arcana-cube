(function (root, factory) {
  const migrations = typeof module === "object" && module.exports ? require("./migrations.js") : root.CubeMigrations;
  const api = factory(migrations);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (migrations) {
  const COLOR_ORDER = ["W", "U", "B", "R", "G"];
  const SORT_ORDER = ["W", "U", "B", "R", "G", "C", "M", "L"];
  const GUILD_ORDER = [["W", "U"], ["U", "B"], ["B", "R"], ["R", "G"], ["G", "W"], ["W", "B"], ["U", "R"], ["B", "G"], ["R", "W"], ["G", "U"]];
  const PRICE_TTL_MS = 24 * 60 * 60 * 1000;
  const { CURRENT_DATA_VERSION, migrateCubeData } = migrations;

  function parseDecklist(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && !line.startsWith("//"))
      .flatMap((line) => {
        const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
        const quantity = match ? Math.min(Number(match[1]), 20) : 1;
        const rawName = match ? match[2] : line;
        const name = rawName.replace(/\s+\([A-Z0-9]+\)\s+\d+[a-z]?$/i, "").trim();
        return Array.from({ length: quantity }, () => name).filter(Boolean);
      });
  }

  function normalizeOracleId(value) {
    const oracleId = String(value || "").trim().toLocaleLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(oracleId) ? oracleId : "";
  }

  function getOracleId(card) {
    const directId = normalizeOracleId(card && (card.oracleId || card.oracle_id));
    if (directId) return directId;
    const faces = Array.isArray(card && card.card_faces) ? card.card_faces : [];
    for (const face of faces) {
      const faceId = normalizeOracleId(face && (face.oracleId || face.oracle_id));
      if (faceId) return faceId;
    }
    return "";
  }

  function normalizeLocalizedNames(card) {
    const source = card && typeof card === "object" ? card : {};
    const rawNames = source.localizedNames || source.localized_names || {};
    const names = {};
    const storeName = (lang, name, englishName = "") => {
      const normalizedLang = String(lang || "").trim().toLocaleLowerCase();
      const normalizedName = getFrontDisplayName(name);
      const normalizedEnglishName = getFrontDisplayName(englishName);
      if ((normalizedLang === "zhs" || normalizedLang === "zht") && normalizedName && normalizedName !== normalizedEnglishName) names[normalizedLang] = normalizedName;
    };
    if (rawNames && typeof rawNames === "object" && !Array.isArray(rawNames)) {
      Object.entries(rawNames).forEach(([lang, name]) => {
        storeName(lang, name, source.name);
      });
    }
    const printedLang = String(source.lang || "").trim().toLocaleLowerCase();
    storeName(printedLang, source.printedName || source.printed_name, source.name);
    const faces = Array.isArray(source.card_faces) ? source.card_faces : (Array.isArray(source.cardFaces) ? source.cardFaces : []);
    const frontFace = faces[0] || {};
    storeName(printedLang, frontFace.printedName || frontFace.printed_name, frontFace.name);
    return names;
  }

  function getPreferredLocalizedName(card) {
    const names = normalizeLocalizedNames(card);
    return names.zhs || names.zht || "";
  }

  function normalizeScryfallCard(card) {
    const face = card.card_faces && card.card_faces[0];
    const backFace = card.card_faces && card.card_faces[1];
    const imageUris = card.image_uris || (face && face.image_uris) || {};
    const backImageUris = (backFace && backFace.image_uris) || {};
    const remoteImage = imageUris.png || imageUris.large || imageUris.normal || imageUris.small || "";
    const remoteBackImage = backImageUris.png || backImageUris.large || backImageUris.normal || backImageUris.small || "";
    const frontColors = (face && face.colors) || card.colors || [];
    const frontTypeLine = (face && face.type_line) || card.type_line || "Unknown";
    const finishes = getAvailableFinishes(card);
    return {
      id: `${card.id || cryptoId()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scryfallId: card.id || "",
      oracleId: getOracleId(card),
      name: card.name,
      localizedNames: normalizeLocalizedNames(card),
      manaCost: card.mana_cost || (face && face.mana_cost) || "",
      cmc: Number(card.cmc) || 0,
      colors: card.colors || (face && face.colors) || [],
      frontColors,
      colorIdentity: card.color_identity || [],
      typeLine: card.type_line || (face && face.type_line) || "Unknown",
      frontTypeLine,
      oracleText: card.oracle_text || (face && face.oracle_text) || "",
      backOracleText: (backFace && backFace.oracle_text) || "",
      artist: card.artist || (face && face.artist) || "",
      backArtist: (backFace && backFace.artist) || "",
      set: (card.set || "custom").toUpperCase(),
      setName: card.set_name || "",
      collectorNumber: card.collector_number || "",
      releasedAt: card.released_at || "",
      rarity: card.rarity || "common",
      image: remoteImage,
      remoteImage,
      localImage: "",
      localThumbnail: "",
      backImage: remoteBackImage,
      remoteBackImage,
      localBackImage: "",
      localBackThumbnail: "",
      scryfallUri: card.scryfall_uri || "",
      prices: {
        usd: normalizePrice(card.prices && card.prices.usd),
        usdFoil: normalizePrice(card.prices && card.prices.usd_foil),
        usdEtched: normalizePrice(card.prices && card.prices.usd_etched)
      },
      priceUpdatedAt: new Date().toISOString(),
      finishes,
      finish: chooseValidFinish({ finishes }, "foil"),
      JapanPrint: false,
      addedAt: new Date().toISOString()
    };
  }

  function mergeArchiveMetadata(currentCard, scryfallCard) {
    const normalized = normalizeScryfallCard(scryfallCard);
    return {
      ...currentCard,
      oracleText: normalized.oracleText,
      backOracleText: normalized.backOracleText,
      artist: normalized.artist,
      backArtist: normalized.backArtist,
      setName: normalized.setName,
      releasedAt: normalized.releasedAt
    };
  }

  function cryptoId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
  }

  function normalizeFinish(finish) {
    return finish === "nonfoil" ? "nonfoil" : "foil";
  }

  function parseFinish(value) {
    const normalized = String(value || "").toLocaleLowerCase().replace(/[\s_-]+/g, "");
    return normalized === "nonfoil" || normalized === "非闪" ? "nonfoil" : "foil";
  }

  function parseJapanPrint(value) {
    const normalized = String(value ?? "").trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
    return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1" || normalized === "日印" || normalized === "是";
  }

  function getAvailableFinishes(card) {
    const rawFinishes = Array.isArray(card && card.finishes) ? card.finishes : [];
    const hasAvailabilityData = rawFinishes.length > 0 || typeof (card && card.foil) === "boolean" || typeof (card && card.nonfoil) === "boolean";
    if (!hasAvailabilityData) return ["foil", "nonfoil"];
    const available = [];
    if (rawFinishes.includes("foil") || rawFinishes.includes("etched") || card.foil === true) available.push("foil");
    if (rawFinishes.includes("nonfoil") || card.nonfoil === true) available.push("nonfoil");
    return available.length ? available : ["foil"];
  }

  function chooseValidFinish(card, preferred) {
    const available = getAvailableFinishes(card);
    const normalized = normalizeFinish(preferred);
    if (available.includes(normalized)) return normalized;
    return available.includes("foil") ? "foil" : "nonfoil";
  }

  function normalizePrice(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function sanitizeImageFilePart(value) {
    return String(value || "")
      .trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function sanitizeCollectorNumberFilePart(value) {
    return String(value || "")
      .trim()
      .replace(/[\\/:"<>|?*]+/g, "-")
      .replace(/\s+/g, "")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96);
  }

  function buildLocalImageFileName(card, extension = "png", face = "front") {
    const ext = sanitizeImageFilePart(extension).replace(/^jpeg$/, "jpg") || "png";
    const faceSuffix = face === "back" ? "back" : "";
    const stem = [
      sanitizeImageFilePart(card && card.set || "custom"),
      sanitizeCollectorNumberFilePart(card && (card.collectorNumber || card.collector_number) || "na"),
      sanitizeImageFilePart(getFrontDisplayName(card && card.name) || "card"),
      faceSuffix
    ].filter(Boolean).join("-");
    return `${stem || "card"}.${ext}`;
  }

  function getCardImage(card, face = "front", preview = false) {
    const imageKey = face === "back" ? "backImage" : "image";
    const thumbnailKey = face === "back" ? "localBackThumbnail" : "localThumbnail";
    return preview ? card[imageKey] || "" : card[thumbnailKey] || card[imageKey] || "";
  }

  function getFrontColors(card) {
    return Array.isArray(card && card.frontColors) ? card.frontColors : (card && card.colors) || [];
  }

  function getFrontTypeLine(card) {
    if (card && card.frontTypeLine) return card.frontTypeLine;
    return String((card && card.typeLine) || "").split("//", 1)[0].trim();
  }

  function getColorBucket(card) {
    const colors = getFrontColors(card);
    if (colors.length > 1) return "M";
    if (colors.length === 1) return colors[0];
    return "C";
  }

  function getPrimaryType(typeLine) {
    const priorities = ["Creature", "Instant", "Sorcery", "Artifact", "Enchantment", "Planeswalker", "Land"];
    return priorities.find((type) => (typeLine || "").includes(type)) || "Other";
  }

  function isLandCard(card) {
    return getFrontTypeLine(card).includes("Land");
  }

  function getCardBucket(card) {
    if (isLandCard(card)) return "L";
    return getColorBucket(card);
  }

  function computeStats(cards) {
    const nonlands = cards.filter((card) => !isLandCard(card));
    const cmcTotal = nonlands.reduce((sum, card) => sum + (Number(card.cmc) || 0), 0);
    const colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0, L: 0 };
    const types = {};
    const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, "7+": 0 };

    cards.forEach((card) => {
      colors[getCardBucket(card)] += 1;
      const type = getPrimaryType(getFrontTypeLine(card));
      types[type] = (types[type] || 0) + 1;
      if (!isLandCard(card)) {
        const cmc = Math.max(0, Math.floor(Number(card.cmc) || 0));
        curve[cmc >= 7 ? "7+" : cmc] += 1;
      }
    });

    return {
      total: cards.length,
      averageCmc: nonlands.length ? cmcTotal / nonlands.length : 0,
      creatures: types.Creature || 0,
      lands: cards.length - nonlands.length,
      colors,
      types,
      curve
    };
  }

  function filterCards(cards, filters) {
    const query = (filters.query || "").trim().toLocaleLowerCase();
    return cards.filter((card) => {
      const bucket = getCardBucket(card);
      const matchesColor = !filters.color || filters.color === "all" || bucket === filters.color;
      const matchesType = !filters.type || filters.type === "all" || (filters.type === "Land" ? isLandCard(card) : getPrimaryType(getFrontTypeLine(card)) === filters.type);
      const matchesFinish = !filters.finish || filters.finish === "all" || normalizeFinish(card.finish) === filters.finish;
      const matchesJapanPrint = !filters.japanPrint || filters.japanPrint === "all" || (filters.japanPrint === "japan" ? card.JapanPrint === true : card.JapanPrint !== true);
      const haystack = `${card.name} ${getFrontTypeLine(card)} ${card.set}`.toLocaleLowerCase();
      return matchesColor && matchesType && matchesFinish && matchesJapanPrint && (!query || haystack.includes(query));
    });
  }

  function getSortBucket(card) {
    return getCardBucket(card);
  }

  function getColorSortSignature(card) {
    return [...new Set(getFrontColors(card))]
      .filter((color) => COLOR_ORDER.includes(color))
      .sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b))
      .join("");
  }

  function getGuildSortIndex(card) {
    const colors = [...new Set(getFrontColors(card))].filter((color) => COLOR_ORDER.includes(color));
    if (colors.length !== 2) return GUILD_ORDER.length + colors.length;
    const index = GUILD_ORDER.findIndex((pair) => pair.every((color) => colors.includes(color)));
    return index === -1 ? GUILD_ORDER.length : index;
  }

  function compareMulticolorGroups(a, b) {
    if (getSortBucket(a) !== "M" || getSortBucket(b) !== "M") return 0;
    const guildDelta = getGuildSortIndex(a) - getGuildSortIndex(b);
    if (guildDelta !== 0) return guildDelta;
    return getColorSortSignature(a).localeCompare(getColorSortSignature(b), "en", { sensitivity: "base" });
  }

  function compareCards(a, b) {
    const bucketDelta = SORT_ORDER.indexOf(getSortBucket(a)) - SORT_ORDER.indexOf(getSortBucket(b));
    if (bucketDelta !== 0) return bucketDelta;
    const multicolorDelta = compareMulticolorGroups(a, b);
    if (multicolorDelta !== 0) return multicolorDelta;
    const nameDelta = String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base", numeric: true });
    if (nameDelta !== 0) return nameDelta;
    const setDelta = String(a.set || "").localeCompare(String(b.set || ""), "en", { sensitivity: "base", numeric: true });
    if (setDelta !== 0) return setDelta;
    return String(a.collectorNumber || "").localeCompare(String(b.collectorNumber || ""), "en", { sensitivity: "base", numeric: true });
  }

  function sortCards(cards) {
    return [...cards].sort(compareCards);
  }

  function buildCardNameSearchUrl(name) {
    const query = `name:${String(name || "").trim()} game:paper`;
    return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name&dir=asc`;
  }

  function buildPrintingsUrl(oracleId) {
    const normalizedId = normalizeOracleId(oracleId);
    if (!normalizedId) throw new Error("无法确定这张牌的 Oracle ID");
    return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${normalizedId} game:paper`)}&unique=prints&order=released&dir=desc`;
  }

  function buildLocalizedNameSearchUrl(oracleId, lang = "zhs") {
    const normalizedId = normalizeOracleId(oracleId);
    if (!normalizedId) throw new Error("无法确定这张牌的 Oracle ID");
    const normalizedLang = lang === "zht" ? "zht" : "zhs";
    return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${normalizedId} lang:${normalizedLang} game:paper`)}&unique=prints&order=released&dir=desc`;
  }

  function isPaperPrinting(printing) {
    return Boolean(printing && printing.digital !== true && Array.isArray(printing.games) && printing.games.includes("paper"));
  }

  function filterOraclePrintings(printings, oracleId) {
    const normalizedId = normalizeOracleId(oracleId);
    if (!normalizedId) return [];
    return printings.filter((printing) => isPaperPrinting(printing) && getOracleId(printing) === normalizedId);
  }

  function filterPrintings(printings, query, finishFilter = "all") {
    const needle = (query || "").trim().toLocaleLowerCase();
    const paperPrintings = printings.filter((printing) => isPaperPrinting(printing) && (finishFilter !== "foil" || getAvailableFinishes(printing).includes("foil")));
    if (!needle) return paperPrintings;
    return paperPrintings.filter((printing) => {
      const haystack = `${printing.set_name || ""} ${printing.set || ""} ${printing.collector_number || ""} ${printing.released_at || ""} ${printing.artist || ""}`.toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }

  function replacePrinting(currentCard, printing, preferredFinish = currentCard.finish) {
    const normalized = normalizeScryfallCard(printing);
    const samePrinting = currentCard.scryfallId && normalized.scryfallId && currentCard.scryfallId === normalized.scryfallId;
    const localImage = samePrinting ? currentCard.localImage || "" : "";
    const localBackImage = samePrinting ? currentCard.localBackImage || "" : "";
    const localThumbnail = samePrinting ? currentCard.localThumbnail || "" : "";
    const localBackThumbnail = samePrinting ? currentCard.localBackThumbnail || "" : "";
    return {
      ...normalized,
      id: currentCard.id,
      addedAt: currentCard.addedAt,
      localizedNames: {
        ...normalizeLocalizedNames(currentCard),
        ...normalizeLocalizedNames(normalized)
      },
      localImage,
      localThumbnail,
      image: localImage || normalized.image,
      localBackImage,
      localBackThumbnail,
      backImage: localBackImage || normalized.backImage,
      JapanPrint: currentCard.JapanPrint === true,
      finish: chooseValidFinish(normalized, preferredFinish)
    };
  }

  function getUsdPrice(card, finish) {
    const prices = card && card.prices ? card.prices : {};
    const normalizedFinish = normalizeFinish(finish || card.finish);
    return normalizedFinish === "foil" ? prices.usdFoil || prices.usdEtched || "" : prices.usd || "";
  }

  function getPriceNumber(card, finish) {
    const rawValue = getUsdPrice(card, finish);
    if (rawValue === "") return null;
    const value = Number(rawValue);
    return Number.isFinite(value) ? value : null;
  }

  function needsPriceRefresh(card, now = Date.now()) {
    if (!card || !card.set || !card.collectorNumber) return false;
    const updatedAt = Date.parse(card.priceUpdatedAt || "");
    return !Number.isFinite(updatedAt) || now - updatedAt >= PRICE_TTL_MS;
  }

  function normalizeCardName(name) {
    return String(name || "").normalize("NFKC").toLocaleLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
  }

  function getFrontDisplayName(name) {
    const value = String(name || "").trim();
    if (!value) return "";
    return value.split(/\s*\/\/\s*/, 1)[0].trim() || value;
  }

  function getLookupName(name) {
    return getFrontDisplayName(name);
  }

  function getBasicLandKind(card) {
    const name = getFrontDisplayName(card && card.name);
    return ["Plains", "Island", "Swamp", "Mountain", "Forest"].includes(name) ? name : "";
  }

  function isSupportedBasicLand(card) {
    return Boolean(getBasicLandKind(card));
  }

  function prepareTextImportRows(names, existingNames = []) {
    const seen = new Set();
    const existing = new Set(existingNames.map(normalizeCardName));
    return names.map((expectedName, index) => {
      const key = normalizeCardName(expectedName);
      const row = { rowNumber: index + 1, expectedName, status: "valid", importable: false, card: null, message: "" };
      if (seen.has(key)) {
        row.status = "duplicate";
        row.message = "相同牌名已在输入中出现";
      } else if (existing.has(key)) {
        row.status = "existing";
        row.message = "当前 Cube 已包含这张牌";
      }
      seen.add(key);
      return row;
    });
  }

  function parseExcelRows(rows) {
    const source = Array.isArray(rows) ? rows.slice(0, 1001) : [];
    const first = source[0] || [];
    const headerText = first.slice(0, 3).map((value) => String(value || "").toLocaleLowerCase()).join(" ");
    const hasHeader = /系列|set|编号|collector|名称|name/.test(headerText);
    return source.slice(hasHeader ? 1 : 0).map((row, index) => ({
      rowNumber: index + (hasHeader ? 2 : 1),
      setCode: String(row[0] ?? "").trim().toUpperCase(),
      collectorNumber: String(row[1] ?? "").trim(),
      expectedName: String(row[2] ?? "").trim(),
      finish: parseFinish(row[3]),
      JapanPrint: parseJapanPrint(row[5])
    })).filter((row) => row.setCode || row.collectorNumber || row.expectedName);
  }

  function buildExcelRows(cards, extras = {}) {
    const extrasByCardId = extras && extras.byCardId ? extras.byCardId : {};
    const extraFor = (card) => extrasByCardId[card && card.id] || {};
    return [
      ["系列", "编号", "卡牌名称", "闪卡状态", "美元价格", "日印", "中文名", "上次价格", "价格变化", "变化百分比", "价格更新时间", "Scryfall ID", "本地正面图", "本地背面图", "图片状态"],
      ...cards.map((card) => {
        const extra = extraFor(card);
        return [
          card.set || "",
          card.collectorNumber || "",
          card.name || "",
          normalizeFinish(card.finish) === "foil" ? "Foil" : "Non-Foil",
          getUsdPrice(card, card.finish) || "",
          card.JapanPrint === true ? "是" : "",
          getPreferredLocalizedName(card),
          extra.previousPrice || "",
          extra.priceDelta || "",
          extra.pricePercent || "",
          card.priceUpdatedAt || "",
          card.scryfallId || "",
          card.localImage || "",
          card.localBackImage || "",
          extra.imageStatus || ""
        ];
      })
    ];
  }

  function buildBackup(data, exportedAt = new Date().toISOString()) {
    return {
      format: "arcana-cube-backup",
      version: 2,
      dataVersion: CURRENT_DATA_VERSION,
      exportedAt,
      data
    };
  }

  function parseBackup(source) {
    const payload = typeof source === "string" ? JSON.parse(source) : source;
    const wrapped = payload && payload.data && payload.format === "arcana-cube-backup";
    const sourceData = wrapped ? payload.data : payload;
    if (!sourceData || typeof sourceData !== "object" || !sourceData.meta || typeof sourceData.meta.name !== "string" || !Array.isArray(sourceData.cards)) {
      throw new Error("不是有效的 Arcana Cube 备份文件");
    }
    const data = migrateCubeData(sourceData, wrapped ? payload.dataVersion ?? 0 : 0);
    return {
      meta: data.meta,
      notes: typeof data.notes === "string" ? data.notes : "",
      cards: data.cards
    };
  }

  return { COLOR_ORDER, SORT_ORDER, PRICE_TTL_MS, parseDecklist, normalizeFinish, parseFinish, parseJapanPrint, getAvailableFinishes, chooseValidFinish, normalizeLocalizedNames, getPreferredLocalizedName, normalizeScryfallCard, mergeArchiveMetadata, getOracleId, getFrontColors, getFrontTypeLine, getUsdPrice, getPriceNumber, needsPriceRefresh, getColorBucket, getPrimaryType, isLandCard, getBasicLandKind, isSupportedBasicLand, getCardBucket, computeStats, filterCards, sortCards, buildCardNameSearchUrl, buildPrintingsUrl, buildLocalizedNameSearchUrl, buildLocalImageFileName, getCardImage, isPaperPrinting, filterOraclePrintings, filterPrintings, replacePrinting, normalizeCardName, getFrontDisplayName, getLookupName, prepareTextImportRows, parseExcelRows, buildExcelRows, buildBackup, parseBackup };
});
