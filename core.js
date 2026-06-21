(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CubeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COLOR_ORDER = ["W", "U", "B", "R", "G"];
  const SORT_ORDER = ["W", "U", "B", "R", "G", "C", "M", "L"];
  const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

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

  function normalizeScryfallCard(card) {
    const face = card.card_faces && card.card_faces[0];
    const imageUris = card.image_uris || (face && face.image_uris) || {};
    const frontColors = (face && face.colors) || card.colors || [];
    const frontTypeLine = (face && face.type_line) || card.type_line || "Unknown";
    const finishes = getAvailableFinishes(card);
    return {
      id: `${card.id || cryptoId()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      scryfallId: card.id || "",
      oracleId: card.oracle_id || "",
      name: card.name,
      manaCost: card.mana_cost || (face && face.mana_cost) || "",
      cmc: Number(card.cmc) || 0,
      colors: card.colors || (face && face.colors) || [],
      frontColors,
      colorIdentity: card.color_identity || [],
      typeLine: card.type_line || (face && face.type_line) || "Unknown",
      frontTypeLine,
      set: (card.set || "custom").toUpperCase(),
      collectorNumber: card.collector_number || "",
      rarity: card.rarity || "common",
      image: imageUris.normal || imageUris.large || imageUris.small || "",
      scryfallUri: card.scryfall_uri || "",
      prices: {
        usd: normalizePrice(card.prices && card.prices.usd),
        usdFoil: normalizePrice(card.prices && card.prices.usd_foil),
        usdEtched: normalizePrice(card.prices && card.prices.usd_etched)
      },
      priceUpdatedAt: new Date().toISOString(),
      finishes,
      finish: chooseValidFinish({ finishes }, "foil"),
      addedAt: new Date().toISOString()
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
    const colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, M: 0 };
    const types = {};
    const curve = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, "7+": 0 };

    cards.forEach((card) => {
      colors[getColorBucket(card)] += 1;
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
      const haystack = `${card.name} ${getFrontTypeLine(card)} ${card.set}`.toLocaleLowerCase();
      return matchesColor && matchesType && matchesFinish && (!query || haystack.includes(query));
    });
  }

  function getSortBucket(card) {
    return getCardBucket(card);
  }

  function compareCards(a, b) {
    const bucketDelta = SORT_ORDER.indexOf(getSortBucket(a)) - SORT_ORDER.indexOf(getSortBucket(b));
    if (bucketDelta !== 0) return bucketDelta;
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
    return `https://api.scryfall.com/cards/search?q=${encodeURIComponent(`oracleid:${oracleId} game:paper`)}&unique=prints&order=released&dir=desc`;
  }

  function isPaperPrinting(printing) {
    return Boolean(printing && printing.digital !== true && Array.isArray(printing.games) && printing.games.includes("paper"));
  }

  function filterPrintings(printings, query) {
    const needle = (query || "").trim().toLocaleLowerCase();
    const paperPrintings = printings.filter(isPaperPrinting);
    if (!needle) return paperPrintings;
    return paperPrintings.filter((printing) => {
      const haystack = `${printing.set_name || ""} ${printing.set || ""} ${printing.collector_number || ""} ${printing.released_at || ""} ${printing.artist || ""}`.toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }

  function replacePrinting(currentCard, printing) {
    const normalized = normalizeScryfallCard(printing);
    return {
      ...normalized,
      id: currentCard.id,
      addedAt: currentCard.addedAt,
      finish: chooseValidFinish(normalized, currentCard.finish)
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
      finish: parseFinish(row[3])
    })).filter((row) => row.setCode || row.collectorNumber || row.expectedName);
  }

  function buildExcelRows(cards) {
    return [
      ["系列", "编号", "卡牌名称", "闪卡状态", "美元价格"],
      ...cards.map((card) => [
        card.set || "",
        card.collectorNumber || "",
        card.name || "",
        normalizeFinish(card.finish) === "foil" ? "Foil" : "Non-Foil",
        getUsdPrice(card, card.finish) || ""
      ])
    ];
  }

  function buildBackup(data, exportedAt = new Date().toISOString()) {
    return {
      format: "arcana-cube-backup",
      version: 2,
      exportedAt,
      data
    };
  }

  function parseBackup(source) {
    const payload = typeof source === "string" ? JSON.parse(source) : source;
    const data = payload && payload.data && payload.format === "arcana-cube-backup" ? payload.data : payload;
    if (!data || typeof data !== "object" || !data.meta || typeof data.meta.name !== "string" || !Array.isArray(data.cards)) {
      throw new Error("不是有效的 Arcana Cube 备份文件");
    }
    return {
      meta: data.meta,
      notes: typeof data.notes === "string" ? data.notes : "",
      cards: data.cards
    };
  }

  return { COLOR_ORDER, SORT_ORDER, PRICE_TTL_MS, parseDecklist, normalizeFinish, parseFinish, getAvailableFinishes, chooseValidFinish, normalizeScryfallCard, getFrontColors, getFrontTypeLine, getUsdPrice, getPriceNumber, needsPriceRefresh, getColorBucket, getPrimaryType, isLandCard, getCardBucket, computeStats, filterCards, sortCards, buildCardNameSearchUrl, buildPrintingsUrl, isPaperPrinting, filterPrintings, replacePrinting, normalizeCardName, prepareTextImportRows, parseExcelRows, buildExcelRows, buildBackup, parseBackup };
});
