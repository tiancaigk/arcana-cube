const test = require("node:test");
const assert = require("node:assert/strict");
const { CURRENT_DATA_VERSION } = require("./migrations.js");
const { WORKSPACE_FORMAT, createHandleStore, createSerialWriteQueue, createStorage, isCubeData, parseWorkspaceData, wrapWorkspaceData } = require("./storage.js");

function memoryStorage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key, next) => { value = next; }, value: () => value };
}

test("storage falls back safely when saved data is missing or corrupt", () => {
  const fallback = { meta: { name: "Fallback" }, notes: "", cards: [] };
  const missing = createStorage(memoryStorage(), "cube").load(fallback);
  const corrupt = createStorage(memoryStorage("not-json"), "cube").load(fallback);
  assert.deepEqual(missing, fallback);
  assert.deepEqual(corrupt, fallback);
  assert.notEqual(missing, fallback);
});

test("storage validates and round-trips Cube data", () => {
  const memory = memoryStorage();
  const storage = createStorage(memory, "cube");
  const data = { meta: { name: "Saved" }, notes: "note", cards: [{ id: "1" }] };
  storage.save(data);
  assert.deepEqual(storage.load({}), data);
  assert.equal(isCubeData(data), true);
  assert.throws(() => storage.save({ cards: [] }), /无效/);
});

test("workspace file helpers wrap and parse Cube data", () => {
  const data = { meta: { name: "Workspace" }, notes: "note", cards: [{ id: "1" }] };
  const wrapped = wrapWorkspaceData(data);
  assert.equal(wrapped.format, WORKSPACE_FORMAT);
  assert.equal(wrapped.dataVersion, CURRENT_DATA_VERSION);
  assert.deepEqual(parseWorkspaceData(JSON.stringify(wrapped)), data);
  const migratedLegacy = parseWorkspaceData(JSON.stringify(data));
  assert.equal(migratedLegacy.cards[0].id, "1");
  assert.equal(migratedLegacy.cards[0].JapanPrint, false);
  assert.equal(migratedLegacy.cards[0].localThumbnail, "");
  assert.throws(() => parseWorkspaceData(JSON.stringify({ ...wrapped, dataVersion: CURRENT_DATA_VERSION + 1 })), /较新版本/);
  assert.throws(() => parseWorkspaceData(JSON.stringify({ nope: true })), /无效/);
});

test("serial write queue preserves order and recovers after a failed task", async () => {
  const events = [];
  const failures = [];
  const queue = createSerialWriteQueue(async (error, context) => {
    failures.push(`${context}:${error.message}`);
  });
  queue.enqueue(async () => { events.push("first:start"); await Promise.resolve(); events.push("first:end"); }, "first");
  queue.enqueue(async () => { events.push("second:start"); throw new Error("disk full"); }, "second");
  queue.enqueue(async () => { events.push("third:start"); events.push("third:end"); }, "third");
  await queue.flush();
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "third:start", "third:end"]);
  assert.deepEqual(failures, ["second:disk full"]);
});

test("handle store degrades gracefully when indexedDB is unavailable", async () => {
  const store = createHandleStore(null);
  assert.equal(store.supported, false);
  assert.equal(await store.load("cube"), null);
  assert.equal(await store.save("cube", { ok: true }), false);
  assert.equal(await store.clear("cube"), false);
});
