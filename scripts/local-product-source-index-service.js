#!/usr/bin/env node

const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

function validateCubeData(cubeData) {
  if (!cubeData || typeof cubeData !== "object" || !Array.isArray(cubeData.cards)) {
    throw new Error("本地产品来源更新缺少有效牌表");
  }
  if (cubeData.cards.length > 5000) throw new Error("本地产品来源更新的卡牌数量异常");
  return cubeData;
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
  let updatePromise = null;

  async function readIndex() {
    return JSON.parse(await fsp.readFile(indexFile, "utf8"));
  }

  function update(cubeData) {
    if (updatePromise) return updatePromise;
    updatePromise = (async () => {
      const validated = validateCubeData(cubeData);
      await fsp.mkdir(cacheDir, { recursive: true });
      const temporaryCubeFile = `${cubeFile}.tmp`;
      await fsp.writeFile(temporaryCubeFile, JSON.stringify(validated));
      await fsp.rename(temporaryCubeFile, cubeFile);
      await executeBuilder({ rootDir, builderFile, cubeFile, indexFile, scriptFile });
      return readIndex();
    })().finally(() => {
      updatePromise = null;
    });
    return updatePromise;
  }

  return { readIndex, update };
}

module.exports = { createLocalProductSourceIndexService, runBuilder, validateCubeData };
