const test = require("node:test");
const assert = require("node:assert/strict");
const { createStorage, isCubeData } = require("./storage.js");

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
