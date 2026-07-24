const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");
const { createCatalog, printingKey } = require("./catalog.js");

function responseError(status, message = "failed") {
  return Object.assign(new Error(message), { status });
}

test("catalog name search follows pagination and keeps paper printings", async () => {
  const calls = [];
  const pages = new Map([
    [core.buildCardNameSearchUrl("Bolt"), { data: [{ id: "paper", name: "Bolt", games: ["paper"] }, { id: "digital", name: "Bolt", digital: true, games: ["mtgo"] }], has_more: true, next_page: "page-2" }],
    ["page-2", { data: [{ id: "paper-2", name: "Big Bolt", games: ["paper"] }], has_more: false }]
  ]);
  const catalog = createCatalog({ core, requestJson: async (url, options) => { calls.push({ url, signal: options.signal }); return pages.get(url); } });
  const signal = new AbortController().signal;
  const cards = await catalog.searchByName("Bolt", signal);
  assert.deepEqual(cards.map((card) => card.id), ["paper", "paper-2"]);
  assert.deepEqual(calls.map((call) => call.url), [core.buildCardNameSearchUrl("Bolt"), "page-2"]);
  assert.equal(calls[0].signal, signal);
});

test("catalog translates expected lookup 404 responses", async () => {
  const catalog = createCatalog({ core, requestJson: async () => { throw responseError(404); } });
  await assert.rejects(() => catalog.lookupNamed("Missing"), /没有找到这张牌/);
  await assert.rejects(() => catalog.lookupPrinting("TST", "1"), /系列与编号/);
  assert.equal(await catalog.lookupById("missing"), null);
  assert.deepEqual(await catalog.searchByName("Missing"), []);
});

test("catalog resolves and caches Oracle printing pages", async () => {
  const calls = [];
  const oracleId = "00000000-0000-4000-8000-000000000001";
  const identity = { id: "printing", oracle_id: oracleId, name: "Card", games: ["paper"], set: "tst", collector_number: "1" };
  const requestJson = async (url) => {
    calls.push(url);
    if (url.includes("/cards/tst/1")) return identity;
    if (url.includes(oracleId)) return { data: [identity], has_more: false };
    throw new Error(`unexpected ${url}`);
  };
  const catalog = createCatalog({ core, requestJson });
  const first = await catalog.lookupAllPrintings({ set: "TST", collectorNumber: "1", name: "Card" });
  const second = await catalog.lookupAllPrintings({ set: "TST", collectorNumber: "1", name: "Card" });
  assert.equal(first.oracleId, oracleId);
  assert.deepEqual(first.printings, [identity]);
  assert.deepEqual(second, first);
  assert.equal(calls.filter((url) => url.includes(oracleId)).length, 1);
});

test("catalog rejects repeated printing pagination", async () => {
  const identity = { id: "printing", oracle_id: "00000000-0000-4000-8000-000000000002", name: "Card", games: ["paper"], set: "tst", collector_number: "1" };
  const catalog = createCatalog({
    core,
    requestJson: async (url) => url.includes("/cards/tst/1")
      ? identity
      : { data: [identity], has_more: true, next_page: url }
  });
  await assert.rejects(() => catalog.lookupAllPrintings({ set: "TST", collectorNumber: "1", name: "Card" }), /重复分页/);
});

test("catalog batches collection requests in groups of 75", async () => {
  const batchSizes = [];
  const catalog = createCatalog({
    core,
    requestJson: async (_url, options) => {
      const identifiers = JSON.parse(options.body).identifiers;
      batchSizes.push(identifiers.length);
      return { data: identifiers.map((identifier, index) => ({ id: `${batchSizes.length}-${index}`, set: identifier.set, collector_number: identifier.collector_number, name: identifier.name || `Card ${index}` })) };
    }
  });
  const rows = Array.from({ length: 76 }, (_, index) => ({ setCode: "TST", collectorNumber: String(index + 1) }));
  const result = await catalog.lookupPrintingBatch(rows);
  assert.deepEqual(batchSizes, [75, 1]);
  assert.equal(result.size, 76);
  assert.equal(result.get(printingKey("TST", "001")).collector_number, "1");
});

test("catalog preserves collection not-found identifiers", async () => {
  const client = createCatalog({
    requestJson: async () => ({
      data: [{ id: "found", set: "lea", collector_number: "1" }],
      not_found: [{ set: "lea", collector_number: "2" }]
    }),
    core
  });
  const result = await client.lookupPrintingBatchDetailed([
    { setCode: "LEA", collectorNumber: "1" },
    { setCode: "LEA", collectorNumber: "2" }
  ]);
  assert.equal(result.cardsByPrinting.get(printingKey("lea", "1")).id, "found");
  assert.deepEqual(result.notFound, [{ set: "lea", collector_number: "2" }]);
});

test("catalog name batches index front and printed names", async () => {
  const catalog = createCatalog({
    core,
    requestJson: async () => ({ data: [{ id: "card", name: "Front // Back", printed_name: "正面 // 背面", card_faces: [{ name: "Front" }, { name: "Back" }] }] })
  });
  const result = await catalog.lookupCardNameBatch(["Front"]);
  assert.equal(result.get(core.normalizeCardName("Front")).id, "card");
  assert.equal(result.get(core.normalizeCardName("正面 // 背面")).id, "card");
});
