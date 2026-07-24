const test = require("node:test");
const assert = require("node:assert/strict");
const { datePositions } = require("./chart.js");

test("price chart positions reflect real gaps between calendar dates", () => {
  const positions = datePositions([
    { date: "2026-07-01" },
    { date: "2026-07-02" },
    { date: "2026-07-11" }
  ], 0, 100);
  assert.deepEqual(positions.map((value) => Math.round(value)), [0, 10, 100]);
});

test("price chart falls back to even spacing for invalid dates", () => {
  assert.deepEqual(datePositions([{ date: "unknown" }, { date: "later" }], 10, 30), [10, 30]);
  assert.deepEqual(datePositions([{ date: "2026-07-01" }], 10, 30), [20]);
});
