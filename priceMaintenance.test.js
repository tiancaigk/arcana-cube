const test = require("node:test");
const assert = require("node:assert/strict");
const { applyIndexedPriceUpdates, applyPriceUpdates } = require("./priceMaintenance.js");

test("price maintenance reports updated, missing, and skipped cards separately", () => {
  const cards = [
    { id: "a", set: "lea", collectorNumber: "1", scryfallId: "a" },
    { id: "b", set: "lea", collectorNumber: "2", scryfallId: "b" },
    { id: "c", set: "lea", collectorNumber: "3", scryfallId: "old" }
  ];
  const printings = new Map([
    ["lea:1", { id: "a", set: "lea", collector_number: "1" }],
    ["lea:3", { id: "new", set: "lea", collector_number: "3" }]
  ]);
  const result = applyPriceUpdates(cards, printings, {
    printingKey: (set, number) => `${set}:${number}`,
    findCardLocation: (id) => {
      const index = cards.findIndex((card) => card.id === id);
      return index >= 0 ? { cards, index } : null;
    },
    replacePrinting: (card) => ({ ...card, refreshed: true }),
    needsPriceRefresh: () => true,
    force: true
  });
  assert.deepEqual(result, { checked: 3, matched: 2, updated: 2, missing: 1, skipped: 0 });
  assert.equal(cards[0].refreshed, true);
  assert.equal(cards[2].refreshed, true);
});

test("MTGJSON price maintenance applies provider fallbacks without clearing missing finishes", () => {
  const cards = [{
    id: "card",
    scryfallId: "printing",
    set: "TST",
    collectorNumber: "1",
    finish: "foil",
    prices: { usd: "1.00", usdFoil: "2.00" },
    priceUpdatedAt: ""
  }];
  const index = { source: { date: "2026-07-28" } };
  const result = applyIndexedPriceUpdates(cards, index, {
    lookupPrice: (_index, _card, finish) => finish === "foil"
      ? {
        date: "2026-07-28",
        usd: 3.5,
        provider: "cardmarket",
        providerIndex: 3,
        convertedFrom: "EUR",
        exchangeRate: 1.1367,
        exchangeRateDate: "2026-07-28"
      }
      : null,
    findCardLocation: () => ({ cards, index: 0 }),
    needsPriceRefresh: () => true,
    now: new Date("2026-07-29T00:00:00Z")
  });
  assert.deepEqual(result, {
    checked: 1,
    matched: 1,
    updated: 1,
    missing: 0,
    skipped: 0,
    fallback: 1,
    converted: 1,
    unresolvedIds: [],
    updatedIds: ["card"]
  });
  assert.deepEqual(cards[0].prices, { usd: "1.00", usdFoil: "3.50" });
  assert.equal(cards[0].priceSources.foil.provider, "cardmarket");
  assert.equal(cards[0].priceSources.foil.convertedFrom, "EUR");
  assert.equal(cards[0].priceSources.foil.exchangeRate, 1.1367);
  assert.equal(cards[0].priceSources.foil.exchangeRateDate, "2026-07-28");
  assert.equal(cards[0].priceDataDate, "2026-07-28");
});
