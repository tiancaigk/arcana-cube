const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCards, buildPriceHistory } = require("./testFixtures.js");

test("large Cube fixtures are deterministic and contain all display buckets", () => {
  const first = buildCards(600);
  const second = buildCards(600);
  assert.deepEqual(first, second);
  assert.equal(first.length, 600);
  assert.equal(new Set(first.map((card) => card.id)).size, 600);
  assert.deepEqual(new Set(first.map((card) => card.bucket)), new Set(["W", "U", "B", "R", "G", "C", "M", "L"]));
});

test("price fixture creates one complete snapshot per requested day", () => {
  const cards = buildCards(600);
  const history = buildPriceHistory(cards, 180);
  const dates = Object.keys(history.snapshots);
  assert.equal(dates.length, 180);
  assert.equal(dates[0], "2025-01-01");
  assert.equal(dates[179], "2025-06-29");
  assert.equal(Object.keys(history.snapshots[dates[0]].cards).length, 600);
  assert.equal(history.snapshots[dates[0]].cardCount, 600);
});
