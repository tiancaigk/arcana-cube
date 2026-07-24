const test = require("node:test");
const assert = require("node:assert/strict");
const { applyPriceUpdates } = require("./priceMaintenance.js");

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
