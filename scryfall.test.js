const test = require("node:test");
const assert = require("node:assert/strict");
const { requestJson } = require("./scryfall.js");

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name] || null },
    json: async () => payload
  };
}

test("requestJson retries rate limits and returns JSON", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return calls === 1 ? response(429, { details: "slow down" }) : response(200, { object: "card" });
  };
  assert.deepEqual(await requestJson("https://example.test", { fetchImpl, retryDelayMs: 0, minIntervalMs: 0 }), { object: "card" });
  assert.equal(calls, 2);
});

test("requestJson exposes non-retryable status codes", async () => {
  let calls = 0;
  await assert.rejects(requestJson("https://example.test", {
    fetchImpl: async () => { calls += 1; return response(404, { details: "not found" }); },
    minIntervalMs: 0
  }), (error) => error.status === 404 && /not found/.test(error.message));
  assert.equal(calls, 1);
});

test("requestJson honors caller cancellation", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("Stopped", "AbortError"));
  await assert.rejects(requestJson("https://example.test", { fetchImpl: async () => response(200, {}), signal: controller.signal, minIntervalMs: 0 }), /Stopped/);
});
