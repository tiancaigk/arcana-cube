const test = require("node:test");
const assert = require("node:assert/strict");
const { createViewPreferenceStore } = require("./viewPreferences.js");

const definitions = {
  language: { key: "language", allowedValues: ["en", "zh"], fallback: "en" },
  grouping: { key: "grouping", allowedValues: ["kind", "set"], fallback: "kind" }
};

test("view preferences restore only allowed enum values", () => {
  const values = new Map([["language", "zh"], ["grouping", "invalid"]]);
  const store = createViewPreferenceStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }, definitions);
  assert.equal(store.get("language"), "zh");
  assert.equal(store.get("grouping"), "kind");
  assert.equal(store.get("missing"), undefined);
});

test("view preferences normalize writes and return the stored value", () => {
  const values = new Map();
  const store = createViewPreferenceStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }, definitions);
  assert.equal(store.set("language", "zh"), "zh");
  assert.equal(values.get("language"), "zh");
  assert.equal(store.set("language", "invalid"), "en");
  assert.equal(values.get("language"), "en");
});

test("view preferences tolerate unavailable browser storage", () => {
  const store = createViewPreferenceStore({
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); }
  }, definitions);
  assert.equal(store.get("language"), "en");
  assert.doesNotThrow(() => store.set("grouping", "set"));
  assert.equal(store.set("grouping", "set"), "set");
});
