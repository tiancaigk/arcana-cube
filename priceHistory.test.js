const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPriceTrendIndex, cardPriceKey, cardSeries, dailyPriceChanges, dateKey, emptyPriceHistory, hasDailySnapshot, normalizePriceHistory, parsePriceHistoryData, priceChangesForPeriod, priceTrend, recordDailySnapshot, syncPriceHistoryWindow, topPriceMovers, totalSeries, wrapPriceHistoryData } = require("./priceHistory.js");
const { buildCards, buildPriceHistory } = require("./testFixtures.js");

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

test("daily snapshots preserve price refresh quality metadata", () => {
  const history = recordDailySnapshot(emptyPriceHistory("cube-a"), [], {
    date: "2026-07-24",
    now: new Date("2026-07-24T08:00:00Z"),
    refresh: { checked: 12, updated: 10, missing: 2 }
  });
  assert.equal(history.cubeId, "cube-a");
  assert.deepEqual(history.snapshots["2026-07-24"].refresh, { checked: 12, updated: 10, missing: 2 });
  assert.deepEqual(normalizePriceHistory(history).snapshots["2026-07-24"].refresh, { checked: 12, updated: 10, missing: 2 });
});

test("hasDailySnapshot distinguishes recorded and missing calendar days", () => {
  const history = recordDailySnapshot(emptyPriceHistory(), [], { date: "2026-07-22" });
  assert.equal(hasDailySnapshot(history, "2026-07-22"), true);
  assert.equal(hasDailySnapshot(history, "2026-07-21"), false);
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

test("priceTrend compares the latest two history points", () => {
  assert.deepEqual(priceTrend([
    { date: "2026-07-01", usd: 10 },
    { date: "2026-07-02", usd: 12.5 }
  ]), {
    direction: "up",
    delta: 2.5,
    previousUsd: 10,
    latestUsd: 12.5,
    previousDate: "2026-07-01",
    latestDate: "2026-07-02",
    percent: 25
  });
  assert.equal(priceTrend([
    { date: "2026-07-01", usd: 10 },
    { date: "2026-07-02", usd: 10 }
  ]), null);
  assert.equal(priceTrend([{ date: "2026-07-01", usd: 10 }]), null);
  assert.equal(priceTrend([
    { date: "2026-07-01", usd: 10 },
    { date: "2026-07-02", usd: 9.25 }
  ]).direction, "down");
});

test("dailyPriceChanges compares a target date with the previous snapshot", () => {
  const bolt = { id: "1", name: "Lightning Bolt", scryfallId: "bolt", finish: "foil" };
  const lotus = { id: "2", name: "Black Lotus", scryfallId: "lotus", finish: "nonfoil" };
  const unchanged = { id: "3", name: "Sol Ring", scryfallId: "ring", finish: "foil" };
  const history = normalizePriceHistory({
    snapshots: {
      "2026-07-01": { cards: { [cardPriceKey(bolt)]: 10, [cardPriceKey(lotus)]: 100, [cardPriceKey(unchanged)]: 2 } },
      "2026-07-09": { cards: { [cardPriceKey(bolt)]: 12.5, [cardPriceKey(lotus)]: 96, [cardPriceKey(unchanged)]: 2 } }
    }
  });
  assert.deepEqual(dailyPriceChanges(history, [bolt, lotus, unchanged], "2026-07-09").map((change) => ({
    name: change.card.name,
    direction: change.direction,
    delta: change.delta,
    percent: change.percent,
    previousUsd: change.previousUsd,
    latestUsd: change.latestUsd
  })), [
    { name: "Black Lotus", direction: "down", delta: -4, percent: -4, previousUsd: 100, latestUsd: 96 },
    { name: "Lightning Bolt", direction: "up", delta: 2.5, percent: 25, previousUsd: 10, latestUsd: 12.5 }
  ]);
});

test("price change periods use calendar week, month, and complete history boundaries", () => {
  const card = { id: "1", name: "Lightning Bolt", scryfallId: "bolt", finish: "foil" };
  const key = cardPriceKey(card);
  const history = normalizePriceHistory({
    snapshots: {
      "2026-06-01": { cards: { [key]: 10 } },
      "2026-07-01": { cards: { [key]: 11 } },
      "2026-07-27": { cards: { [key]: 12 } },
      "2026-07-28": { cards: { [key]: 13 } },
      "2026-07-29": { cards: { [key]: 15 } }
    }
  });
  assert.deepEqual(["today", "week", "month", "history"].map((period) => {
    const result = priceChangesForPeriod(history, [card], period, "2026-07-29");
    return [period, result.previousDate, result.latestDate, result.changes[0].delta];
  }), [
    ["today", "2026-07-28", "2026-07-29", 2],
    ["week", "2026-07-27", "2026-07-29", 3],
    ["month", "2026-07-01", "2026-07-29", 4],
    ["history", "2026-06-01", "2026-07-29", 5]
  ]);
});

test("top price movers ranks percentage magnitude and limits each direction", () => {
  const changes = Array.from({ length: 25 }, (_, index) => ({
    card: { name: `Up ${index}` },
    direction: "up",
    delta: index + 1,
    percent: index + 1
  })).concat(Array.from({ length: 25 }, (_, index) => ({
    card: { name: `Down ${index}` },
    direction: "down",
    delta: -(index + 1),
    percent: -(index + 1)
  })));
  const increases = topPriceMovers(changes, "up", 20);
  const decreases = topPriceMovers(changes, "down", 20);
  assert.equal(increases.length, 20);
  assert.equal(decreases.length, 20);
  assert.equal(increases[0].percent, 25);
  assert.equal(increases.at(-1).percent, 6);
  assert.equal(decreases[0].percent, -25);
  assert.equal(decreases.at(-1).percent, -6);
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

test("price trend index matches per-card series across long history", () => {
  const cards = buildCards(600);
  const history = buildPriceHistory(cards, 180);
  const index = buildPriceTrendIndex(history);
  cards.filter((_card, cardIndex) => cardIndex % 75 === 0).forEach((card) => {
    assert.deepEqual(index.byKey.get(cardPriceKey(card, card.finish)) || null, priceTrend(cardSeries(history, card, card.finish)));
  });
  assert.deepEqual(index.totalSeries, totalSeries(history));
  assert.deepEqual(index.totalTrend, priceTrend(totalSeries(history)));
});

test("MTGJSON sync replaces source dates in the latest 90-day window", () => {
  const card = {
    scryfallId: "printing",
    finish: "foil",
    priceSources: { foil: { origin: "mtgjson", provider: "tcgplayer" } },
    prices: { usdFoil: "4.00" }
  };
  const existing = normalizePriceHistory({
    snapshots: {
      "2026-05-01": { cards: { "printing|foil": 1 }, totalUsd: 1 },
      "2026-05-02": { cards: { "printing|foil": 4, "old-card|foil": 100 }, totalUsd: 104 },
      "2026-06-01": { cards: { "printing|foil": 6 }, totalUsd: 6 }
    }
  });
  const result = syncPriceHistoryWindow(existing, [card], () => [
    { date: "2026-05-01", usd: 2, provider: "tcgplayer" },
    { date: "2026-05-02", usd: 9, provider: "manapool" },
    { date: "2026-07-30", usd: 11, provider: "cardmarket" }
  ], {
    endDate: "2026-07-30",
    windowDays: 90,
    now: new Date("2026-07-30T12:00:00Z")
  });
  assert.equal(result.cutoffDate, "2026-05-02");
  assert.equal(result.syncedSnapshots, 2);
  assert.equal(result.pricePoints, 2);
  assert.equal(result.replacedSnapshots, 1);
  assert.equal(result.createdSnapshots, 1);
  assert.equal(result.removedLocalPoints, 1);
  assert.deepEqual(cardSeries(result.history, card), [
    { date: "2026-05-01", usd: 1 },
    { date: "2026-05-02", usd: 9 },
    { date: "2026-06-01", usd: 6 },
    { date: "2026-07-30", usd: 11 }
  ]);
  assert.deepEqual(result.history.snapshots["2026-05-01"], existing.snapshots["2026-05-01"]);
  assert.deepEqual(result.history.snapshots["2026-06-01"], existing.snapshots["2026-06-01"]);
  assert.deepEqual(result.history.snapshots["2026-05-02"].cards, { "printing|foil": 9 });
  assert.equal(result.history.snapshots["2026-05-02"].totalUsd, 9);
  assert.deepEqual(result.history.snapshots["2026-05-02"].sync, {
    origin: "mtgjson",
    mode: "replace",
    windowDays: 90,
    providers: { manapool: 1 }
  });
});

test("price history normalization preserves refresh fallback and compact source summaries", () => {
  const history = normalizePriceHistory({
    snapshots: {
      "2026-07-01": {
        cards: { "card|foil": 2 },
        refresh: { checked: 2, updated: 1, missing: 1, fallback: 1 },
        sourceSummary: { "mtgjson:tcgplayer": 1, ignored: 0 },
        sync: { origin: "mtgjson", mode: "replace", windowDays: 90, providers: { tcgplayer: 1 } }
      }
    }
  });
  assert.deepEqual(history.snapshots["2026-07-01"].refresh, {
    checked: 2,
    updated: 1,
    missing: 1,
    fallback: 1
  });
  assert.deepEqual(history.snapshots["2026-07-01"].sourceSummary, { "mtgjson:tcgplayer": 1 });
  assert.deepEqual(history.snapshots["2026-07-01"].sync, {
    origin: "mtgjson",
    mode: "replace",
    windowDays: 90,
    providers: { tcgplayer: 1 }
  });
});
