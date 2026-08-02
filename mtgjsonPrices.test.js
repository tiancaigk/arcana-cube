const test = require("node:test");
const assert = require("node:assert/strict");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  buildIndexScript,
  buildPriceSeries,
  createMtgjsonPriceCatalog,
  cubeFingerprint,
  hasHistoricalEntry,
  lookupPrice,
  lookupPrintingPrice,
  mergePriceIndexes,
  mergeSeries,
  overlayPriceIndex,
  priceSeries,
  validateIndex
} = require("./mtgjsonPrices.js");
const { chooseRichestIndex, collectPrintingCandidates, readCachedSet } = require("./scripts/build-mtgjson-price-index.js");

function sampleIndex() {
  return {
    format: "arcana-cube-mtgjson-prices",
    version: 2,
    providers: ["tcgplayer", "manapool", "cardkingdom", "cardmarket"],
    source: { date: "2026-07-28" },
    cards: {
      printing: {
        uuid: "mtgjson-printing",
        foil: [
          ["2026-07-27", 3.25, 1],
          ["2026-07-28", 3.5, 0]
        ],
        nonfoil: [["2026-07-28", 1.25, 2]]
      }
    },
    printingPrices: {
      alternative: {
        uuid: "mtgjson-alternative",
        oracleId: "oracle",
        set: "TST",
        collectorNumber: "2",
        name: "Card",
        foil: [["2026-07-28", 8.75, 1]],
        nonfoil: []
      }
    }
  };
}

test("Cube price fingerprints are stable by printing set and change with selected versions", () => {
  const first = cubeFingerprint([{ scryfallId: "b" }, { scryfallId: "a" }, { scryfallId: "a" }]);
  assert.equal(first, cubeFingerprint([{ scryfallId: "a" }, { scryfallId: "b" }]));
  assert.notEqual(first, cubeFingerprint([{ scryfallId: "a" }, { scryfallId: "c" }]));
});

test("price builds ignore an empty local cache when a richer bundled index exists", () => {
  const empty = sampleIndex();
  empty.generatedAt = "2026-07-31T00:00:00.000Z";
  empty.cards = {};
  empty.printingPrices = {};
  const rich = sampleIndex();
  rich.generatedAt = "2026-07-28T00:00:00.000Z";
  assert.strictEqual(chooseRichestIndex([empty, rich]), rich);
});

test("selectable printings reuse a stable catalog and refresh it after seven days", async (t) => {
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-printings-"));
  t.after(() => fsp.rm(cacheDir, { recursive: true, force: true }));
  const oracleId = "4457ed35-7c10-48c8-9776-456485fdf070";
  const cubeCards = [{ scryfallId: "current", oracleId, set: "TST", collectorNumber: "1", name: "Card" }];
  const existingIndex = {
    printingOracleIds: [oracleId],
    printingPrices: {
      old: { scryfallId: "old", oracleId, set: "OLD", collectorNumber: "2", name: "Card" }
    }
  };
  let discoveryCalls = 0;
  const first = await collectPrintingCandidates(cubeCards, existingIndex, cacheDir, {
    now: new Date("2026-07-01T00:00:00Z"),
    fetchOraclePrintings: async (ids) => {
      discoveryCalls += 1;
      assert.deepEqual(ids, [oracleId]);
      return [{ id: "new", oracle_id: oracleId, set: "new", collector_number: "3", name: "Card" }];
    }
  });
  assert.equal(discoveryCalls, 1);
  assert.deepEqual(first.candidates.map((card) => card.scryfallId).sort(), ["current", "new", "old"]);

  await collectPrintingCandidates(cubeCards, existingIndex, cacheDir, {
    now: new Date("2026-07-02T00:00:00Z"),
    fetchOraclePrintings: async () => {
      throw new Error("fresh stable cache should cover this Oracle ID");
    }
  });
  await collectPrintingCandidates(cubeCards, existingIndex, cacheDir, {
    now: new Date("2026-07-09T00:00:00Z"),
    fetchOraclePrintings: async (ids) => {
      discoveryCalls += 1;
      assert.deepEqual(ids, [oracleId]);
      return [];
    }
  });
  assert.equal(discoveryCalls, 2);
});

test("set metadata cache fetches once within the current data version", async (t) => {
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "arcana-set-"));
  t.after(() => fsp.rm(cacheDir, { recursive: true, force: true }));
  let calls = 0;
  const loadSet = async (url) => {
    calls += 1;
    assert.match(url, /TST\.json$/);
    return { data: { cards: [{ uuid: "printing" }] } };
  };
  assert.equal((await readCachedSet("TST", cacheDir, loadSet)).data.cards[0].uuid, "printing");
  assert.equal((await readCachedSet("TST", cacheDir, loadSet)).data.cards[0].uuid, "printing");
  assert.equal(calls, 1);
});

test("MTGJSON price series uses USD providers before converted Cardmarket EUR", () => {
  const entry = {
    paper: {
      tcgplayer: { currency: "USD", retail: { foil: { "2026-07-28": 4.25 } } },
      manapool: { currency: "USD", retail: { foil: { "2026-07-27": 3.1, "2026-07-28": 3.9 } } },
      cardkingdom: { currency: "USD", retail: { foil: { "2026-07-26": 5.5 } } },
      cardmarket: { currency: "EUR", retail: { foil: { "2026-07-25": 2.5 } } }
    }
  };
  const rates = {
    "2026-07-24": 1.17,
    "2026-07-27": 1.18,
    "2026-07-28": 1.19
  };
  assert.deepEqual(buildPriceSeries(entry, "foil", undefined, rates), [
    ["2026-07-25", 2.93, 3, 1.17, "2026-07-24"],
    ["2026-07-26", 5.5, 2],
    ["2026-07-27", 3.1, 1],
    ["2026-07-28", 4.25, 0]
  ]);
});

test("Foil prices use etched data only when traditional Foil is unavailable", () => {
  const entry = {
    paper: {
      tcgplayer: { currency: "USD", retail: { etched: { "2026-07-27": 14.05, "2026-07-28": 14.93 } } },
      manapool: { currency: "USD", retail: { foil: { "2026-07-28": 12.5 } } },
      cardmarket: { currency: "EUR", retail: { etched: { "2026-07-26": 7.21 } } }
    }
  };
  assert.deepEqual(buildPriceSeries(entry, "foil", undefined, { "2026-07-24": 1.1485 }), [
    ["2026-07-26", 8.28, 3, 1.1485, "2026-07-24"],
    ["2026-07-27", 14.05, 0],
    ["2026-07-28", 12.5, 1]
  ]);
  assert.deepEqual(buildPriceSeries(entry, "nonfoil", undefined, { "2026-07-24": 1.1485 }), []);
});

test("Cardmarket conversion uses the closest previous ECB business-day rate", () => {
  const entry = {
    paper: {
      cardmarket: {
        currency: "EUR",
        retail: { normal: { "2026-07-26": 10 } }
      }
    }
  };
  assert.deepEqual(buildPriceSeries(entry, "nonfoil", undefined, {
    "2026-07-24": 1.1377,
    "2026-07-27": 1.1389
  }), [["2026-07-26", 11.38, 3, 1.1377, "2026-07-24"]]);
});

test("price index lookup keeps finish and provider metadata", () => {
  const index = sampleIndex();
  assert.equal(validateIndex(index), true);
  assert.deepEqual(lookupPrice(index, { scryfallId: "printing" }, "foil"), {
    date: "2026-07-28",
    usd: 3.5,
    provider: "tcgplayer",
    providerIndex: 0,
    origin: "mtgjson",
    currency: "USD"
  });
  assert.deepEqual(priceSeries(index, { scryfallId: "printing" }, "nonfoil"), [{
    date: "2026-07-28",
    usd: 1.25,
    provider: "cardkingdom",
    providerIndex: 2,
    origin: "mtgjson",
    currency: "USD"
  }]);
});

test("Cardmarket lookup exposes EUR conversion metadata", () => {
  const index = sampleIndex();
  index.cards.printing.foil = [["2026-07-28", 7.09, 3, 1.1367, "2026-07-28"]];
  assert.deepEqual(lookupPrice(index, { scryfallId: "printing" }, "foil"), {
    date: "2026-07-28",
    usd: 7.09,
    provider: "cardmarket",
    providerIndex: 3,
    origin: "mtgjson",
    currency: "USD",
    convertedFrom: "EUR",
    exchangeRate: 1.1367,
    exchangeRateDate: "2026-07-28"
  });
});

test("current lookup uses the latest available price on or before the index date", () => {
  const index = sampleIndex();
  index.source.date = "2026-07-29";
  assert.equal(lookupPrice(index, { scryfallId: "printing" }, "foil").date, "2026-07-28");
});

test("selectable printing lookup uses the lightweight MTGJSON version index", () => {
  const index = sampleIndex();
  const price = lookupPrintingPrice(index, { id: "alternative" }, "foil");
  assert.deepEqual(price, {
    date: "2026-07-28",
    usd: 8.75,
    provider: "manapool",
    providerIndex: 1,
    origin: "mtgjson",
    currency: "USD"
  });
  assert.equal(lookupPrintingPrice(index, { id: "alternative" }, "nonfoil"), null);
  assert.equal(lookupPrice(index, { scryfallId: "alternative" }, "foil").usd, 8.75);
  assert.equal(hasHistoricalEntry(index, { scryfallId: "alternative" }), false);
  assert.equal(hasHistoricalEntry(index, { scryfallId: "printing" }), true);
  assert.equal(hasHistoricalEntry(index, { scryfallId: "printing", finish: "nonfoil" }), false);
});

test("historical entries require more than one valid point for the selected finish", () => {
  const index = sampleIndex();
  index.cards.latestOnly = {
    uuid: "mtgjson-latest-only",
    foil: [["2026-07-28", 4.5, 0]],
    nonfoil: [["2026-07-27", 3.1, 1], ["2026-07-28", 3.25, 0]]
  };
  assert.equal(hasHistoricalEntry(index, { scryfallId: "latestOnly", finish: "foil" }), false);
  assert.equal(hasHistoricalEntry(index, { scryfallId: "latestOnly", finish: "nonfoil" }), true);
});

test("supplemental history replaces latest-only printing fallbacks", () => {
  const base = sampleIndex();
  const supplemental = {
    format: base.format,
    version: base.version,
    providers: base.providers,
    source: { date: "2026-07-28", historyFrom: "2026-04-29", historyTo: "2026-07-28" },
    cards: {
      alternative: {
        uuid: "mtgjson-alternative",
        foil: [["2026-04-29", 20.31, 1], ["2026-07-28", 17.37, 1]],
        nonfoil: []
      }
    }
  };
  const merged = mergePriceIndexes(base, supplemental);
  assert.equal(hasHistoricalEntry(merged, { scryfallId: "alternative" }), true);
  assert.deepEqual(priceSeries(merged, { scryfallId: "alternative" }, "foil").map((point) => point.usd), [20.31, 17.37]);
  assert.equal(merged.source.historyFrom, "2026-04-29");
});

test("series merging replaces the same date and ignores malformed points", () => {
  assert.deepEqual(mergeSeries(
    [["2026-07-27", 1, 0], ["bad", 2, 0]],
    [["2026-07-27", 1.5, 1], ["2026-07-28", 2, 0]]
  ), [
    ["2026-07-27", 1.5, 1],
    ["2026-07-28", 2, 0]
  ]);
});

test("runtime price overlays retain the complete selectable printing catalog", () => {
  const bundled = sampleIndex();
  bundled.printingOracleIds = ["oracle", "bundled-oracle"];
  bundled.printingPrices.bundled = { foil: [["2026-07-28", 4, 0]], nonfoil: [] };
  const local = sampleIndex();
  local.source = { date: "2026-07-30", cubeFingerprint: "current" };
  local.cards.current = { foil: [["2026-07-30", 9, 0]], nonfoil: [] };
  local.cards.printing = { uuid: "mtgjson-printing", foil: [["2026-07-30", 5.25, 0]], nonfoil: [] };
  local.printingOracleIds = ["oracle", "local-oracle"];
  local.printingPrices.printing = { foil: [["2026-07-30", 5, 0]], nonfoil: [] };
  const merged = overlayPriceIndex(bundled, local);
  assert.equal(merged.source.date, "2026-07-30");
  assert.equal(merged.printingPrices.bundled.foil[0][1], 4);
  assert.equal(merged.printingPrices.printing.foil[0][1], 5);
  assert.equal(merged.cards.current.foil[0][1], 9);
  assert.deepEqual(merged.cards.printing.foil.map((point) => point[0]), ["2026-07-27", "2026-07-28", "2026-07-30"]);
  assert.equal(hasHistoricalEntry(merged, { scryfallId: "printing", finish: "foil" }), true);
  assert.deepEqual(merged.printingOracleIds, ["oracle", "bundled-oracle", "local-oracle"]);
});

test("price catalog falls back to the local script index and caches it", async () => {
  let fallbackCalls = 0;
  const catalog = createMtgjsonPriceCatalog({
    fetchImpl: async () => { throw new Error("file origin"); },
    loadFallback: async () => {
      fallbackCalls += 1;
      return sampleIndex();
    }
  });
  const first = await catalog.lookup({ scryfallId: "printing", finish: "foil" });
  const second = await catalog.lookup({ scryfallId: "printing", finish: "foil" });
  assert.equal(first.price.usd, 3.5);
  assert.equal(second.source.date, "2026-07-28");
  assert.equal(fallbackCalls, 1);
});

test("price catalog accepts a freshly rebuilt local index", async () => {
  const catalog = createMtgjsonPriceCatalog({
    fetchImpl: async () => { throw new Error("bundled index should not load"); },
    loadFallback: async () => { throw new Error("fallback should not load"); }
  });
  const index = sampleIndex();
  index.source.date = "2026-07-29";
  await catalog.setIndex(index);
  assert.equal((await catalog.loadIndex()).source.date, "2026-07-29");
  assert.equal((await catalog.lookup({ scryfallId: "printing", finish: "foil" })).price.usd, 3.5);
});

test("generated local-file script assigns a validated index", () => {
  const script = buildIndexScript(sampleIndex());
  assert.match(script, /CubeMtgjsonPriceIndex/);
  assert.match(script, /arcana-cube-mtgjson-prices/);
});
