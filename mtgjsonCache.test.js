const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pruneMtgjsonCache, safeVersionName, versionDate } = require("./scripts/mtgjson-cache.js");

test("MTGJSON cache pruning retains the active and previous dated versions", async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-cache-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const names = [
    "5.3.0+20260727", "5.3.0+20260728", "5.3.0+20260729", "5.3.0+20260730",
    "history", "local", "local-product-sources", "catalog"
  ];
  await Promise.all(names.map(async (name) => {
    await fsp.mkdir(path.join(root, name), { recursive: true });
    await fsp.writeFile(path.join(root, name, "keep.txt"), name);
  }));

  const result = await pruneMtgjsonCache(root, "5.3.0+20260730", { keepVersions: 2 });
  assert.deepEqual(result.kept, ["5.3.0+20260730", "5.3.0+20260729"]);
  assert.deepEqual(result.removed, ["5.3.0+20260728", "5.3.0+20260727"]);
  assert.deepEqual((await fsp.readdir(root)).sort(), [
    "5.3.0+20260729", "5.3.0+20260730", "catalog", "history", "local", "local-product-sources"
  ]);
});

test("MTGJSON cache pruning ignores unknown and non-version directories", async () => {
  assert.equal(safeVersionName("5.3.0+2026/07/31"), "5.3.0+2026_07_31");
  assert.equal(versionDate("5.3.0+20260731"), "20260731");
  assert.deepEqual(await pruneMtgjsonCache("/definitely/missing", "unknown"), { kept: [], removed: [] });
});
