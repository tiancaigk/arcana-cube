const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLocalProductSourceIndexService, validateCubeData } = require("./scripts/local-product-source-index-service.js");

function sampleIndex() {
  return {
    format: "arcana-cube-product-sources",
    version: 1,
    source: { date: "2026-07-31", cubeFingerprint: "1-abcd" },
    products: {},
    cards: {}
  };
}

test("local product source service builds from supplied Cube data and caches the result", async (t) => {
  const rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-product-source-index-"));
  t.after(() => fsp.rm(rootDir, { recursive: true, force: true }));
  let builds = 0;
  const service = createLocalProductSourceIndexService({
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
  assert.equal(first.source.cubeFingerprint, "1-abcd");
  assert.deepEqual(second, first);
  assert.deepEqual(await service.readIndex(), first);
});

test("local product source service rejects malformed or unreasonable Cube data", () => {
  assert.throws(() => validateCubeData({}), /有效牌表/);
  assert.throws(() => validateCubeData({ cards: Array.from({ length: 5001 }, () => ({})) }), /数量异常/);
});
