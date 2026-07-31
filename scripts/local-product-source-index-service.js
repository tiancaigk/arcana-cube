#!/usr/bin/env node

const fsp = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { cubeFingerprint } = require("../mtgjsonPrices.js");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requestedCards(cubeData) {
  return [
    ...(Array.isArray(cubeData.cards) ? cubeData.cards : []),
    ...(Array.isArray(cubeData.basicLands) ? cubeData.basicLands : [])
  ];
}

function validateCubeData(cubeData) {
  if (!cubeData || typeof cubeData !== "object" || !Array.isArray(cubeData.cards)) {
    throw new Error("本地产品来源更新缺少有效牌表");
  }
  if (cubeData.basicLands !== undefined && !Array.isArray(cubeData.basicLands)) {
    throw new Error("本地产品来源更新缺少有效基本地牌表");
  }
  const cards = requestedCards(cubeData);
  if (!cards.length) throw new Error("本地产品来源更新没有可处理的卡牌");
  if (cards.length > 5000) throw new Error("本地产品来源更新的卡牌数量异常");
  cards.forEach((card, index) => {
    if (!card || typeof card !== "object") throw new Error(`本地产品来源更新第 ${index + 1} 张卡格式无效`);
    if (!UUID_PATTERN.test(String(card.scryfallId || "").trim())) {
      throw new Error(`本地产品来源更新第 ${index + 1} 张卡缺少有效 Scryfall ID`);
    }
    if (!String(card.set || "").trim()) throw new Error(`本地产品来源更新第 ${index + 1} 张卡缺少系列`);
    if (!String(card.collectorNumber || "").trim()) throw new Error(`本地产品来源更新第 ${index + 1} 张卡缺少编号`);
  });
  return cubeData;
}

function validateBuiltIndex(index, expectedFingerprint, requestedCount) {
  const indexedCount = Number(index && index.stats && index.stats.indexedCards);
  const reportedCount = Number(index && index.stats && index.stats.requestedCards);
  const actualCount = index && index.cards && typeof index.cards === "object"
    ? Object.keys(index.cards).length
    : -1;
  if (!index || index.format !== "arcana-cube-product-sources" || Number(index.version) !== 1 || !index.products || typeof index.products !== "object" || Array.isArray(index.products) || Array.isArray(index.cards)) {
    throw new Error("MTGJSON 本地产品来源索引构建结果格式无效");
  }
  if (!index.source || index.source.cubeFingerprint !== expectedFingerprint) {
    throw new Error("MTGJSON 本地产品来源索引与请求牌表不一致");
  }
  if (reportedCount !== requestedCount || !Number.isInteger(indexedCount) || indexedCount < 1 || indexedCount > requestedCount || actualCount !== indexedCount) {
    throw new Error("MTGJSON 本地产品来源索引构建结果数量异常");
  }
  return index;
}

async function removeFiles(files) {
  await Promise.allSettled(files.map((file) => fsp.rm(file, { force: true })));
}

function runBuilder(options) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [options.builderFile], {
      cwd: options.rootDir,
      env: {
        ...process.env,
        CUBE_DATA_FILE: options.cubeFile,
        PRODUCT_SOURCE_OUTPUT_FILE: options.indexFile,
        PRODUCT_SOURCE_SCRIPT_OUTPUT_FILE: options.scriptFile
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-64 * 1024);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(output.trim() || `MTGJSON 本地产品来源索引构建失败 (${code})`));
    });
  });
}

function createLocalProductSourceIndexService(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const cacheDir = options.cacheDir || path.join(rootDir, ".cache", "mtgjson", "local-product-sources");
  const builderFile = options.builderFile || path.join(rootDir, "scripts", "build-product-source-index.js");
  const cubeFile = options.cubeFile || path.join(cacheDir, "cube-data.json");
  const indexFile = options.indexFile || path.join(cacheDir, "product-source-index.json");
  const scriptFile = options.scriptFile || path.join(cacheDir, "product-source-index.js");
  const executeBuilder = options.runBuilder || runBuilder;
  const pendingUpdates = new Map();
  let updateQueue = Promise.resolve();

  async function readIndex() {
    return JSON.parse(await fsp.readFile(indexFile, "utf8"));
  }

  async function build(cubeJson, fingerprint, cardCount) {
    const token = randomUUID();
    const stagingCubeFile = path.join(path.dirname(cubeFile), `.${path.basename(cubeFile)}.${token}.stage`);
    const stagingIndexFile = path.join(path.dirname(indexFile), `.${path.basename(indexFile)}.${token}.stage`);
    const stagingScriptFile = path.join(path.dirname(scriptFile), `.${path.basename(scriptFile)}.${token}.stage`);
    const stagingFiles = [
      stagingCubeFile,
      stagingIndexFile,
      stagingScriptFile,
      `${stagingIndexFile}.tmp`,
      `${stagingScriptFile}.tmp`
    ];
    try {
      await Promise.all([...new Set(stagingFiles.map((file) => path.dirname(file)))]
        .map((directory) => fsp.mkdir(directory, { recursive: true })));
      await fsp.writeFile(stagingCubeFile, cubeJson);
      await executeBuilder({
        rootDir,
        builderFile,
        cubeFile: stagingCubeFile,
        indexFile: stagingIndexFile,
        scriptFile: stagingScriptFile
      });
      const index = validateBuiltIndex(
        JSON.parse(await fsp.readFile(stagingIndexFile, "utf8")),
        fingerprint,
        cardCount
      );
      const scriptStat = await fsp.stat(stagingScriptFile);
      if (!scriptStat.isFile() || scriptStat.size < 1) throw new Error("MTGJSON 本地产品来源索引脚本构建结果无效");

      await fsp.rename(stagingCubeFile, cubeFile);
      await fsp.rename(stagingScriptFile, scriptFile);
      await fsp.rename(stagingIndexFile, indexFile);
      return index;
    } finally {
      await removeFiles(stagingFiles);
    }
  }

  function update(cubeData) {
    const validated = validateCubeData(cubeData);
    const cards = requestedCards(validated);
    const fingerprint = cubeFingerprint(cards);
    const existing = pendingUpdates.get(fingerprint);
    if (existing) return existing;

    const cubeJson = JSON.stringify(validated);
    const task = updateQueue.then(() => build(cubeJson, fingerprint, cards.length));
    pendingUpdates.set(fingerprint, task);
    updateQueue = task.catch(() => {});
    const clear = () => {
      if (pendingUpdates.get(fingerprint) === task) pendingUpdates.delete(fingerprint);
    };
    task.then(clear, clear);
    return task;
  }

  return { readIndex, update };
}

module.exports = { createLocalProductSourceIndexService, runBuilder, validateBuiltIndex, validateCubeData };
