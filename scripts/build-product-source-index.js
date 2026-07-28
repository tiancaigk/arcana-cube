#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");
const { collapseProducts, isPaperProduct } = require("../productSources.js");

const rootDir = path.resolve(__dirname, "..");
const cubeFile = path.join(rootDir, "cube-data.json");
const outputFile = path.join(rootDir, "product-source-index.json");
const scriptOutputFile = path.join(rootDir, "product-source-index.js");
const cacheRoot = path.join(rootDir, ".cache", "mtgjson");
const apiRoot = "https://mtgjson.com/api/v5";
const headers = {
  Accept: "application/json",
  "User-Agent": "ArcanaCubeProductIndex/1.0"
};
const deckCardZones = ["commander", "displayCommander", "mainBoard", "sideBoard", "planes", "schemes", "tokens"];

function parseCube(payload) {
  if (payload && payload.data && Array.isArray(payload.data.cards)) return payload.data;
  if (payload && Array.isArray(payload.cards)) return payload;
  throw new Error("cube-data.json 格式无效");
}

function cardSources(card) {
  const source = card && card.sourceProducts || {};
  return {
    nonfoil: Array.isArray(source.nonfoil) ? source.nonfoil : [],
    foil: Array.isArray(source.foil) ? source.foil : [],
    etched: Array.isArray(source.etched) ? source.etched : []
  };
}

function compactProduct(product) {
  return {
    uuid: String(product.uuid || ""),
    name: String(product.name || ""),
    category: String(product.category || ""),
    subtype: product.subtype == null ? "" : String(product.subtype),
    releaseDate: String(product.releaseDate || "")
  };
}

function buildIndexScript(index) {
  const serialized = JSON.stringify(index)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `(function (root) { root.CubeProductSourceIndex = ${serialized}; })(typeof globalThis !== "undefined" ? globalThis : this);\n`;
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw new Error(`${url} 下载失败：${lastError && lastError.message || "未知错误"}`);
}

async function readCachedSet(setCode, cacheDir) {
  const cacheFile = path.join(cacheDir, `${setCode}.json`);
  try {
    return JSON.parse(await fs.readFile(cacheFile, "utf8"));
  } catch (error) {
    const payload = await fetchJson(`${apiRoot}/${encodeURIComponent(setCode)}.json`);
    await fs.writeFile(cacheFile, JSON.stringify(payload));
    return payload;
  }
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function buildProductMap(setList) {
  const products = new Map();
  (setList.data || []).forEach((set) => {
    (set.sealedProduct || []).forEach((product) => {
      if (product && product.uuid) products.set(product.uuid, product);
    });
  });
  return products;
}

function buildDeckCardMap(setPayloads) {
  const deckCardsByProduct = new Map();
  setPayloads.forEach(([, payload]) => {
    (payload && payload.data && payload.data.decks || []).forEach((deck) => {
      const productUuids = Array.isArray(deck.sealedProductUuids) ? deck.sealedProductUuids : [];
      const cardUuids = new Set(deckCardZones.flatMap((zone) => (
        Array.isArray(deck[zone]) ? deck[zone].map((card) => card && card.uuid).filter(Boolean) : []
      )));
      productUuids.forEach((productUuid) => {
        const current = deckCardsByProduct.get(productUuid) || new Set();
        cardUuids.forEach((cardUuid) => current.add(cardUuid));
        deckCardsByProduct.set(productUuid, current);
      });
    });
  });
  return deckCardsByProduct;
}

function isDirectProductSource(product, printing, sourceProductUuids, deckCardsByProduct = new Map()) {
  const category = String(product && product.category || "").toLocaleLowerCase();
  const contents = product && product.contents || {};
  const normalizedSetCode = String(printing && printing.setCode || "").toUpperCase();
  const normalizedNumber = String(printing && printing.number || "");
  const hasDirectCard = (contents.card || []).some((card) => (
    String(card && card.set || "").toUpperCase() === normalizedSetCode
    && String(card && card.number || "") === normalizedNumber
  ));
  if (hasDirectCard) return true;
  const deckCards = deckCardsByProduct.get(product && product.uuid);
  if (category === "deck" && deckCards && deckCards.has(printing && printing.uuid)) return true;
  const includedSources = (contents.sealed || [])
    .map((sealed) => sealed && sealed.uuid)
    .filter((uuid) => uuid && sourceProductUuids.has(uuid));
  return includedSources.length === 0;
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

function resolveProducts(sourceUuids, printing, productMap, deckCardsByProduct, unresolvedProducts, usedProducts) {
  const seen = new Set();
  const sourceProductUuids = new Set(sourceUuids);
  const products = sourceUuids.flatMap((uuid) => {
    if (!uuid || seen.has(uuid)) return [];
    seen.add(uuid);
    const product = productMap.get(uuid);
    if (!product) {
      unresolvedProducts.add(uuid);
      return [];
    }
    if (!isPaperProduct(product)) return [];
    if (!isDirectProductSource(product, printing, sourceProductUuids, deckCardsByProduct)) return [];
    return [product];
  });
  return collapseProducts(products).map((product) => {
    usedProducts.set(product.uuid, compactProduct(product));
    return product.uuid;
  });
}

async function main() {
  const cube = parseCube(JSON.parse(await fs.readFile(cubeFile, "utf8")));
  const cubeCards = [...(cube.cards || []), ...(cube.basicLands || [])];
  const cardsBySet = new Map();
  cubeCards.forEach((card) => {
    const setCode = String(card.set || "").trim().toUpperCase();
    if (!setCode) return;
    const cards = cardsBySet.get(setCode) || [];
    cards.push(card);
    cardsBySet.set(setCode, cards);
  });

  process.stdout.write(`Reading MTGJSON product catalog for ${cubeCards.length} cards in ${cardsBySet.size} sets...\n`);
  const setList = await fetchJson(`${apiRoot}/SetList.json`);
  const sourceVersion = String(setList.meta && setList.meta.version || "unknown");
  const cacheDir = path.join(cacheRoot, sourceVersion.replace(/[^a-z0-9._+-]/gi, "_"));
  await fs.mkdir(cacheDir, { recursive: true });
  const productMap = buildProductMap(setList);
  const setCodes = [...cardsBySet.keys()].sort();
  let completed = 0;
  const setPayloads = await mapLimit(setCodes, 4, async (setCode) => {
    const payload = await readCachedSet(setCode, cacheDir);
    completed += 1;
    if (completed % 10 === 0 || completed === setCodes.length) {
      process.stdout.write(`Loaded ${completed}/${setCodes.length} sets\r`);
    }
    return [setCode, payload];
  });
  process.stdout.write("\n");
  const setMap = new Map(setPayloads);
  const deckCardsByProduct = buildDeckCardMap(setPayloads);
  const cards = {};
  const missingCards = [];
  const unresolvedProducts = new Set();
  const usedProducts = new Map();

  cubeCards.slice().sort((a, b) => String(a.scryfallId).localeCompare(String(b.scryfallId))).forEach((cubeCard) => {
    const scryfallId = String(cubeCard.scryfallId || "").trim();
    const setCode = String(cubeCard.set || "").trim().toUpperCase();
    if (!scryfallId || !setMap.has(setCode)) {
      missingCards.push(`${setCode} ${cubeCard.collectorNumber || ""} ${cubeCard.name || ""}`.trim());
      return;
    }
    const printing = findPrinting(setMap.get(setCode), cubeCard);
    if (!printing) {
      missingCards.push(`${setCode} ${cubeCard.collectorNumber || ""} ${cubeCard.name || ""}`.trim());
      return;
    }
    const sources = cardSources(printing);
    cards[scryfallId] = {
      setCode,
      collectorNumber: String(printing.number || cubeCard.collectorNumber || ""),
      boosterTypes: Array.isArray(printing.boosterTypes) ? printing.boosterTypes : [],
      promoTypes: Array.isArray(printing.promoTypes) ? printing.promoTypes : [],
      sources: {
        nonfoil: resolveProducts(sources.nonfoil, printing, productMap, deckCardsByProduct, unresolvedProducts, usedProducts),
        foil: resolveProducts(sources.foil, printing, productMap, deckCardsByProduct, unresolvedProducts, usedProducts),
        etched: resolveProducts(sources.etched, printing, productMap, deckCardsByProduct, unresolvedProducts, usedProducts)
      }
    };
  });
  const products = Object.fromEntries([...usedProducts.entries()].sort(([a], [b]) => a.localeCompare(b)));

  const index = {
    format: "arcana-cube-product-sources",
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      name: "MTGJSON",
      version: sourceVersion,
      date: String(setList.meta && setList.meta.date || ""),
      url: "https://mtgjson.com/",
      license: "MIT"
    },
    products,
    stats: {
      requestedCards: cubeCards.length,
      indexedCards: Object.keys(cards).length,
      missingCards: missingCards.length,
      unresolvedProducts: unresolvedProducts.size
    },
    cards
  };
  const temporaryFile = `${outputFile}.tmp`;
  const temporaryScriptFile = `${scriptOutputFile}.tmp`;
  await fs.writeFile(temporaryFile, `${JSON.stringify(index)}\n`);
  await fs.writeFile(temporaryScriptFile, buildIndexScript(index));
  await fs.rename(temporaryFile, outputFile);
  await fs.rename(temporaryScriptFile, scriptOutputFile);
  process.stdout.write(`Wrote ${path.basename(outputFile)} and ${path.basename(scriptOutputFile)}: ${index.stats.indexedCards}/${index.stats.requestedCards} cards indexed.\n`);
  if (missingCards.length) process.stdout.write(`Missing cards (${missingCards.length}): ${missingCards.slice(0, 12).join("; ")}${missingCards.length > 12 ? "; ..." : ""}\n`);
  if (unresolvedProducts.size) process.stdout.write(`Unresolved sealed product IDs: ${unresolvedProducts.size}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildDeckCardMap, buildIndexScript, isDirectProductSource };
