const test = require("node:test");
const assert = require("node:assert/strict");
const { cardPriceKey, cardSeries, dateKey, emptyPriceHistory, normalizePriceHistory, parsePriceHistoryData, recordDailySnapshot, totalSeries, wrapPriceHistoryData } = require("./priceHistory.js");

test("dateKey formats local calendar dates", () => {
  assert.equal(dateKey(new Date(2026, 6, 2, 23, 59)), "2026-07-02");
});

test("recordDailySnapshot stores one replaceable snapshot per date", () => {
  const card = {
    scryfallId: "bolt-printing",
    finish: "foil",
    prices: { usd: "1.00", usdFoil: "5.55" }
  };
  const first = recordDailySnapshot(emptyPriceHistory(), [card], { date: "2026-07-02", now: new Date("2026-07-02T10:00:00Z") });
  const second = recordDailySnapshot(first, [{ ...card, prices: { usd: "1.00", usdFoil: "6.00" } }], { date: "2026-07-02", now: new Date("2026-07-02T12:00:00Z") });
  assert.deepEqual(Object.keys(second.snapshots), ["2026-07-02"]);
  assert.equal(second.snapshots["2026-07-02"].cards["bolt-printing|foil"], 6);
  assert.equal(second.snapshots["2026-07-02"].totalUsd, 6);
});

test("foil, nonfoil, and printing versions keep separate histories", () => {
  const history = recordDailySnapshot(emptyPriceHistory(), [
    { scryfallId: "version-a", finish: "foil", prices: { usd: "2.00", usdFoil: "10.00" } },
    { scryfallId: "version-a", finish: "nonfoil", prices: { usd: "2.00", usdFoil: "10.00" } },
    { scryfallId: "version-b", finish: "foil", prices: { usd: "3.00", usdFoil: "12.00" } }
  ], { date: "2026-07-02" });
  assert.equal(history.snapshots["2026-07-02"].cards["version-a|foil"], 10);
  assert.equal(history.snapshots["2026-07-02"].cards["version-a|nonfoil"], 2);
  assert.equal(history.snapshots["2026-07-02"].cards["version-b|foil"], 12);
  assert.deepEqual(cardSeries(history, { scryfallId: "version-a", finish: "foil" }), [{ date: "2026-07-02", usd: 10 }]);
});

test("totalSeries sorts snapshots and skips invalid entries", () => {
  const history = normalizePriceHistory({
    snapshots: {
      "2026-07-03": { totalUsd: "bad", cards: { "a|foil": "1.00" } },
      "2026-07-01": { totalUsd: "8.00", cards: {} },
      "ignored": { totalUsd: "10.00", cards: {} }
    }
  });
  assert.deepEqual(totalSeries(history), [
    { date: "2026-07-01", usd: 8 },
    { date: "2026-07-03", usd: 1 }
  ]);
});

test("price history files wrap and parse round-trip data", () => {
  const history = recordDailySnapshot(emptyPriceHistory(), [{ scryfallId: "card", finish: "foil", prices: { usdFoil: "1.25" } }], { date: "2026-07-02" });
  const wrapped = wrapPriceHistoryData(history);
  assert.equal(wrapped.format, "arcana-cube-price-history");
  assert.deepEqual(parsePriceHistoryData(JSON.stringify(wrapped)), history);
  assert.deepEqual(parsePriceHistoryData(JSON.stringify(history)), history);
});

test("cardPriceKey falls back to set and collector number when needed", () => {
  assert.equal(cardPriceKey({ set: "lea", collectorNumber: "126★", finish: "nonfoil" }), "LEA:126★|nonfoil");
});
