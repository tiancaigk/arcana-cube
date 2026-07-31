const test = require("node:test");
const assert = require("node:assert/strict");
const { createPersistenceCoordinator } = require("./persistence.js");

function createTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    set(callback) { const id = nextId++; callbacks.set(id, callback); return id; },
    clear(id) { callbacks.delete(id); },
    runAll() {
      const queued = [...callbacks.values()];
      callbacks.clear();
      queued.forEach((callback) => callback());
    }
  };
}

function createHarness(overrides = {}) {
  const browserWrites = { cube: [], priceHistory: [], changeLog: [] };
  const directoryWrites = { cube: [], priceHistory: [], changeLog: [] };
  const timers = createTimers();
  const handle = { name: "Cube" };
  const coordinator = createPersistenceCoordinator({
    browserWriters: Object.fromEntries(Object.keys(browserWrites).map((domain) => [domain, (snapshot) => browserWrites[domain].push(snapshot)])),
    directoryWriters: Object.fromEntries(Object.keys(directoryWrites).map((domain) => [domain, async (_handle, snapshot) => { directoryWrites[domain].push(snapshot); }])),
    getDirectoryHandle: () => handle,
    setTimer: timers.set,
    clearTimer: timers.clear,
    queueTask: (callback) => queueMicrotask(callback),
    ...overrides
  });
  return { coordinator, browserWrites, directoryWrites, timers, handle };
}

test("persistence writes only the marked domain", async () => {
  const { coordinator, browserWrites, directoryWrites } = createHarness();
  coordinator.markDirty("cube", { revision: 1 });
  await coordinator.flush();
  assert.deepEqual(browserWrites.cube, [{ revision: 1 }]);
  assert.deepEqual(directoryWrites.cube, [{ revision: 1 }]);
  assert.deepEqual(browserWrites.priceHistory, []);
  assert.deepEqual(directoryWrites.changeLog, []);
  assert.equal(coordinator.hasDirty(), false);
});

test("twenty scheduled Cube changes coalesce without writing other domains", async () => {
  const { coordinator, browserWrites, directoryWrites, timers } = createHarness();
  for (let index = 0; index < 20; index += 1) coordinator.scheduleDirty("cube", { revision: index }, 400);
  assert.deepEqual(browserWrites.cube, []);
  timers.runAll();
  await coordinator.flush();
  assert.deepEqual(browserWrites.cube, [{ revision: 19 }]);
  assert.deepEqual(directoryWrites.cube, [{ revision: 19 }]);
  assert.deepEqual(directoryWrites.priceHistory, []);
  assert.deepEqual(directoryWrites.changeLog, []);
});

test("flushBrowserSync preserves a delayed browser snapshot without forcing directory IO", () => {
  const { coordinator, browserWrites, directoryWrites } = createHarness();
  coordinator.scheduleDirty("cube", { notes: "latest" }, 400);
  coordinator.flushBrowserSync();
  assert.deepEqual(browserWrites.cube, [{ notes: "latest" }]);
  assert.deepEqual(directoryWrites.cube, []);
  assert.equal(coordinator.hasDirty("cube"), true);
});

test("an explicit browser mirror failure is contained without scheduling directory IO", async () => {
  const failures = [];
  const { coordinator, directoryWrites } = createHarness({
    browserWriters: {
      cube: () => { throw new Error("quota exceeded"); },
      priceHistory: () => {},
      changeLog: () => {}
    },
    onBrowserError: (error, domain) => failures.push(`${domain}:${error.message}`)
  });
  assert.equal(coordinator.saveBrowser("cube", { revision: 1 }), false);
  await coordinator.flush();
  assert.deepEqual(failures, ["cube:quota exceeded"]);
  assert.deepEqual(directoryWrites.cube, []);
  assert.equal(coordinator.hasDirty(), false);
});

test("a failed directory write remains dirty and reports the failure", async () => {
  const failures = [];
  const { coordinator } = createHarness({
    directoryWriters: {
      cube: async () => { throw new Error("disk full"); },
      priceHistory: async () => {},
      changeLog: async () => {}
    },
    onDirectoryError: async (error, domain) => failures.push(`${domain}:${error.message}`)
  });
  coordinator.markDirty("cube", { revision: 1 });
  await coordinator.flush();
  assert.deepEqual(failures, ["cube:disk full"]);
  assert.equal(coordinator.hasDirty("cube"), true);
});

test("a newer snapshot queued during a write is persisted after the in-flight value", async () => {
  const writes = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const { coordinator } = createHarness({
    directoryWriters: {
      cube: async (_handle, snapshot) => {
        writes.push(snapshot.revision);
        if (snapshot.revision === 1) await firstGate;
      },
      priceHistory: async () => {},
      changeLog: async () => {}
    }
  });
  coordinator.markDirty("cube", { revision: 1 });
  await Promise.resolve();
  coordinator.markDirty("cube", { revision: 2 });
  releaseFirst();
  await coordinator.flush();
  assert.deepEqual(writes, [1, 2]);
  assert.equal(coordinator.hasDirty(), false);
});
