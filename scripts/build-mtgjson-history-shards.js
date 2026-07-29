#!/usr/bin/env node

"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  buildPriceSeries,
  validateIndex
} = require("../mtgjsonPrices.js");
const { shardFileNameForKey, shardKeyForEntry } = require("../mtgjsonHistoryShards.js");
const {
  downloadFile,
  fetchEurUsdRates,
  streamSelectedPrices
} = require("./build-mtgjson-price-index.js");

const rootDir = path.resolve(__dirname, "..");
const indexFile = path.join(rootDir, "mtgjson-price-index.json");
const cacheRoot = path.join(rootDir, ".cache", "mtgjson");
const apiRoot = "https://mtgjson.com/api/v5";

function historyRange(cards) {
  const dates = Object.values(cards).flatMap((entry) => [
    ...(entry.foil || []),
    ...(entry.nonfoil || [])
  ].map((point) => point[0])).sort();
  return { from: dates[0] || "", to: dates[dates.length - 1] || "" };
}

function buildShardScript(shards) {
  const serialized = JSON.stringify(shards)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `(function(root){var data=root.CubeMtgjsonHistoryShardData||(root.CubeMtgjsonHistoryShardData={});Object.assign(data,${serialized});})(typeof globalThis!=="undefined"?globalThis:this);\n`;
}

async function writeHistoryShards(index, priceEntries, exchangeRates, destination = rootDir) {
  const groups = new Map();
  Object.entries(index.printingPrices || {}).forEach(([scryfallId, printing]) => {
    if (index.cards && index.cards[scryfallId]) return;
    const key = shardKeyForEntry(printing);
    if (!key || !printing.uuid) return;
    const cards = groups.get(key) || {};
    const priceEntry = priceEntries.get(String(printing.uuid));
    cards[scryfallId] = {
      uuid: String(printing.uuid),
      foil: buildPriceSeries(priceEntry, "foil", index.providers, exchangeRates),
      nonfoil: buildPriceSeries(priceEntry, "nonfoil", index.providers, exchangeRates)
    };
    groups.set(key, cards);
  });

  const buckets = new Map();
  for (const [key, cards] of groups) {
    const range = historyRange(cards);
    const fileName = shardFileNameForKey(key);
    const shards = buckets.get(fileName) || {};
    shards[key] = {
      sourceVersion: String(index.source && index.source.version || ""),
      historyFrom: range.from,
      historyTo: range.to,
      cards
    };
    buckets.set(fileName, shards);
  }

  await fsp.mkdir(destination, { recursive: true });
  const temporaryDir = path.join(destination, ".mtgjson-history.tmp");
  await fsp.rm(temporaryDir, { recursive: true, force: true });
  await fsp.mkdir(temporaryDir, { recursive: true });
  let indexedCards = 0;
  let totalBytes = 0;
  for (const [fileName, shards] of [...buckets].sort(([a], [b]) => a.localeCompare(b))) {
    const script = buildShardScript(shards);
    await fsp.writeFile(path.join(temporaryDir, fileName), script);
    indexedCards += Object.values(shards).reduce((total, shard) => total + Object.keys(shard.cards).length, 0);
    totalBytes += Buffer.byteLength(script);
  }
  const existingFiles = await fsp.readdir(destination);
  await Promise.all(existingFiles
    .filter((fileName) => /^mtgjson-history-[0-9a-f]\.js$/.test(fileName))
    .map((fileName) => fsp.rm(path.join(destination, fileName), { force: true })));
  for (const fileName of buckets.keys()) {
    await fsp.rename(path.join(temporaryDir, fileName), path.join(destination, fileName));
  }
  await fsp.rm(temporaryDir, { recursive: true, force: true });
  await fsp.rm(path.join(destination, "mtgjson-history"), { recursive: true, force: true });
  return { files: buckets.size, shards: groups.size, indexedCards, totalBytes };
}

async function main() {
  const index = JSON.parse(await fsp.readFile(indexFile, "utf8"));
  if (!validateIndex(index)) throw new Error("MTGJSON 价格索引格式无效");
  const sourceVersion = String(index.source && index.source.version || "").trim();
  if (!sourceVersion) throw new Error("MTGJSON 价格索引缺少版本信息");
  const cacheDir = path.join(cacheRoot, sourceVersion.replace(/[^a-z0-9._+-]/gi, "_"));
  await fsp.mkdir(cacheDir, { recursive: true });
  const historyFile = path.join(cacheDir, "AllPrices.json.gz");
  await downloadFile(`${apiRoot}/AllPrices.json.gz`, historyFile);

  const targetUuids = new Set(Object.entries(index.printingPrices || {})
    .filter(([scryfallId, entry]) => !(index.cards && index.cards[scryfallId]) && entry.uuid)
    .map(([, entry]) => String(entry.uuid)));
  process.stdout.write(`Reading AllPrices.json.gz for ${targetUuids.size} selectable printings...\n`);
  const priceEntries = await streamSelectedPrices(historyFile, targetUuids);
  process.stdout.write("Loading ECB EUR/USD rates for Cardmarket fallback prices...\n");
  const exchange = await fetchEurUsdRates(priceEntries);
  const result = await writeHistoryShards(index, priceEntries, exchange.rates);
  process.stdout.write(`Wrote ${result.shards} MTGJSON history shards in ${result.files} files for ${result.indexedCards} selectable printings (${(result.totalBytes / 1024 / 1024).toFixed(1)} MB).\n`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildShardScript, historyRange, writeHistoryShards };
