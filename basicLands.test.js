const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");
const catalog = require("./catalog.js");
const { classifyBasicLandBatch, groupBasicLands, parseCollectorNumberRange, sortBasicLands } = require("./basicLands.js");

test("basic land groups keep kind order and interleave land kinds within sets", () => {
  const cards = [
    { name: "Plains", set: "FDN", setName: "Foundations", collectorNumber: "10", releasedAt: "2024-11-15" },
    { name: "Forest", set: "FDN", setName: "Foundations", collectorNumber: "2", releasedAt: "2024-11-15" },
    { name: "Island", set: "ONE", setName: "Phyrexia", collectorNumber: "263", releasedAt: "2023-02-10" }
  ];
  assert.deepEqual(groupBasicLands(cards, "kind").map((group) => group.key), ["Plains", "Island", "Swamp", "Mountain", "Forest"]);
  const sets = groupBasicLands(cards, "set");
  assert.deepEqual(sets.map((group) => group.key), ["FDN", "ONE"]);
  assert.deepEqual(sets[0].cards.map((card) => card.collectorNumber), ["10", "2"]);
});

test("stored basic lands sort by set and interleave WUBRG variants by collector order", () => {
  const cards = [
    { name: "Forest", set: "NEW", collectorNumber: "10", releasedAt: "2026-01-01" },
    { name: "Mountain", set: "NEW", collectorNumber: "8", releasedAt: "2026-01-01" },
    { name: "Plains", set: "NEW", collectorNumber: "2", releasedAt: "2026-01-01" },
    { name: "Island", set: "NEW", collectorNumber: "4", releasedAt: "2026-01-01" },
    { name: "Swamp", set: "NEW", collectorNumber: "6", releasedAt: "2026-01-01" },
    { name: "Forest", set: "NEW", collectorNumber: "9", releasedAt: "2026-01-01" },
    { name: "Mountain", set: "NEW", collectorNumber: "7", releasedAt: "2026-01-01" },
    { name: "Plains", set: "NEW", collectorNumber: "1", releasedAt: "2026-01-01" },
    { name: "Island", set: "NEW", collectorNumber: "3", releasedAt: "2026-01-01" },
    { name: "Swamp", set: "NEW", collectorNumber: "5", releasedAt: "2026-01-01" },
    { name: "Plains", set: "OLD", collectorNumber: "1", releasedAt: "2025-01-01" }
  ];
  const sorted = sortBasicLands(cards);
  assert.deepEqual(sorted.slice(0, 10).map((card) => card.name), ["Plains", "Island", "Swamp", "Mountain", "Forest", "Plains", "Island", "Swamp", "Mountain", "Forest"]);
  assert.deepEqual(sorted.slice(0, 10).map((card) => card.collectorNumber), ["1", "3", "5", "7", "9", "2", "4", "6", "8", "10"]);
  assert.equal(sorted[10].set, "OLD");
  assert.notStrictEqual(sorted, cards);
});

test("collector range parsing preserves literals and limits numeric ranges", () => {
  assert.deepEqual(parseCollectorNumberRange("126★"), { isRange: false, numbers: ["126★"] });
  assert.deepEqual(parseCollectorNumberRange("112-115").numbers, ["112", "113", "114", "115"]);
  assert.throws(() => parseCollectorNumberRange("126★-130"), /纯数字/);
  assert.throws(() => parseCollectorNumberRange("115-112"), /起始编号不能大于结束编号/);
  assert.throws(() => parseCollectorNumberRange("1-101"), /最多 100 张/);
});

test("basic land set groups put undated and unknown sets last", () => {
  const groups = groupBasicLands([
    { name: "Island", set: "OLD", setName: "Old Set", collectorNumber: "2" },
    { name: "Plains", collectorNumber: "1" },
    { name: "Swamp", set: "NEW", setName: "New Set", collectorNumber: "3", releasedAt: "2025-01-01" }
  ], "set");
  assert.deepEqual(groups.map((group) => group.key), ["NEW", "OLD", "UNKNOWN"]);
  assert.equal(groups[2].label, "未知系列");
});

test("basic land batch classification reports partial success without mutation", () => {
  const targets = ["1", "2", "3", "4", "5"].map((collectorNumber) => ({ setCode: "TST", collectorNumber }));
  const cardsByPrinting = new Map([
    [catalog.printingKey("TST", "1"), { id: "plains", name: "Plains", games: ["paper"], digital: false }],
    [catalog.printingKey("TST", "3"), { id: "spell", name: "Lightning Bolt", games: ["paper"], digital: false }],
    [catalog.printingKey("TST", "4"), { id: "island", name: "Island", games: ["arena"], digital: true }],
    [catalog.printingKey("TST", "5"), { id: "owned", name: "Forest", games: ["paper"], digital: false }]
  ]);
  const existing = [{ scryfallId: "owned" }];
  const result = classifyBasicLandBatch(targets, cardsByPrinting, existing);
  assert.deepEqual(result.counts, { added: 1, missing: 1, unsupported: 1, digital: 1, duplicate: 1 });
  assert.deepEqual(result.accepted.map((card) => card.id), ["plains"]);
  assert.deepEqual(result.items.map((item) => item.status), ["added", "missing", "unsupported", "digital", "duplicate"]);
  assert.equal(existing.length, 1);
});
