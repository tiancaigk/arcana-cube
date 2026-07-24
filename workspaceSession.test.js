const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveWorkspaceDomains } = require("./workspaceSession.js");

const cube = { meta: { id: "cube-a", name: "A" }, cards: [] };
const emptyPriceHistory = () => ({ snapshots: {} });
const emptyChangeLog = () => ({ entries: [] });

test("workspace domains inherit one Cube identity without reusing unrelated browser data", () => {
  const resolved = resolveWorkspaceDomains({ cubeData: cube, priceHistoryData: null, changeLogData: null, emptyPriceHistory, emptyChangeLog });
  assert.equal(resolved.priceHistoryData.cubeId, "cube-a");
  assert.equal(resolved.changeLogData.cubeId, "cube-a");
  assert.deepEqual(resolved.needsWrite, { priceHistory: true, changeLog: true });
});

test("legacy auxiliary domains are attached to the loaded Cube", () => {
  const resolved = resolveWorkspaceDomains({
    cubeData: cube,
    priceHistoryData: { snapshots: { "2026-07-24": {} } },
    changeLogData: { entries: [{ id: "1" }] },
    emptyPriceHistory,
    emptyChangeLog
  });
  assert.equal(resolved.priceHistoryData.cubeId, "cube-a");
  assert.equal(resolved.changeLogData.cubeId, "cube-a");
  assert.deepEqual(resolved.needsWrite, { priceHistory: true, changeLog: true });
});

test("workspace loading rejects auxiliary data from another Cube", () => {
  assert.throws(() => resolveWorkspaceDomains({
    cubeData: cube,
    priceHistoryData: { cubeId: "cube-b", snapshots: {} },
    changeLogData: { cubeId: "cube-a", entries: [] },
    emptyPriceHistory,
    emptyChangeLog
  }), /另一个 Cube/);
});
