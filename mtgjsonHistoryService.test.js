const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { MAX_HISTORY_IDS, createMtgjsonHistoryService, normalizeIds } = require("./scripts/mtgjson-history-service.js");

const scryfallId = "68785426-6868-4184-8d52-75a6a920848b";
const uuid = "c37b5396-403c-5514-9c3c-3f3ace3baf71";

function writeIndex(rootDir) {
  fs.writeFileSync(path.join(rootDir, "mtgjson-price-index.json"), JSON.stringify({
    format: "arcana-cube-mtgjson-prices",
    version: 2,
    providers: ["tcgplayer", "manapool", "cardkingdom", "cardmarket"],
    source: { version: "test-version", date: "2026-07-28" },
    cards: {},
    printingPrices: {
      [scryfallId]: { uuid, foil: [["2026-07-28", 17.37, 1]], nonfoil: [] }
    }
  }));
}

test("history service extracts and caches selected MTGJSON printing history", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcana-history-"));
  writeIndex(rootDir);
  let streamCalls = 0;
  const service = createMtgjsonHistoryService({
    rootDir,
    cacheRoot: path.join(rootDir, ".cache"),
    downloadFile: async (_url, destination) => {
      assert.equal(fs.existsSync(path.dirname(destination)), true);
      return destination;
    },
    fetchEurUsdRates: async () => ({ rates: {}, from: "", to: "" }),
    streamSelectedPrices: async (_file, targetUuids) => {
      streamCalls += 1;
      assert.deepEqual([...targetUuids], [uuid]);
      return new Map([[uuid, {
        paper: {
          manapool: {
            currency: "USD",
            retail: { foil: { "2026-04-29": 20.31, "2026-07-28": 17.37 } }
          }
        }
      }]]);
    }
  });

  const first = await service.getHistory([scryfallId]);
  const nextIndex = JSON.parse(fs.readFileSync(path.join(rootDir, "mtgjson-price-index.json"), "utf8"));
  nextIndex.source = { version: "next-test-version", date: "2026-07-29" };
  nextIndex.printingPrices[scryfallId].foil = [["2026-07-29", 17.5, 1]];
  fs.writeFileSync(path.join(rootDir, "mtgjson-price-index.json"), JSON.stringify(nextIndex));
  const second = await service.getHistory([scryfallId]);
  assert.deepEqual(first.cards[scryfallId].foil, [
    ["2026-04-29", 20.31, 1],
    ["2026-07-28", 17.37, 1]
  ]);
  assert.equal(first.source.historyFrom, "2026-04-29");
  assert.deepEqual(second.cards[scryfallId].foil.at(-1), ["2026-07-29", 17.5, 1]);
  assert.equal(streamCalls, 1);
});

test("history service accepts only unique Scryfall UUIDs", () => {
  assert.deepEqual(normalizeIds([scryfallId, scryfallId.toUpperCase(), "bad"]), [scryfallId]);
});

test("history service accepts a complete Cube-sized request", async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcana-history-limit-"));
  writeIndex(rootDir);
  const ids = Array.from({ length: 101 }, (_value, index) => (
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  ));
  const result = await createMtgjsonHistoryService({ rootDir }).getHistory(ids);
  assert.equal(result.stats.requestedCards, 101);
  assert.equal(result.stats.unresolvedCards, 101);
});

test("history service retains a guard against unreasonable requests", async () => {
  const ids = Array.from({ length: MAX_HISTORY_IDS + 1 }, (_value, index) => (
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
  ));
  await assert.rejects(
    createMtgjsonHistoryService({ rootDir: "/missing" }).getHistory(ids),
    new RegExp(`最多补全 ${MAX_HISTORY_IDS}`)
  );
});
