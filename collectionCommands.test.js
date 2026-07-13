const test = require("node:test");
const assert = require("node:assert/strict");
const { createCollectionCommandExecutor } = require("./collectionCommands.js");

function createHarness() {
  const calls = { changes: [], saves: [], renders: [], feedback: [] };
  const executor = createCollectionCommandExecutor({
    recordChange: (...args) => calls.changes.push(args),
    saveState: (...args) => calls.saves.push(args),
    requestRender: (...args) => calls.renders.push(args),
    toast: (...args) => calls.feedback.push(args)
  });
  return { calls, executor };
}

test("one collection command records many changes but saves, renders, and reports once", () => {
  const { calls, executor } = createHarness();
  const action = { label: "撤销", run() {} };
  const changed = executor.execute({
    changed: true,
    changes: [
      { type: "card.added", summary: "添加 A", details: { card: { id: "a" } } },
      { type: "card.added", summary: "添加 B", details: { card: { id: "b" } } }
    ],
    dirtyDomains: ["cube", "changeLog"],
    render: { pool: "draft" },
    feedback: { title: "完成", message: "添加 2 张", error: false, action }
  });

  assert.equal(changed, true);
  assert.deepEqual(calls.changes, [
    ["card.added", "添加 A", { card: { id: "a" } }, { persist: false }],
    ["card.added", "添加 B", { card: { id: "b" } }, { persist: false }]
  ]);
  assert.deepEqual(calls.saves, [[["cube", "changeLog"]]]);
  assert.deepEqual(calls.renders, [[{ pool: "draft" }]]);
  assert.deepEqual(calls.feedback, [["完成", "添加 2 张", false, action]]);
});

test("unchanged collection commands have no side effects", () => {
  const { calls, executor } = createHarness();
  assert.equal(executor.execute({ changed: false }), false);
  assert.deepEqual(calls, { changes: [], saves: [], renders: [], feedback: [] });
});

test("collection commands accept omitted optional effects", () => {
  const { calls, executor } = createHarness();
  assert.equal(executor.execute({ changed: true }), true);
  assert.deepEqual(calls.changes, []);
  assert.deepEqual(calls.saves, [[["cube", "changeLog"]]]);
  assert.deepEqual(calls.renders, []);
  assert.deepEqual(calls.feedback, []);
});
