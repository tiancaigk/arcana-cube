const test = require("node:test");
const assert = require("node:assert/strict");

const { createRenderScheduler } = require("./renderScheduler");

test("scheduler merges duplicate scopes and renders in fixed order", () => {
  const calls = [];
  const queued = [];
  const scheduler = createRenderScheduler({
    meta: () => calls.push("meta"),
    stats: () => calls.push("stats"),
    cards: () => calls.push("cards")
  }, { order: ["meta", "stats", "cards"], queueTask: (task) => queued.push(task) });

  scheduler.request("cards", "stats");
  scheduler.request("cards", "meta");

  assert.equal(queued.length, 1);
  queued[0]();
  assert.deepEqual(calls, ["meta", "stats", "cards"]);
});

test("scheduler coalesces requests through one microtask", async () => {
  const calls = [];
  const scheduler = createRenderScheduler({ cards: () => calls.push("cards") });

  scheduler.request("cards");
  scheduler.request("cards");
  assert.deepEqual(calls, []);
  await Promise.resolve();
  assert.deepEqual(calls, ["cards"]);
});

test("flush renders pending scopes immediately and leaves queued work harmless", () => {
  const calls = [];
  const queued = [];
  const scheduler = createRenderScheduler({ cards: () => calls.push("cards") }, { queueTask: (task) => queued.push(task) });

  scheduler.request("cards");
  scheduler.flush();
  queued[0]();

  assert.deepEqual(calls, ["cards"]);
});

test("scheduler rejects unknown scopes without queuing partial work", () => {
  const queued = [];
  const scheduler = createRenderScheduler({ cards() {} }, { queueTask: (task) => queued.push(task) });

  assert.throws(() => scheduler.request("cards", "unknown"), /unknown/i);
  assert.equal(queued.length, 0);
});
