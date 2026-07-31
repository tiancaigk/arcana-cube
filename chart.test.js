const test = require("node:test");
const assert = require("node:assert/strict");
const { dateLabelIndexes, datePositions, splitDateSeries } = require("./chart.js");

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

test("price chart does not imply continuous data across long gaps", () => {
  const segments = splitDateSeries([
    { date: "2026-04-30", usd: 20.11 },
    { date: "2026-07-29", usd: 17.37 },
    { date: "2026-07-30", usd: 18.23 },
    { date: "2026-07-31", usd: 18.23 }
  ], 7);
  assert.deepEqual(segments.map((segment) => segment.map((point) => point.date)), [
    ["2026-04-30"],
    ["2026-07-29", "2026-07-30", "2026-07-31"]
  ]);
});

test("price chart date labels omit crowded interior dates", () => {
  assert.deepEqual(dateLabelIndexes([62, 565, 574, 582], 90), [0, 3]);
  assert.deepEqual(dateLabelIndexes([62, 320, 582], 90), [0, 1, 2]);
});
