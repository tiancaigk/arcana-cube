const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHistoryShardCatalog, shardFileNameForKey, shardKeyForEntry, sourceFamily } = require("./mtgjsonHistoryShards.js");
const { writeHistoryShards } = require("./scripts/build-mtgjson-history-shards.js");

const scryfallId = "68785426-6868-4184-8d52-75a6a920848b";
const uuid = "c37b5396-403c-5514-9c3c-3f3ace3baf71";

function sampleIndex() {
  return {
    format: "arcana-cube-mtgjson-prices",
    version: 2,
    providers: ["tcgplayer", "manapool", "cardkingdom", "cardmarket"],
    source: { version: "5.3.0+20260729", date: "2026-07-29" },
    cards: {},
    printingPrices: {
      [scryfallId]: { scryfallId, set: "SLD", uuid }
    }
  };
}

test("history shards use a stable set-code key", () => {
  assert.equal(shardKeyForEntry({ set: " SLD " }), "sld");
  assert.equal(shardKeyForEntry({ set: "P-SET" }), "p_set");
  assert.equal(shardKeyForEntry({}), "");
  assert.match(shardFileNameForKey("sld"), /^mtgjson-history-[0-9a-f]\.js$/);
  assert.equal(sourceFamily("5.3.0+20260728"), "5.3.0");
});

test("history shard catalog loads matching static scripts and exact printings", async () => {
  const registry = {};
  const documentObject = {
    head: {
      appendChild(script) {
        assert.equal(script.src, shardFileNameForKey("sld"));
        registry.sld = {
          sourceVersion: "5.3.0+20260728",
          historyFrom: "2026-04-29",
          historyTo: "2026-07-28",
          cards: { [scryfallId]: { uuid, foil: [["2026-07-28", 17.37, 1]], nonfoil: [] } }
        };
        script.onload();
      }
    },
    createElement() {
      return { remove() {} };
    }
  };
  const catalog = createHistoryShardCatalog({ documentObject, registry });
  const result = await catalog.load(sampleIndex(), [scryfallId, "unknown"]);
  assert.deepEqual(Object.keys(result.cards), [scryfallId]);
  assert.equal(result.historyFrom, "2026-04-29");
  assert.equal(result.historyTo, "2026-07-28");
});

test("history shard builder excludes cards already stored in the main index", async () => {
  const index = sampleIndex();
  index.printingPrices.existing = { scryfallId: "existing", set: "SLD", uuid: "existing-uuid" };
  index.cards.existing = { uuid: "existing-uuid", foil: [], nonfoil: [] };
  const prices = new Map([[uuid, {
    paper: {
      manapool: {
        currency: "USD",
        retail: { foil: { "2026-04-29": 20.31, "2026-07-28": 17.37 } }
      }
    }
  }]]);
  const outputDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "arcana-shards-")), "history");
  const result = await writeHistoryShards(index, prices, {}, outputDir);
  const source = fs.readFileSync(path.join(outputDir, shardFileNameForKey("sld")), "utf8");
  assert.equal(result.files, 1);
  assert.equal(result.shards, 1);
  assert.equal(result.indexedCards, 1);
  assert.match(source, new RegExp(scryfallId));
  assert.doesNotMatch(source, /existing-uuid/);
});
