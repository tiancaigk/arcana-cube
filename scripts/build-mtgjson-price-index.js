#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const {
  INDEX_FORMAT,
  INDEX_VERSION,
  PROVIDER_ORDER,
  buildIndexScript,
  buildPriceSeries,
  mergeSeries,
  validateIndex
} = require("../mtgjsonPrices.js");

const rootDir = path.resolve(__dirname, "..");
const bundledOutputFile = path.join(rootDir, "mtgjson-price-index.json");
const cubeFile = process.env.CUBE_DATA_FILE
  ? path.resolve(process.env.CUBE_DATA_FILE)
  : path.join(rootDir, "cube-data.json");
const outputFile = process.env.MTGJSON_PRICE_OUTPUT_FILE
  ? path.resolve(process.env.MTGJSON_PRICE_OUTPUT_FILE)
  : bundledOutputFile;
const scriptOutputFile = process.env.MTGJSON_PRICE_SCRIPT_OUTPUT_FILE
  ? path.resolve(process.env.MTGJSON_PRICE_SCRIPT_OUTPUT_FILE)
  : path.join(rootDir, "mtgjson-price-index.js");
const cacheRoot = path.join(rootDir, ".cache", "mtgjson");
const apiRoot = "https://mtgjson.com/api/v5";
const exchangeApiRoot = "https://api.frankfurter.dev/v2";
const scryfallApiRoot = "https://api.scryfall.com";
const headers = {
  Accept: "application/json",
  "User-Agent": "ArcanaCubePriceIndex/1.0"
};
const scryfallHeaders = {
  Accept: "application/json",
  "User-Agent": "ArcanaCubePriceIndex/1.0"
};
let lastScryfallRequestAt = 0;

function parseCube(payload) {
  if (payload && payload.data && Array.isArray(payload.data.cards)) return payload.data;
  if (payload && Array.isArray(payload.cards)) return payload;
  throw new Error("cube-data.json 格式无效");
}

async function fetchJson(url, attempts = 3, requestHeaders = headers) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: requestHeaders,
        signal: AbortSignal.timeout(60000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${url} 下载失败：${lastError && lastError.message || "未知错误"}`);
}

async function fetchScryfallJson(url) {
  const remaining = 110 - (Date.now() - lastScryfallRequestAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  const payload = await fetchJson(url, 3, scryfallHeaders);
  lastScryfallRequestAt = Date.now();
  return payload;
}

function normalizePrintingCandidate(card) {
  const scryfallId = String(card && (card.scryfallId || card.id) || "").trim();
  const oracleId = String(card && (card.oracleId || card.oracle_id) || "").trim();
  const set = String(card && card.set || "").trim().toUpperCase();
  const collectorNumber = String(card && (card.collectorNumber || card.collector_number) || "").trim();
  if (!scryfallId || !oracleId || !set || !collectorNumber) return null;
  return {
    scryfallId,
    oracleId,
    set,
    collectorNumber,
    name: String(card && card.name || "").trim()
  };
}

async function fetchOraclePrintings(oracleIds) {
  const ids = [...new Set(oracleIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const printings = [];
  for (let start = 0; start < ids.length; start += 20) {
    const batch = ids.slice(start, start + 20);
    const query = `(${batch.map((id) => `oracleid:${id}`).join(" or ")}) game:paper`;
    let url = `${scryfallApiRoot}/cards/search?${new URLSearchParams({
      q: query,
      unique: "prints",
      order: "released",
      dir: "desc"
    })}`;
    while (url) {
      const page = await fetchScryfallJson(url);
      printings.push(...(page.data || []).filter((card) => card.digital !== true && Array.isArray(card.games) && card.games.includes("paper")));
      url = page.has_more ? page.next_page : "";
    }
    process.stdout.write(`Loaded selectable printings for ${Math.min(start + batch.length, ids.length)}/${ids.length} Oracle cards.\n`);
  }
  return printings;
}

async function collectPrintingCandidates(cubeCards, existingIndex, cacheDir) {
  const currentCandidates = cubeCards.map(normalizePrintingCandidate).filter(Boolean);
  const oracleIds = [...new Set(currentCandidates.map((card) => card.oracleId))].sort();
  const desiredOracleIds = new Set(oracleIds);
  const candidates = new Map();
  Object.values(existingIndex && existingIndex.printingPrices || {}).forEach((entry) => {
    const candidate = normalizePrintingCandidate(entry);
    if (candidate && desiredOracleIds.has(candidate.oracleId)) candidates.set(candidate.scryfallId, candidate);
  });
  currentCandidates.forEach((candidate) => candidates.set(candidate.scryfallId, candidate));

  const coveredOracleIds = new Set(existingIndex && existingIndex.printingOracleIds || []);
  let missingOracleIds = oracleIds.filter((oracleId) => !coveredOracleIds.has(oracleId));
  const catalogCacheFile = path.join(cacheDir, "selectable-printings.json");
  if (missingOracleIds.length) {
    try {
      const cached = JSON.parse(await fsp.readFile(catalogCacheFile, "utf8"));
      const cachedOracleIds = new Set(cached.oracleIds || []);
      (cached.candidates || []).map(normalizePrintingCandidate).filter(Boolean).forEach((candidate) => {
        if (desiredOracleIds.has(candidate.oracleId)) candidates.set(candidate.scryfallId, candidate);
      });
      missingOracleIds = missingOracleIds.filter((oracleId) => !cachedOracleIds.has(oracleId));
    } catch (_error) {
      // Cache miss.
    }
  }
  if (missingOracleIds.length) {
    process.stdout.write(`Discovering selectable printings for ${missingOracleIds.length} Oracle cards...\n`);
    const discovered = await fetchOraclePrintings(missingOracleIds);
    discovered.map(normalizePrintingCandidate).filter(Boolean).forEach((candidate) => {
      candidates.set(candidate.scryfallId, candidate);
    });
    await fsp.writeFile(catalogCacheFile, JSON.stringify({
      oracleIds,
      candidates: [...candidates.values()]
    }));
  }
  return { oracleIds, candidates: [...candidates.values()] };
}

async function downloadFile(url, destination) {
  try {
    const stat = await fsp.stat(destination);
    if (stat.size > 0) return destination;
  } catch (_error) {
    // Cache miss.
  }
  const temporary = `${destination}.tmp`;
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) throw new Error(`${url} 下载失败：HTTP ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
  await fsp.rename(temporary, destination);
  return destination;
}

async function readCachedSet(setCode, cacheDir) {
  const cacheFile = path.join(cacheDir, `${setCode}.json`);
  try {
    return JSON.parse(await fsp.readFile(cacheFile, "utf8"));
  } catch (_error) {
    const cacheVersions = await fsp.readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of cacheVersions.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
      const previousFile = path.join(cacheRoot, entry.name, `${setCode}.json`);
      if (previousFile === cacheFile) continue;
      try {
        const text = await fsp.readFile(previousFile, "utf8");
        await fsp.writeFile(cacheFile, text);
        return JSON.parse(text);
      } catch (_previousError) {
        // Try the next cached build.
      }
    }
    const payload = await fetchJson(`${apiRoot}/${encodeURIComponent(setCode)}.json`);
    await fsp.writeFile(cacheFile, JSON.stringify(payload));
    return payload;
  }
}

function findPrinting(setPayload, cubeCard) {
  const cards = setPayload && setPayload.data && setPayload.data.cards || [];
  const scryfallId = String(cubeCard.scryfallId || "");
  if (scryfallId) {
    const exact = cards.find((card) => String(card.identifiers && card.identifiers.scryfallId || "") === scryfallId);
    if (exact) return exact;
  }
  const number = String(cubeCard.collectorNumber || "");
  return cards.find((card) => String(card.number || "") === number && String(card.name || "") === String(cubeCard.name || "")) || null;
}

async function readExistingIndex() {
  const candidates = outputFile === bundledOutputFile ? [outputFile] : [outputFile, bundledOutputFile];
  for (const file of candidates) {
    try {
      const value = JSON.parse(await fsp.readFile(file, "utf8"));
      if (validateIndex(value)) return value;
    } catch (_error) {
      // Try the bundled index when a local runtime index does not exist yet.
    }
  }
  return null;
}

async function mapPrintingUuids(cubeCards, existingIndex, cacheDir) {
  const mappings = new Map();
  const missingBySet = new Map();
  cubeCards.forEach((card) => {
    const scryfallId = String(card.scryfallId || "").trim();
    const existing = scryfallId && existingIndex && existingIndex.cards[scryfallId];
    if (existing && existing.uuid) {
      mappings.set(scryfallId, String(existing.uuid));
      return;
    }
    const setCode = String(card.set || "").trim().toUpperCase();
    if (!scryfallId || !setCode) return;
    const cards = missingBySet.get(setCode) || [];
    cards.push(card);
    missingBySet.set(setCode, cards);
  });
  const sets = [...missingBySet.entries()];
  const concurrency = 16;
  for (let start = 0; start < sets.length; start += concurrency) {
    await Promise.all(sets.slice(start, start + concurrency).map(async ([setCode, cards]) => {
      const setPayload = await readCachedSet(setCode, cacheDir);
      cards.forEach((card) => {
        const printing = findPrinting(setPayload, card);
        if (printing && printing.uuid) mappings.set(String(card.scryfallId), String(printing.uuid));
      });
    }));
    if (sets.length > concurrency) {
      process.stdout.write(`Mapped versions from ${Math.min(start + concurrency, sets.length)}/${sets.length} sets.\n`);
    }
  }
  return mappings;
}

async function streamSelectedPrices(gzipFile, targetUuids) {
  const [{ parser }, { pick }, { streamObject }, { default: chain }] = await Promise.all([
    import("stream-json"),
    import("stream-json/filters/pick.js"),
    import("stream-json/streamers/stream-object.js"),
    import("stream-chain")
  ]);
  const selected = new Map();
  const input = fs.createReadStream(gzipFile).pipe(zlib.createGunzip());
  const json = chain([input, parser(), pick({ filter: "data" }), streamObject()]);
  for await (const item of json) {
    if (targetUuids.has(item.key)) selected.set(item.key, item.value);
  }
  return selected;
}

function latestDate(cards) {
  let latest = "";
  Object.values(cards).forEach((entry) => {
    [...(entry.foil || []), ...(entry.nonfoil || [])].forEach((point) => {
      if (point[0] > latest) latest = point[0];
    });
  });
  return latest;
}

function dateOffset(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function cardmarketDateRange(priceEntries) {
  const dates = [];
  priceEntries.forEach((entry) => {
    const cardmarket = entry && entry.paper && entry.paper.cardmarket;
    ["foil", "normal"].forEach((finish) => {
      dates.push(...Object.keys(cardmarket && cardmarket.retail && cardmarket.retail[finish] || {}));
    });
  });
  dates.sort();
  return { from: dates[0] || "", to: dates[dates.length - 1] || "" };
}

async function fetchEurUsdRates(priceEntries) {
  const range = cardmarketDateRange(priceEntries);
  if (!range.from) return { rates: {}, from: "", to: "" };
  const query = new URLSearchParams({
    from: dateOffset(range.from, -7),
    to: range.to,
    base: "EUR",
    quotes: "USD",
    providers: "ECB"
  });
  const rows = await fetchJson(`${exchangeApiRoot}/rates?${query}`);
  const rates = Object.fromEntries((Array.isArray(rows) ? rows : []).flatMap((row) => {
    const date = String(row && row.date || "");
    const rate = Number(row && row.rate);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate) && rate > 0 ? [[date, rate]] : [];
  }));
  if (!Object.keys(rates).length) throw new Error("未能取得 Cardmarket EUR/USD 历史汇率");
  return { rates, from: Object.keys(rates).sort()[0], to: Object.keys(rates).sort().at(-1) };
}

async function main() {
  const includeHistory = process.argv.includes("--history");
  const cube = parseCube(JSON.parse(await fsp.readFile(cubeFile, "utf8")));
  const cubeCards = [...(cube.cards || []), ...(cube.basicLands || [])];
  const existingIndex = await readExistingIndex();
  await Promise.all([
    fsp.mkdir(path.dirname(outputFile), { recursive: true }),
    fsp.mkdir(path.dirname(scriptOutputFile), { recursive: true })
  ]);
  const metadata = await fetchJson(`${apiRoot}/Meta.json`);
  const sourceVersion = String(metadata.meta && metadata.meta.version || "unknown");
  const cacheDir = path.join(cacheRoot, sourceVersion.replace(/[^a-z0-9._+-]/gi, "_"));
  await fsp.mkdir(cacheDir, { recursive: true });

  process.stdout.write(`Mapping ${cubeCards.length} cards to MTGJSON printings...\n`);
  const mappings = await mapPrintingUuids(cubeCards, existingIndex ? {
    cards: { ...(existingIndex.printingPrices || {}), ...(existingIndex.cards || {}) }
  } : null, cacheDir);
  const printingCatalog = await collectPrintingCandidates(cubeCards, existingIndex, cacheDir);
  process.stdout.write(`Mapping ${printingCatalog.candidates.length} selectable versions to MTGJSON printings...\n`);
  const printingMappings = await mapPrintingUuids(
    printingCatalog.candidates,
    existingIndex ? { cards: existingIndex.printingPrices || {} } : null,
    cacheDir
  );

  const dailyFileName = "AllPricesToday.json.gz";
  const dailyFile = path.join(cacheDir, dailyFileName);
  await downloadFile(`${apiRoot}/${dailyFileName}`, dailyFile);
  let priceEntries;
  let printingPriceEntries;
  if (includeHistory) {
    const historyFileName = "AllPrices.json.gz";
    const historyFile = path.join(cacheDir, historyFileName);
    process.stdout.write(`Reading ${historyFileName} for ${new Set(mappings.values()).size} selected printings...\n`);
    await downloadFile(`${apiRoot}/${historyFileName}`, historyFile);
    priceEntries = await streamSelectedPrices(historyFile, new Set(mappings.values()));
    process.stdout.write(`Reading ${dailyFileName} for ${new Set(printingMappings.values()).size} selectable versions...\n`);
    printingPriceEntries = await streamSelectedPrices(dailyFile, new Set(printingMappings.values()));
  } else {
    const targetUuids = new Set([...mappings.values(), ...printingMappings.values()]);
    process.stdout.write(`Reading ${dailyFileName} for ${targetUuids.size} selected and selectable printings...\n`);
    const dailyEntries = await streamSelectedPrices(dailyFile, targetUuids);
    priceEntries = dailyEntries;
    printingPriceEntries = dailyEntries;
  }
  process.stdout.write("Loading ECB EUR/USD rates for Cardmarket fallback prices...\n");
  const exchangeEntries = new Map([...priceEntries, ...printingPriceEntries]);
  const exchange = await fetchEurUsdRates(exchangeEntries);

  const cards = {};
  cubeCards.slice().sort((a, b) => String(a.scryfallId).localeCompare(String(b.scryfallId))).forEach((card) => {
    const scryfallId = String(card.scryfallId || "").trim();
    const uuid = mappings.get(scryfallId);
    if (!scryfallId || !uuid) return;
    const priceEntry = priceEntries.get(uuid);
    const existing = existingIndex && existingIndex.cards[scryfallId] || {};
    cards[scryfallId] = {
      uuid,
      foil: mergeSeries(existing.foil, buildPriceSeries(priceEntry, "foil", PROVIDER_ORDER, exchange.rates), PROVIDER_ORDER),
      nonfoil: mergeSeries(existing.nonfoil, buildPriceSeries(priceEntry, "nonfoil", PROVIDER_ORDER, exchange.rates), PROVIDER_ORDER)
    };
  });

  const printingPrices = {};
  printingCatalog.candidates.slice().sort((a, b) => a.scryfallId.localeCompare(b.scryfallId)).forEach((printing) => {
    const uuid = printingMappings.get(printing.scryfallId);
    if (!uuid) return;
    const priceEntry = printingPriceEntries.get(uuid);
    const existing = existingIndex && existingIndex.printingPrices && existingIndex.printingPrices[printing.scryfallId] || {};
    const latestFoil = mergeSeries(existing.foil, buildPriceSeries(priceEntry, "foil", PROVIDER_ORDER, exchange.rates), PROVIDER_ORDER).slice(-1);
    const latestNonfoil = mergeSeries(existing.nonfoil, buildPriceSeries(priceEntry, "nonfoil", PROVIDER_ORDER, exchange.rates), PROVIDER_ORDER).slice(-1);
    printingPrices[printing.scryfallId] = {
      ...printing,
      uuid,
      foil: latestFoil,
      nonfoil: latestNonfoil
    };
  });
  const sourceDate = latestDate({ ...cards, ...printingPrices }) || String(metadata.meta && metadata.meta.date || "");
  const allDates = Object.values(cards).flatMap((entry) => [...entry.foil, ...entry.nonfoil].map((point) => point[0])).sort();
  const convertedPoints = Object.values(cards).reduce((total, entry) => total + [...entry.foil, ...entry.nonfoil]
    .filter((point) => PROVIDER_ORDER[point[2]] === "cardmarket").length, 0);
  const index = {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    providers: PROVIDER_ORDER,
    source: {
      name: "MTGJSON",
      version: sourceVersion,
      date: sourceDate,
      historyFrom: allDates[0] || "",
      historyTo: allDates[allDates.length - 1] || "",
      url: "https://mtgjson.com/",
      license: "MIT"
    },
    exchangeRate: {
      source: "Frankfurter",
      provider: "ECB",
      base: "EUR",
      quote: "USD",
      historyFrom: exchange.from,
      historyTo: exchange.to,
      url: "https://frankfurter.dev/"
    },
    stats: {
      requestedCards: cubeCards.length,
      indexedCards: Object.keys(cards).length,
      missingPrintings: cubeCards.length - mappings.size,
      pricedPrintings: [...mappings.values()].filter((uuid) => priceEntries.has(uuid)).length,
      selectableOracleCards: printingCatalog.oracleIds.length,
      selectablePrintings: printingCatalog.candidates.length,
      indexedSelectablePrintings: Object.keys(printingPrices).length,
      pricedSelectablePrintings: [...printingMappings.values()].filter((uuid) => printingPriceEntries.has(uuid)).length,
      convertedPoints
    },
    cards,
    printingOracleIds: printingCatalog.oracleIds,
    printingPrices
  };
  const temporaryFile = `${outputFile}.tmp`;
  const temporaryScriptFile = `${scriptOutputFile}.tmp`;
  await fsp.writeFile(temporaryFile, `${JSON.stringify(index)}\n`);
  await fsp.writeFile(temporaryScriptFile, buildIndexScript(index));
  await fsp.rename(temporaryFile, outputFile);
  await fsp.rename(temporaryScriptFile, scriptOutputFile);
  process.stdout.write(`Wrote MTGJSON price index: ${index.stats.indexedCards}/${index.stats.requestedCards} selected cards and ${index.stats.indexedSelectablePrintings}/${index.stats.selectablePrintings} selectable versions, ${index.source.historyFrom || "no history"} to ${index.source.historyTo || "no history"}.\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  cardmarketDateRange,
  collectPrintingCandidates,
  dateOffset,
  downloadFile,
  fetchOraclePrintings,
  fetchEurUsdRates,
  findPrinting,
  mapPrintingUuids,
  normalizePrintingCandidate,
  parseCube,
  streamSelectedPrices
};
