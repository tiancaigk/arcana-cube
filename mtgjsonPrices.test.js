const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildIndexScript,
  buildPriceSeries,
  createMtgjsonPriceCatalog,
  lookupPrice,
  lookupPrintingPrice,
  mergeSeries,
  priceSeries,
  validateIndex
} = require("./mtgjsonPrices.js");

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

test("generated local-file script assigns a validated index", () => {
  const script = buildIndexScript(sampleIndex());
  assert.match(script, /CubeMtgjsonPriceIndex/);
  assert.match(script, /arcana-cube-mtgjson-prices/);
});
