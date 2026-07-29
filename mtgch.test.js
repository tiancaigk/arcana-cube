const test = require("node:test");
const assert = require("node:assert/strict");

const { buildCardUrl, createMtgchClient, extractSimplifiedChineseName } = require("./mtgch.js");

test("MTGCH card URLs preserve exact collector numbers", () => {
  assert.equal(buildCardUrl("f06", "12a"), "https://mtgch.com/api/v1/card/F06/12a/");
  assert.equal(buildCardUrl("pwoe", "126★"), "https://mtgch.com/api/v1/card/PWOE/126%E2%98%85/");
});

test("MTGCH names prefer the official front-face name for split cards", () => {
  assert.equal(extractSimplifiedChineseName({
    name: "Fire // Ice",
    atomic_official_name: "热火",
    full_official_name: "热火 // 寒冰"
  }), "热火");
  assert.equal(extractSimplifiedChineseName({
    name: "Fire // Ice",
    full_official_name: "热火 // 寒冰"
  }), "热火");
});

test("MTGCH names accept community simplified translations but reject English fallbacks", () => {
  assert.equal(extractSimplifiedChineseName({ atomic_translated_name: "纠结缆线" }), "纠结缆线");
  assert.equal(extractSimplifiedChineseName({ atomic_official_name: "Tangle Wire" }), "");
});

test("MTGCH client returns an empty fallback for missing cards", async () => {
  const client = createMtgchClient({
    fetchImpl: async () => ({ ok: false, status: 404 })
  });
  assert.equal(await client.lookupSimplifiedChineseName({ set: "TST", collectorNumber: "1" }), "");
});
