const test = require("node:test");
const assert = require("node:assert/strict");
const { buildExcelRows, buildPrintingsUrl, computeStats, filterCards, filterPrintings, getCardBucket, getColorBucket, getFrontTypeLine, getPriceNumber, getUsdPrice, isPaperPrinting, normalizeCardName, normalizeFinish, normalizeScryfallCard, parseDecklist, parseExcelRows, replacePrinting, sortCards } = require("./core.js");

const cards = [
  { name: "Alpha", colors: ["W"], cmc: 1, typeLine: "Creature — Human", set: "TST" },
  { name: "Beta", colors: ["U", "B"], cmc: 3, typeLine: "Instant", set: "TST" },
  { name: "Gamma", colors: [], cmc: 0, typeLine: "Land", set: "TST" }
];

test("parseDecklist supports quantities, comments, and Arena suffixes", () => {
  assert.deepEqual(parseDecklist("# title\n2x Lightning Bolt\n1 Counterspell (DMR) 45\n// note"), ["Lightning Bolt", "Lightning Bolt", "Counterspell"]);
});

test("computeStats separates lands and color buckets", () => {
  const stats = computeStats(cards);
  assert.equal(stats.total, 3);
  assert.equal(stats.creatures, 1);
  assert.equal(stats.lands, 1);
  assert.equal(stats.averageCmc, 2);
  assert.equal(stats.colors.W, 1);
  assert.equal(stats.colors.M, 1);
  assert.equal(stats.colors.C, 1);
});

test("computeStats uses the front face for double-faced cards", () => {
  const stats = computeStats([
    { name: "Barkchannel Pathway", frontColors: ["G"], frontTypeLine: "Land", colors: ["G", "U"], typeLine: "Land", cmc: 0 },
    { name: "Barkchannel Pathway", frontColors: ["G"], frontTypeLine: "Land", colors: ["U"], typeLine: "Creature", cmc: 0 }
  ]);
  assert.equal(stats.lands, 2);
  assert.equal(stats.colors.G, 2);
  assert.equal(stats.colors.U, 0);
  assert.equal(stats.creatures, 0);
});

test("filterCards combines query, type, and color", () => {
  assert.deepEqual(filterCards(cards, { query: "beta", color: "M", type: "Instant" }).map((card) => card.name), ["Beta"]);
  assert.equal(filterCards(cards, { query: "", color: "W", type: "Land" }).length, 0);
});

test("getColorBucket recognizes multicolor and colorless", () => {
  assert.equal(getColorBucket(cards[1]), "M");
  assert.equal(getColorBucket(cards[2]), "C");
  assert.equal(getCardBucket(cards[2]), "L");
  assert.equal(getCardBucket({ name: "Sol Ring", colors: [], typeLine: "Artifact" }), "C");
});

test("colorless and land filters use separate display buckets", () => {
  const sample = [
    { name: "Sol Ring", colors: [], typeLine: "Artifact" },
    { name: "Wasteland", colors: [], typeLine: "Land" },
    { name: "Dryad Arbor", colors: ["G"], typeLine: "Land Creature — Forest Dryad" }
  ];
  assert.deepEqual(filterCards(sample, { query: "", color: "C", type: "all" }).map((card) => card.name), ["Sol Ring"]);
  assert.deepEqual(filterCards(sample, { query: "", color: "L", type: "all" }).map((card) => card.name), ["Wasteland", "Dryad Arbor"]);
});

test("sortCards orders by WUBRG, then colorless, multicolor, lands, then name", () => {
  const sorted = sortCards([
    { name: "Forest", colors: [], typeLine: "Land" },
    { name: "Zeta", colors: ["G"], typeLine: "Creature" },
    { name: "Alpha", colors: ["W"], typeLine: "Creature" },
    { name: "Beta", colors: ["U"], typeLine: "Creature" },
    { name: "Gamma", colors: ["B"], typeLine: "Creature" },
    { name: "Delta", colors: ["R"], typeLine: "Creature" },
    { name: "Epsilon", colors: ["G"], typeLine: "Creature" },
    { name: "Artifact", colors: [], typeLine: "Artifact" },
    { name: "Hybrid", colors: ["W", "U"], typeLine: "Creature" }
  ]);
  assert.deepEqual(sorted.map((card) => card.name), ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Artifact", "Hybrid", "Forest"]);
});

test("double-faced cards use only the front face for sorting and filtering", () => {
  const treasureMap = { name: "Treasure Map", colors: [], typeLine: "Artifact // Land" };
  const sorted = sortCards([
    { name: "AA Land", colors: [], typeLine: "Land" },
    treasureMap,
    { name: "ZZ Artifact", colors: [], typeLine: "Artifact" }
  ]);
  assert.deepEqual(sorted.map((card) => card.name), ["Treasure Map", "ZZ Artifact", "AA Land"]);
  assert.equal(getFrontTypeLine(treasureMap), "Artifact");
  assert.equal(filterCards([treasureMap], { query: "", color: "C", type: "Artifact" }).length, 1);
  assert.equal(filterCards([treasureMap], { query: "", color: "all", type: "Land" }).length, 0);
});

test("normalizeScryfallCard keeps Treasure Map's front-face classification", () => {
  const treasureMap = normalizeScryfallCard({
    id: "treasure-map",
    name: "Treasure Map // Treasure Cove",
    type_line: "Artifact // Land",
    card_faces: [
      { name: "Treasure Map", type_line: "Artifact", colors: [] },
      { name: "Treasure Cove", type_line: "Land", colors: [] }
    ],
    set: "xln",
    collector_number: "250"
  });
  assert.equal(treasureMap.frontTypeLine, "Artifact");
  assert.equal(computeStats([treasureMap]).lands, 0);
  assert.equal(filterCards([treasureMap], { query: "", color: "C", type: "Artifact" }).length, 1);
});

test("normalizeScryfallCard keeps the exact printing number", () => {
  const card = normalizeScryfallCard({ id: "card", name: "Black Vise", set: "lea", collector_number: "233", type_line: "Artifact", prices: { usd: "1.23", usd_foil: "4.56" } });
  assert.equal(card.set, "LEA");
  assert.equal(card.collectorNumber, "233");
  assert.equal(card.scryfallId, "card");
  assert.equal(card.finish, "foil");
  assert.equal(card.prices.usd, "1.23");
  assert.equal(card.prices.usdFoil, "4.56");
  assert.equal(normalizeFinish("nonfoil"), "nonfoil");
  assert.equal(normalizeFinish("something else"), "foil");
  assert.equal(getUsdPrice(card, "foil"), "4.56");
  assert.equal(getUsdPrice(card, "nonfoil"), "1.23");
  assert.equal(getPriceNumber(card, "foil"), 4.56);
  assert.equal(getUsdPrice({ prices: { usd: "1.23", usdFoil: "" }, finish: "foil" }), "");
  assert.equal(getPriceNumber({ prices: { usd: "1.23", usdFoil: "" }, finish: "foil" }), null);
});

test("printing helpers build, filter, and replace versions safely", () => {
  assert.match(buildPrintingsUrl("oracle-id"), /oracleid%3Aoracle-id.*unique=prints/);
  assert.match(decodeURIComponent(buildPrintingsUrl("oracle-id")), /game:paper/);
  const printings = [
    { id: "alpha", name: "Black Vise", set: "lea", set_name: "Limited Edition Alpha", collector_number: "233", type_line: "Artifact", games: ["paper"], digital: false },
    { id: "beta", name: "Black Vise", set: "leb", set_name: "Limited Edition Beta", collector_number: "234", type_line: "Artifact", games: ["paper", "mtgo"], digital: false },
    { id: "digital", name: "Black Vise", set: "ana", set_name: "Arena", collector_number: "1", type_line: "Artifact", games: ["arena"], digital: true }
  ];
  assert.equal(isPaperPrinting(printings[0]), true);
  assert.equal(isPaperPrinting(printings[2]), false);
  assert.deepEqual(filterPrintings(printings, "").map((card) => card.id), ["alpha", "beta"]);
  assert.deepEqual(filterPrintings(printings, "LEA").map((card) => card.id), ["alpha"]);
  assert.deepEqual(filterPrintings(printings, "234").map((card) => card.id), ["beta"]);
  const replaced = replacePrinting({ id: "cube-card", addedAt: "saved-date", finish: "nonfoil" }, printings[1]);
  assert.equal(replaced.id, "cube-card");
  assert.equal(replaced.addedAt, "saved-date");
  assert.equal(replaced.scryfallId, "beta");
  assert.equal(replaced.set, "LEB");
  assert.equal(replaced.collectorNumber, "234");
  assert.equal(replaced.finish, "nonfoil");
});

test("parseExcelRows detects headers and keeps identifiers as text", () => {
  assert.deepEqual(parseExcelRows([
    ["系列", "编号", "卡牌名称"],
    ["lea", "001", "Black Vise"],
    ["2X2", 361, "Lightning Bolt"],
    ["", "", ""]
  ]), [
    { rowNumber: 2, setCode: "LEA", collectorNumber: "001", expectedName: "Black Vise" },
    { rowNumber: 3, setCode: "2X2", collectorNumber: "361", expectedName: "Lightning Bolt" }
  ]);
  assert.equal(normalizeCardName("  Urza’s   Saga "), "urza's saga");
});

test("buildExcelRows exports a re-importable table with finish and price", () => {
  const rows = buildExcelRows([
    { set: "XLN", collectorNumber: "250", name: "Treasure Map // Treasure Cove", finish: "foil", prices: { usd: "0.55", usdFoil: "0.73" } },
    { set: "LEA", collectorNumber: "233", name: "Black Vise", finish: "nonfoil", prices: { usd: "25.00", usdFoil: "" } }
  ]);
  assert.deepEqual(rows[0], ["系列", "编号", "卡牌名称", "闪卡状态", "美元价格"]);
  assert.deepEqual(rows[1], ["XLN", "250", "Treasure Map // Treasure Cove", "Foil", "0.73"]);
  assert.deepEqual(rows[2], ["LEA", "233", "Black Vise", "Non-Foil", "25.00"]);
  assert.deepEqual(parseExcelRows(rows).map(({ setCode, collectorNumber, expectedName }) => ({ setCode, collectorNumber, expectedName })), [
    { setCode: "XLN", collectorNumber: "250", expectedName: "Treasure Map // Treasure Cove" },
    { setCode: "LEA", collectorNumber: "233", expectedName: "Black Vise" }
  ]);
});
