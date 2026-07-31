const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalPriceIndexService, validateCubeData } = require("./scripts/local-price-index-service.js");

function sampleIndex(date = "2026-07-29") {
  return {
    format: "arcana-cube-mtgjson-prices",
    version: 2,
    generatedAt: `${date}T12:00:00.000Z`,
    providers: ["tcgplayer"],
    source: { date },
    cards: {}
  };
}

test("local price index service builds from supplied Cube data and caches the result", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-price-index-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  let builds = 0;
  const service = createLocalPriceIndexService({
    rootDir,
    cacheDir: path.join(rootDir, "cache"),
    runBuilder: async ({ cubeFile, indexFile, scriptFile }) => {
      builds += 1;
      const cube = JSON.parse(await fsp.readFile(cubeFile, "utf8"));
      assert.equal(cube.cards[0].collectorNumber, "126★");
      await Promise.all([
        fsp.writeFile(indexFile, JSON.stringify(sampleIndex())),
        fsp.writeFile(scriptFile, "index")
      ]);
    }
  });
  const cubeData = { meta: { name: "Test" }, cards: [{ name: "Card", collectorNumber: "126★" }] };
  const [first, second] = await Promise.all([service.update(cubeData), service.update(cubeData)]);
  assert.equal(builds, 1);
  assert.equal(first.source.date, "2026-07-29");
  assert.deepEqual(second, first);
  assert.deepEqual(await service.readIndex(), first);
});

test("local price index service rejects malformed or unreasonable Cube data", () => {
  assert.throws(() => validateCubeData({}), /有效牌表/);
  assert.throws(() => validateCubeData({ cards: [] }), /没有可处理的卡牌/);
  assert.throws(() => validateCubeData({ cards: Array.from({ length: 5001 }, () => ({})) }), /数量异常/);
});
