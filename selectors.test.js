const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");
const priceHistory = require("./priceHistory.js");
const { buildCards, buildPriceHistory } = require("./testFixtures.js");
const { createCubeSelectors } = require("./selectors.js");

test("card selectors cache by data revision and filter values", () => {
  const selectors = createCubeSelectors(core, priceHistory);
  const cards = buildCards(600);
  const filters = { query: "", color: "all", type: "all", finish: "all", japanPrint: "all" };
  const first = selectors.selectCards(cards, 1, filters);
  const second = selectors.selectCards(cards, 1, { ...filters });
  const changed = selectors.selectCards(cards, 2, filters);
  assert.equal(first, second);
  assert.notEqual(first, changed);
  assert.equal(first.cards.length, 600);
  assert.equal([...first.groups.values()].flat().length, 600);
});

test("statistics and card index invalidate only with data revision", () => {
  const selectors = createCubeSelectors(core, priceHistory);
  const cards = buildCards(600);
  assert.equal(selectors.selectStats(cards, 3), selectors.selectStats(cards, 3));
  assert.notEqual(selectors.selectStats(cards, 3), selectors.selectStats(cards, 4));
  assert.equal(selectors.cardById(cards, 4, cards[200].id), cards[200]);
  assert.equal(selectors.cardById(cards, 4, "missing"), null);
});

test("price view caches by history revision and provides indexed card trends", () => {
  const selectors = createCubeSelectors(core, priceHistory);
  const cards = buildCards(600);
  const history = buildPriceHistory(cards, 180);
  const first = selectors.selectPriceView(cards, 1, history, 1);
  const second = selectors.selectPriceView(cards, 1, history, 1);
  const historyChanged = selectors.selectPriceView(cards, 1, history, 2);
  assert.equal(first, second);
  assert.notEqual(first, historyChanged);
  assert.deepEqual(selectors.trendForCard(first, cards[20]), priceHistory.priceTrend(priceHistory.cardSeries(history, cards[20])));
  assert.equal(first.missingCount, 0);
  assert.ok(first.currentTotal > 0);
});

test("analytics selectors cache overall, single-dimension, and combined curves", () => {
  const selectors = createCubeSelectors(core, priceHistory);
  const cards = buildCards(600);
  const allScope = { color: "all", type: "all" };
  const whiteScope = { color: "W", type: "all" };
  const creatureScope = { color: "all", type: "Creature" };
  const whiteCreatureScope = { color: "W", type: "Creature" };
  const all = selectors.selectAnalytics(cards, 1, allScope);
  const white = selectors.selectAnalytics(cards, 1, whiteScope);
  const creatures = selectors.selectAnalytics(cards, 1, creatureScope);
  const whiteCreatures = selectors.selectAnalytics(cards, 1, whiteCreatureScope);
  assert.equal(all, selectors.selectAnalytics(cards, 1, { ...allScope }));
  assert.equal(creatures, selectors.selectAnalytics(cards, 1, { ...creatureScope }));
  assert.equal(whiteCreatures, selectors.selectAnalytics(cards, 1, { ...whiteCreatureScope }));
  assert.equal(all.cards.length, 600);
  assert.equal(white.cards.every((card) => core.getCardBucket(card) === "W"), true);
  assert.equal(creatures.cards.every((card) => core.getPrimaryType(core.getFrontTypeLine(card)) === "Creature"), true);
  assert.ok(whiteCreatures.cards.length > 0);
  assert.equal(whiteCreatures.cards.every((card) => core.getCardBucket(card) === "W" && core.getPrimaryType(core.getFrontTypeLine(card)) === "Creature"), true);
  assert.notEqual(all, white);
  assert.notEqual(all, creatures);
  assert.notEqual(whiteCreatures, white);
  assert.notEqual(whiteCreatures, creatures);
});
