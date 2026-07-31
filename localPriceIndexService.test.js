const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { cubeFingerprint } = require("./mtgjsonPrices.js");
const { createLocalPriceIndexService, validateBuiltIndex, validateCubeData } = require("./scripts/local-price-index-service.js");

const ids = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222"
};
const oracleIds = {
  a: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
};

function sampleCube(key = "a", collectorNumber = "126★") {
  return {
    meta: { name: key.toUpperCase() },
    cards: [{
      name: `Card ${key.toUpperCase()}`,
      scryfallId: ids[key],
      oracleId: oracleIds[key],
      set: "TST",
      collectorNumber
    }]
  };
}

function sampleIndex(cube, date = "2026-07-29") {
  const cards = [...cube.cards, ...(cube.basicLands || [])];
  return {
    format: "arcana-cube-mtgjson-prices",
    version: 2,
    generatedAt: `${date}T12:00:00.000Z`,
    providers: ["tcgplayer"],
    source: { date, cubeFingerprint: cubeFingerprint(cards), requestName: cube.meta.name },
    stats: { requestedCards: cards.length, indexedCards: cards.length },
    cards: Object.fromEntries(cards.map((card) => [card.scryfallId, { uuid: card.scryfallId, foil: [], nonfoil: [] }]))
  };
}

async function writeBuild(indexFile, scriptFile, index) {
  await Promise.all([
    fsp.writeFile(indexFile, JSON.stringify(index)),
    fsp.writeFile(scriptFile, "index")
  ]);
}

test("local price index service builds in staging and coalesces the same Cube fingerprint", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-price-index-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  const cacheDir = path.join(rootDir, "cache");
  let builds = 0;
  const service = createLocalPriceIndexService({
    rootDir,
    cacheDir,
    runBuilder: async ({ cubeFile, indexFile, scriptFile }) => {
      builds += 1;
      assert.match(path.basename(cubeFile), /^\.cube-data\.json\..+\.stage$/);
      const cube = JSON.parse(await fsp.readFile(cubeFile, "utf8"));
      assert.equal(cube.cards[0].collectorNumber, "126★");
      await writeBuild(indexFile, scriptFile, sampleIndex(cube));
    }
  });
  const cubeData = sampleCube();
  const firstPromise = service.update(cubeData);
  const secondPromise = service.update(cubeData);
  assert.strictEqual(secondPromise, firstPromise);
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(builds, 1);
  assert.equal(first.source.date, "2026-07-29");
  assert.deepEqual(second, first);
  assert.deepEqual(await service.readIndex(), first);
  assert.deepEqual((await fsp.readdir(cacheDir)).sort(), [
    "cube-data.json",
    "mtgjson-price-index.js",
    "mtgjson-price-index.json"
  ]);
});

test("local price index service serializes different fingerprints and returns each matching result", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-price-queue-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  const builds = [];
  const service = createLocalPriceIndexService({
    rootDir,
    cacheDir: path.join(rootDir, "cache"),
    runBuilder: async ({ cubeFile, indexFile, scriptFile }) => {
      const cube = JSON.parse(await fsp.readFile(cubeFile, "utf8"));
      builds.push(cube.meta.name);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await writeBuild(indexFile, scriptFile, sampleIndex(cube));
    }
  });
  const [first, second] = await Promise.all([
    service.update(sampleCube("a")),
    service.update(sampleCube("b"))
  ]);
  assert.deepEqual(builds, ["A", "B"]);
  assert.equal(first.source.requestName, "A");
  assert.equal(second.source.requestName, "B");
  assert.equal((await service.readIndex()).source.requestName, "B");
});

test("local price index service preserves live files when staged output is invalid", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-price-rollback-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  const cacheDir = path.join(rootDir, "cache");
  await fsp.mkdir(cacheDir, { recursive: true });
  const oldCube = sampleCube("a");
  const oldIndex = sampleIndex(oldCube, "2026-07-28");
  await Promise.all([
    fsp.writeFile(path.join(cacheDir, "cube-data.json"), JSON.stringify(oldCube)),
    fsp.writeFile(path.join(cacheDir, "mtgjson-price-index.json"), JSON.stringify(oldIndex)),
    fsp.writeFile(path.join(cacheDir, "mtgjson-price-index.js"), "old-index")
  ]);
  const service = createLocalPriceIndexService({
    rootDir,
    cacheDir,
    runBuilder: async ({ indexFile, scriptFile }) => {
      assert.deepEqual(JSON.parse(await fsp.readFile(indexFile, "utf8")), oldIndex);
      await writeBuild(indexFile, scriptFile, oldIndex);
    }
  });

  await assert.rejects(service.update(sampleCube("b")), /与请求牌表不一致/);
  assert.deepEqual(await service.readIndex(), oldIndex);
  assert.equal(await fsp.readFile(path.join(cacheDir, "cube-data.json"), "utf8"), JSON.stringify(oldCube));
  assert.equal(await fsp.readFile(path.join(cacheDir, "mtgjson-price-index.js"), "utf8"), "old-index");
  assert.deepEqual((await fsp.readdir(cacheDir)).sort(), [
    "cube-data.json",
    "mtgjson-price-index.js",
    "mtgjson-price-index.json"
  ]);
});

test("local price index service rejects incomplete cards and unreasonable output", () => {
  assert.throws(() => validateCubeData({}), /有效牌表/);
  assert.throws(() => validateCubeData({ cards: [] }), /没有可处理的卡牌/);
  assert.throws(() => validateCubeData({ cards: Array.from({ length: 5001 }, () => ({})) }), /数量异常/);
  assert.throws(() => validateCubeData({ cards: [{ ...sampleCube().cards[0], scryfallId: "" }] }), /Scryfall ID/);
  assert.throws(() => validateCubeData({ cards: [{ ...sampleCube().cards[0], oracleId: "" }] }), /Oracle ID/);
  assert.throws(() => validateCubeData({ cards: [{ ...sampleCube().cards[0], set: "" }] }), /系列/);
  assert.throws(() => validateCubeData({ cards: [{ ...sampleCube().cards[0], collectorNumber: "" }] }), /编号/);
  const cube = sampleCube();
  const empty = sampleIndex(cube);
  empty.cards = {};
  empty.stats.indexedCards = 0;
  assert.throws(() => validateBuiltIndex(empty, cubeFingerprint(cube.cards), 1), /数量异常/);
});
