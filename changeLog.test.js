const test = require("node:test");
const assert = require("node:assert/strict");
const { appendChange, emptyChangeLog, latestEntries, normalizeChangeLog, parseChangeLogData, wrapChangeLogData } = require("./changeLog.js");

test("appendChange prepends normalized entries and caps history", () => {
  const first = appendChange(emptyChangeLog(), { type: "card.added", summary: "Added A" }, { now: new Date("2026-07-09T01:00:00Z") });
  const second = appendChange(first, { type: "card.removed", summary: "Removed B" }, { now: new Date("2026-07-09T02:00:00Z"), limit: 1 });
  assert.equal(second.entries.length, 1);
  assert.equal(second.entries[0].type, "card.removed");
  assert.equal(second.updatedAt, "2026-07-09T02:00:00.000Z");
});

test("normalizeChangeLog sorts latest entries first", () => {
  const log = normalizeChangeLog({
    entries: [
      { id: "old", time: "2026-07-08T00:00:00.000Z", type: "a", summary: "old" },
      { id: "new", time: "2026-07-09T00:00:00.000Z", type: "b", summary: "new" }
    ]
  });
  assert.deepEqual(latestEntries(log).map((entry) => entry.id), ["new", "old"]);
});

test("change log files wrap and parse round-trip data", () => {
  const log = appendChange(emptyChangeLog(), {
    type: "card.versionChanged",
    summary: "Changed version",
    card: { name: "Lightning Bolt" },
    before: { set: "2X2" },
    after: { set: "CLU" }
  }, { now: new Date("2026-07-09T00:00:00Z") });
  const wrapped = wrapChangeLogData(log);
  assert.equal(wrapped.format, "arcana-cube-change-log");
  assert.deepEqual(parseChangeLogData(JSON.stringify(wrapped)), log);
  assert.deepEqual(parseChangeLogData(JSON.stringify(log)), log);
});
