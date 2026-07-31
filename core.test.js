const test = require("node:test");
const assert = require("node:assert/strict");
const { CURRENT_DATA_VERSION } = require("./migrations.js");
const { assertMainDeckSingleton, buildBackup, buildCardNameSearchUrl, buildExcelRows, buildLocalizedNameSearchUrl, buildLocalImageFileName, buildPrintingsUrl, chooseValidFinish, computeStats, filterCards, filterOraclePrintings, filterPrintings, findSingletonCard, getAvailableFinishes, getBasicLandKind, getCardBucket, getCardDisplayName, getCardImage, getColorBucket, getFrontDisplayName, getFrontTypeLine, getLookupName, getOracleId, getPreferredLocalizedName, getPriceNumber, getUsdPrice, isLandCard, isPaperPrinting, isSupportedBasicLand, mergeArchiveMetadata, needsPriceRefresh, normalizeCardName, normalizeFinish, normalizeLocalizedNames, normalizeScryfallCard, parseBackup, parseDecklist, parseExcelRows, prepareTextImportRows, replacePrinting, sortCards } = require("./core.js");

const cards = [
  { name: "Alpha", colors: ["W"], cmc: 1, typeLine: "Creature — Human", set: "TST" },
  { name: "Beta", colors: ["U", "B"], cmc: 3, typeLine: "Instant", set: "TST" },
  { name: "Gamma", colors: [], cmc: 0, typeLine: "Land", set: "TST" }
];

test("parseDecklist supports quantities, comments, and Arena suffixes", () => {
  assert.deepEqual(parseDecklist("# title\n2x Lightning Bolt\n1 Counterspell (DMR) 45\n// note"), ["Lightning Bolt", "Lightning Bolt", "Counterspell"]);
});

test("text import rows flag duplicates and cards already in the Cube", () => {
  const rows = prepareTextImportRows(["Lightning Bolt", "Counterspell", "lightning  bolt"], ["Counterspell"]);
  assert.deepEqual(rows.map((row) => row.status), ["valid", "existing", "duplicate"]);
  assert.deepEqual(rows.map((row) => row.rowNumber), [1, 2, 3]);
});

test("main deck singleton matches Oracle IDs and falls back to English card names", () => {
  const oracleId = "4457ed35-7c10-48c8-9776-456485fdf070";
  const original = { id: "printing-a", name: "Lightning Bolt", oracleId };
  assert.equal(findSingletonCard([original], { id: "printing-b", name: "Lightning Bolt", oracle_id: oracleId }), original);
  assert.equal(findSingletonCard([{ id: "split-a", name: "Fire // Ice" }], { id: "split-b", name: "fire  //  ice" }).id, "split-a");
  assert.equal(findSingletonCard([original], original), null);
  assert.throws(() => assertMainDeckSingleton([
    original,
    { id: "printing-b", name: "Lightning Bolt", oracleId }
  ]), /严格单例.*Lightning Bolt/);
});

test("computeStats separates lands and color buckets", () => {
  const stats = computeStats(cards);
  assert.equal(stats.total, 3);
  assert.equal(stats.creatures, 1);
  assert.equal(stats.lands, 1);
  assert.equal(stats.averageCmc, 2);
  assert.equal(stats.colors.W, 1);
  assert.equal(stats.colors.M, 1);
  assert.equal(stats.colors.C, 0);
  assert.equal(stats.colors.L, 1);
});

test("computeStats uses the front face for double-faced cards", () => {
  const stats = computeStats([
    { name: "Barkchannel Pathway", frontColors: ["G"], frontTypeLine: "Land", colors: ["G", "U"], typeLine: "Land", cmc: 0 },
    { name: "Barkchannel Pathway", frontColors: ["G"], frontTypeLine: "Land", colors: ["U"], typeLine: "Creature", cmc: 0 }
  ]);
  assert.equal(stats.lands, 2);
  assert.equal(stats.colors.G, 0);
  assert.equal(stats.colors.U, 0);
  assert.equal(stats.colors.L, 2);
  assert.equal(stats.creatures, 0);
});

test("filterCards combines query, type, and color", () => {
  assert.deepEqual(filterCards(cards, { query: "beta", color: "M", type: "Instant" }).map((card) => card.name), ["Beta"]);
  assert.equal(filterCards(cards, { query: "", color: "W", type: "Land" }).length, 0);
});

test("filterCards combines finish with the other filters", () => {
  const sample = [
    { name: "Foil Bolt", colors: ["R"], typeLine: "Instant", finish: "foil" },
    { name: "Regular Bolt", colors: ["R"], typeLine: "Instant", finish: "nonfoil" },
    { name: "Legacy Foil", colors: ["U"], typeLine: "Instant" }
  ];
  assert.deepEqual(filterCards(sample, { query: "bolt", color: "R", type: "Instant", finish: "foil" }).map((card) => card.name), ["Foil Bolt"]);
  assert.deepEqual(filterCards(sample, { query: "", color: "all", type: "all", finish: "nonfoil" }).map((card) => card.name), ["Regular Bolt"]);
  assert.deepEqual(filterCards(sample, { query: "", color: "all", type: "all", finish: "foil" }).map((card) => card.name), ["Foil Bolt", "Legacy Foil"]);
});

test("filterCards combines JapanPrint with the other filters", () => {
  const sample = [
    { name: "Japanese Bolt", colors: ["R"], typeLine: "Instant", JapanPrint: true },
    { name: "Regular Bolt", colors: ["R"], typeLine: "Instant", JapanPrint: false },
    { name: "Legacy Bolt", colors: ["R"], typeLine: "Instant" }
  ];
  assert.deepEqual(filterCards(sample, { query: "bolt", color: "R", type: "Instant", japanPrint: "japan" }).map((card) => card.name), ["Japanese Bolt"]);
  assert.deepEqual(filterCards(sample, { query: "", color: "all", type: "all", japanPrint: "nonjapan" }).map((card) => card.name), ["Regular Bolt", "Legacy Bolt"]);
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
  assert.deepEqual(filterCards(sample, { query: "", color: "all", type: "Land" }).map((card) => card.name), ["Wasteland", "Dryad Arbor"]);
  assert.equal(isLandCard(sample[2]), true);
  const stats = computeStats([sample[2]]);
  assert.equal(stats.lands, 1);
  assert.equal(stats.creatures, 1);
  assert.equal(stats.averageCmc, 0);
  assert.equal(stats.curve[0], 0);
});

test("basic land helpers accept only the five supported exact names", () => {
  assert.equal(getBasicLandKind({ name: "Plains" }), "Plains");
  assert.equal(getBasicLandKind({ name: "Island // Other" }), "Island");
  assert.equal(getBasicLandKind({ name: "Snow-Covered Island" }), "");
  assert.equal(getBasicLandKind({ name: "Wastes" }), "");
  assert.equal(getBasicLandKind({ name: "Tundra", typeLine: "Land — Plains Island" }), "");
  assert.equal(isSupportedBasicLand({ name: "Forest" }), true);
  assert.equal(isSupportedBasicLand({ name: "Wastes" }), false);
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

test("sortCards orders multicolor cards by guild pair, then name", () => {
  const sorted = sortCards([
    { name: "Simic Growth", colors: ["G", "U"], typeLine: "Creature" },
    { name: "Boros Charm", colors: ["R", "W"], typeLine: "Instant" },
    { name: "Azorius Signet", colors: ["U", "W"], typeLine: "Artifact" },
    { name: "Aurelia", colors: ["W", "R"], typeLine: "Creature" },
    { name: "Dimir Cutpurse", colors: ["U", "B"], typeLine: "Creature" },
    { name: "Esper Charm", colors: ["W", "U", "B"], typeLine: "Instant" },
    { name: "Azorius Arrester", colors: ["W", "U"], typeLine: "Creature" }
  ]);
  assert.deepEqual(sorted.map((card) => card.name), [
    "Azorius Arrester",
    "Azorius Signet",
    "Dimir Cutpurse",
    "Aurelia",
    "Boros Charm",
    "Simic Growth",
    "Esper Charm"
  ]);
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

test("normalizeScryfallCard keeps the exact printing and waits for canonical MTGJSON prices", () => {
  const card = normalizeScryfallCard({ id: "card", name: "Black Vise", set: "lea", collector_number: "233", type_line: "Artifact", finishes: ["nonfoil", "foil"], prices: { usd: "1.23", usd_foil: "4.56" } });
  assert.equal(card.set, "LEA");
  assert.equal(card.collectorNumber, "233");
  assert.equal(card.scryfallId, "card");
  assert.equal(card.finish, "foil");
  assert.deepEqual(card.prices, { usd: "", usdFoil: "", usdEtched: "" });
  assert.equal(card.priceSource, null);
  assert.equal(card.priceUpdatedAt, "");
  assert.equal(normalizeFinish("nonfoil"), "nonfoil");
  assert.equal(normalizeFinish("something else"), "foil");
  assert.equal(getUsdPrice({ prices: { usd: "1.23", usdFoil: "4.56" } }, "foil"), "4.56");
  assert.equal(getUsdPrice({ prices: { usd: "1.23", usdFoil: "4.56" } }, "nonfoil"), "1.23");
  assert.equal(getPriceNumber({ prices: { usd: "1.23", usdFoil: "4.56" } }, "foil"), 4.56);
  assert.equal(getUsdPrice({ prices: { usd: "1.23", usdFoil: "" }, finish: "foil" }), "");
  assert.equal(getPriceNumber({ prices: { usd: "1.23", usdFoil: "" }, finish: "foil" }), null);
});

test("normalizeScryfallCard prefers high quality png image urls", () => {
  const card = normalizeScryfallCard({
    id: "image-card",
    name: "Image Card",
    set: "tst",
    type_line: "Artifact",
    card_faces: [
      {
        name: "Image Card",
        image_uris: {
          normal: "https://cards.scryfall.io/normal/front/a/b/image-card.jpg",
          large: "https://cards.scryfall.io/large/front/a/b/image-card.jpg",
          png: "https://cards.scryfall.io/png/front/a/b/image-card.png"
        }
      },
      {
        name: "Back Card",
        image_uris: {
          png: "https://cards.scryfall.io/png/back/a/b/image-card.png"
        }
      }
    ]
  });
  assert.equal(card.image, "https://cards.scryfall.io/png/front/a/b/image-card.png");
  assert.equal(card.remoteImage, "https://cards.scryfall.io/png/front/a/b/image-card.png");
  assert.equal(card.localImage, "");
  assert.equal(card.localThumbnail, "");
  assert.equal(card.backImage, "https://cards.scryfall.io/png/back/a/b/image-card.png");
  assert.equal(card.remoteBackImage, "https://cards.scryfall.io/png/back/a/b/image-card.png");
  assert.equal(card.localBackImage, "");
  assert.equal(card.localBackThumbnail, "");
});

test("normalizeScryfallCard stores archive metadata for single and double-faced cards", () => {
  const single = normalizeScryfallCard({
    id: "single",
    name: "Bolt",
    set: "tst",
    set_name: "Test Set",
    collector_number: "1",
    released_at: "2026-01-02",
    type_line: "Instant",
    oracle_text: "Deal 3 damage.",
    artist: "Sample Artist"
  });
  assert.equal(single.oracleText, "Deal 3 damage.");
  assert.equal(single.backOracleText, "");
  assert.equal(single.artist, "Sample Artist");
  assert.equal(single.backArtist, "");
  assert.equal(single.setName, "Test Set");
  assert.equal(single.releasedAt, "2026-01-02");

  const doubleFaced = normalizeScryfallCard({
    id: "double",
    name: "Front // Back",
    set: "tst",
    set_name: "Test Set",
    collector_number: "2",
    released_at: "2026-01-03",
    card_faces: [
      { name: "Front", type_line: "Creature", oracle_text: "Front rules", artist: "Front Artist" },
      { name: "Back", type_line: "Land", oracle_text: "Back rules", artist: "Back Artist" }
    ]
  });
  assert.equal(doubleFaced.oracleText, "Front rules");
  assert.equal(doubleFaced.backOracleText, "Back rules");
  assert.equal(doubleFaced.artist, "Front Artist");
  assert.equal(doubleFaced.backArtist, "Back Artist");
});

test("mergeArchiveMetadata adds Scryfall details without replacing collection state", () => {
  const existing = {
    id: "cube-card",
    name: "Bolt",
    localImage: "images/bolt.png",
    finish: "foil",
    JapanPrint: true,
    addedAt: "saved-date"
  };
  const merged = mergeArchiveMetadata(existing, {
    id: "printing",
    name: "Bolt",
    set: "tst",
    set_name: "Test Set",
    collector_number: "1",
    released_at: "2026-01-02",
    type_line: "Instant",
    oracle_text: "Deal 3 damage.",
    artist: "Sample Artist"
  });
  assert.equal(merged.oracleText, "Deal 3 damage.");
  assert.equal(merged.setName, "Test Set");
  assert.equal(merged.localImage, existing.localImage);
  assert.equal(merged.finish, existing.finish);
  assert.equal(merged.JapanPrint, true);
  assert.equal(merged.addedAt, "saved-date");
});

test("buildLocalImageFileName uses set, collector number, and card name", () => {
  assert.equal(buildLocalImageFileName({
    name: "Ulamog, the Ceaseless Hunger // Ulamog, the Ceaseless Hunger",
    set: "SLD",
    collectorNumber: "1122",
    scryfallId: "11111111-2222-3333-4444-555555555555"
  }, "png"), "sld-1122-ulamog-the-ceaseless-hunger.png");
  assert.equal(buildLocalImageFileName({
    name: "Chandra's Phoenix",
    set: "PM12",
    collectorNumber: "126★",
    id: "fallback-id"
  }, "jpeg"), "pm12-126★-chandras-phoenix.jpg");
  assert.equal(buildLocalImageFileName({
    name: "Treasure Map // Treasure Cove",
    set: "XLN",
    collectorNumber: "250"
  }, "png", "back"), "xln-250-treasure-map-back.png");
});

test("getCardImage uses thumbnails in the collection and originals in previews", () => {
  const card = {
    image: "images/card.png",
    localThumbnail: "images/thumbnails/card.webp",
    backImage: "images/card-back.png",
    localBackThumbnail: "images/thumbnails/card-back.webp"
  };
  assert.equal(getCardImage(card), "images/thumbnails/card.webp");
  assert.equal(getCardImage(card, "back"), "images/thumbnails/card-back.webp");
  assert.equal(getCardImage(card, "front", true), "images/card.png");
  assert.equal(getCardImage(card, "back", true), "images/card-back.png");
});

test("finish helpers respect the selected printing's availability", () => {
  const nonfoilOnly = normalizeScryfallCard({ id: "regular", name: "Regular", set: "tst", type_line: "Artifact", finishes: ["nonfoil"], foil: false, nonfoil: true, prices: { usd: "1.00" } });
  assert.deepEqual(getAvailableFinishes(nonfoilOnly), ["nonfoil"]);
  assert.equal(nonfoilOnly.finish, "nonfoil");
  assert.equal(chooseValidFinish(nonfoilOnly, "foil"), "nonfoil");
  const etched = normalizeScryfallCard({ id: "etched", name: "Etched", set: "tst", type_line: "Artifact", finishes: ["etched"], prices: { usd_etched: "5.00" } });
  assert.deepEqual(etched.finishes, ["foil"]);
  assert.equal(getUsdPrice(etched, "foil"), "");
  const replaced = replacePrinting({ id: "cube-card", addedAt: "date", finish: "nonfoil" }, { id: "foil-only", name: "Card", set: "tst", type_line: "Artifact", finishes: ["foil"], foil: true, nonfoil: false });
  assert.equal(replaced.finish, "foil");
});

test("localized name helpers store Chinese printed card names", () => {
  const card = normalizeScryfallCard({
    id: "bolt-zhs",
    oracle_id: "4457ed35-7c10-48c8-9776-456485fdf070",
    name: "Lightning Bolt",
    printed_name: "闪电击",
    lang: "zhs",
    set: "2x2",
    collector_number: "361",
    type_line: "Instant"
  });
  assert.deepEqual(card.localizedNames, { zhs: "闪电击" });
  assert.equal(getPreferredLocalizedName(card), "闪电击");
  assert.deepEqual(normalizeLocalizedNames({ localized_names: { zhs: " 简中名 ", ja: "ignored" }, printed_name: "繁中名", lang: "zht" }), { zhs: "简中名", zht: "繁中名" });
  const pathway = normalizeScryfallCard({
    id: "pathway-zhs",
    oracle_id: "a8394cfa-580d-4b09-9f8d-7bcd7e4c89a6",
    name: "Barkchannel Pathway // Tidechannel Pathway",
    lang: "zhs",
    card_faces: [
      { name: "Barkchannel Pathway", printed_name: "树渠通路", type_line: "Land", colors: [] },
      { name: "Tidechannel Pathway", printed_name: "潮渠通路", type_line: "Land", colors: [] }
    ],
    set: "znr",
    collector_number: "260",
    type_line: "Land // Land"
  });
  assert.deepEqual(pathway.localizedNames, { zhs: "树渠通路" });
  assert.equal(getPreferredLocalizedName(pathway), "树渠通路");
  const fireIce = normalizeScryfallCard({
    id: "fire-ice-zhs",
    name: "Fire // Ice",
    printed_name: "热火 // 寒冰",
    lang: "zhs",
    layout: "split",
    mana_cost: "{1}{R} // {1}{U}",
    set: "f06",
    collector_number: "12a",
    type_line: "Instant // Instant"
  });
  assert.deepEqual(fireIce.localizedNames, { zhs: "热火 // 寒冰" });
  assert.equal(getCardDisplayName(fireIce, getPreferredLocalizedName(fireIce)), "热火 // 寒冰");
  assert.equal(getCardDisplayName({
    name: "Expansion // Explosion",
    layout: "split"
  }, "迸增 // 迸裂 // 迸增 // 迸裂"), "迸增 // 迸裂");
  assert.equal(getCardDisplayName(pathway, "树渠通路 // 潮渠通路"), "树渠通路");
  assert.deepEqual(normalizeLocalizedNames({
    name: "Treasure Map // Treasure Cove",
    lang: "zhs",
    card_faces: [{ name: "Treasure Map", printed_name: "Treasure Map" }]
  }), {});
});

test("replacePrinting preserves cached localized names", () => {
  const current = { id: "cube-card", addedAt: "2026-01-01T00:00:00.000Z", name: "Lightning Bolt", localizedNames: { zhs: "闪电击" }, finish: "foil" };
  const replaced = replacePrinting(current, { id: "new-printing", name: "Lightning Bolt", set: "clu", collector_number: "141", type_line: "Instant", finishes: ["foil", "nonfoil"] });
  assert.equal(replaced.id, "cube-card");
  assert.deepEqual(replaced.localizedNames, { zhs: "闪电击" });
});

test("replacePrinting preserves local images only for the same Scryfall printing", () => {
  const current = { id: "cube-card", scryfallId: "same-printing", addedAt: "2026-01-01T00:00:00.000Z", name: "Card", localImage: "images/same-printing.png", localThumbnail: "images/thumbnails/same-printing.webp", image: "images/same-printing.png", localBackImage: "images/same-printing-back.png", localBackThumbnail: "images/thumbnails/same-printing-back.webp", backImage: "images/same-printing-back.png", finish: "foil" };
  const same = replacePrinting(current, { id: "same-printing", name: "Card", set: "tst", collector_number: "1", type_line: "Artifact", image_uris: { png: "https://cards.scryfall.io/png/front/a/b/same.png" }, card_faces: [{ name: "Card", image_uris: { png: "https://cards.scryfall.io/png/front/a/b/same.png" } }, { name: "Back", image_uris: { png: "https://cards.scryfall.io/png/back/a/b/same.png" } }] });
  assert.equal(same.localImage, "images/same-printing.png");
  assert.equal(same.localThumbnail, "images/thumbnails/same-printing.webp");
  assert.equal(same.image, "images/same-printing.png");
  assert.equal(same.localBackImage, "images/same-printing-back.png");
  assert.equal(same.localBackThumbnail, "images/thumbnails/same-printing-back.webp");
  assert.equal(same.backImage, "images/same-printing-back.png");
  const different = replacePrinting(current, { id: "new-printing", name: "Card", set: "tst", collector_number: "2", type_line: "Artifact", image_uris: { png: "https://cards.scryfall.io/png/front/a/b/new.png" }, card_faces: [{ name: "Card", image_uris: { png: "https://cards.scryfall.io/png/front/a/b/new.png" } }, { name: "Back", image_uris: { png: "https://cards.scryfall.io/png/back/a/b/new.png" } }] });
  assert.equal(different.localImage, "");
  assert.equal(different.localThumbnail, "");
  assert.equal(different.image, "https://cards.scryfall.io/png/front/a/b/new.png");
  assert.equal(different.localBackImage, "");
  assert.equal(different.localBackThumbnail, "");
  assert.equal(different.backImage, "https://cards.scryfall.io/png/back/a/b/new.png");
});

test("prices refresh when missing or older than 24 hours", () => {
  const now = Date.parse("2026-06-22T12:00:00.000Z");
  assert.equal(needsPriceRefresh({ set: "TST", collectorNumber: "1" }, now), true);
  assert.equal(needsPriceRefresh({ set: "TST", collectorNumber: "1", priceUpdatedAt: "2026-06-22T11:00:00.000Z" }, now), false);
  assert.equal(needsPriceRefresh({ set: "TST", collectorNumber: "1", priceUpdatedAt: "2026-06-21T11:59:59.000Z" }, now), true);
  assert.equal(needsPriceRefresh({ set: "TST", collectorNumber: "" }, now), false);
});

test("printing helpers build, filter, and replace versions safely", () => {
  const oracleId = "0bfa4512-e35a-4c93-b324-80ec659f5a97";
  assert.match(decodeURIComponent(buildCardNameSearchUrl("Elspeth")), /name:Elspeth game:paper/);
  assert.match(buildCardNameSearchUrl("Elspeth"), /unique=cards.*order=name/);
  assert.match(buildPrintingsUrl(oracleId), new RegExp(`oracleid%3A${oracleId}.*unique=prints`));
  assert.match(decodeURIComponent(buildPrintingsUrl(oracleId)), /game:paper/);
  assert.match(decodeURIComponent(buildLocalizedNameSearchUrl(oracleId, "zht")), new RegExp(`oracleid:${oracleId} lang:zht game:paper`));
  assert.throws(() => buildPrintingsUrl(null), /Oracle ID/);
  const printings = [
    { id: "alpha", oracle_id: oracleId, name: "Black Vise", set: "lea", set_name: "Limited Edition Alpha", collector_number: "233", type_line: "Artifact", games: ["paper"], digital: false, finishes: ["foil", "nonfoil"], foil: true, nonfoil: true },
    { id: "beta", oracle_id: oracleId, name: "Black Vise", set: "leb", set_name: "Limited Edition Beta", collector_number: "234", type_line: "Artifact", games: ["paper", "mtgo"], digital: false, finishes: ["nonfoil"], foil: false, nonfoil: true },
    { id: "other", oracle_id: "b817bc56-9b4d-4c50-bafa-3c652b99578f", name: "Other", set: "tst", set_name: "Other Set", collector_number: "1", type_line: "Creature", games: ["paper"], digital: false, finishes: ["etched"], foil: false, nonfoil: false },
    { id: "digital", oracle_id: oracleId, name: "Black Vise", set: "ana", set_name: "Arena", collector_number: "1", type_line: "Artifact", games: ["arena"], digital: true, finishes: ["foil"], foil: true, nonfoil: false }
  ];
  assert.equal(isPaperPrinting(printings[0]), true);
  assert.equal(isPaperPrinting(printings[3]), false);
  assert.deepEqual(filterOraclePrintings(printings, oracleId).map((card) => card.id), ["alpha", "beta"]);
  assert.deepEqual(filterPrintings(printings, "").map((card) => card.id), ["alpha", "beta", "other"]);
  assert.deepEqual(filterPrintings(printings, "LEA").map((card) => card.id), ["alpha"]);
  assert.deepEqual(filterPrintings(printings, "234").map((card) => card.id), ["beta"]);
  assert.deepEqual(filterPrintings(printings, "", "foil").map((card) => card.id), ["alpha", "other"]);
  assert.deepEqual(filterPrintings(printings, "LEA", "foil").map((card) => card.id), ["alpha"]);
  assert.deepEqual(filterPrintings(printings, "234", "foil"), []);
  const replaced = replacePrinting({ id: "cube-card", addedAt: "saved-date", finish: "nonfoil" }, printings[1]);
  assert.equal(replaced.id, "cube-card");
  assert.equal(replaced.addedAt, "saved-date");
  assert.equal(replaced.scryfallId, "beta");
  assert.equal(replaced.set, "LEB");
  assert.equal(replaced.collectorNumber, "234");
  assert.equal(replaced.finish, "nonfoil");
  assert.equal(replacePrinting({ id: "cube-card", finish: "nonfoil" }, printings[0], "foil").finish, "foil");
});

test("reversible paper cards use the front face Oracle ID", () => {
  const oracleId = "0bfa4512-e35a-4c93-b324-80ec659f5a97";
  const reversible = {
    id: "82fa24fb-aecc-4c33-9e79-c29651ddafbe",
    name: "Ulamog, the Ceaseless Hunger // Ulamog, the Ceaseless Hunger",
    oracle_id: null,
    layout: "reversible_card",
    set: "sld",
    collector_number: "1122",
    games: ["paper"],
    digital: false,
    card_faces: [
      { name: "Ulamog, the Ceaseless Hunger", oracle_id: oracleId },
      { name: "Ulamog, the Ceaseless Hunger", oracle_id: oracleId }
    ]
  };
  assert.equal(getOracleId(reversible), oracleId);
  assert.equal(normalizeScryfallCard(reversible).oracleId, oracleId);
  assert.deepEqual(filterOraclePrintings([reversible], oracleId), [reversible]);
  assert.equal(getOracleId({ oracleId: "undefined" }), "");
});

test("parseExcelRows detects headers and keeps identifiers as text", () => {
  assert.deepEqual(parseExcelRows([
    ["系列", "编号", "卡牌名称"],
    ["lea", "001", "Black Vise"],
    ["2X2", 361, "Lightning Bolt"],
    ["", "", ""]
  ]), [
    { rowNumber: 2, setCode: "LEA", collectorNumber: "001", expectedName: "Black Vise", finish: "foil", JapanPrint: false },
    { rowNumber: 3, setCode: "2X2", collectorNumber: "361", expectedName: "Lightning Bolt", finish: "foil", JapanPrint: false }
  ]);
  assert.equal(normalizeCardName("  Urza’s   Saga "), "urza's saga");
  assert.equal(getLookupName("Ulamog, the Ceaseless Hunger // Ulamog, the Ceaseless Hunger"), "Ulamog, the Ceaseless Hunger");
  assert.equal(getLookupName("Lightning Bolt"), "Lightning Bolt");
  assert.equal(getFrontDisplayName("Treasure Map // Treasure Cove"), "Treasure Map");
  assert.equal(getFrontDisplayName("Barkchannel Pathway//Tidechannel Pathway"), "Barkchannel Pathway");
  assert.equal(getFrontDisplayName("藏宝图 // 宝藏海湾"), "藏宝图");
});

test("buildExcelRows exports a re-importable table with finish and price", () => {
  const rows = buildExcelRows([
    { id: "treasure", set: "XLN", collectorNumber: "250", name: "Treasure Map // Treasure Cove", localizedNames: { zhs: "藏宝图" }, finish: "foil", JapanPrint: true, prices: { usd: "0.55", usdFoil: "0.73" }, priceUpdatedAt: "2026-07-08T00:00:00.000Z", scryfallId: "treasure-id", localImage: "images/xln-250-treasure-map.png", localBackImage: "images/xln-250-treasure-map-back.png" },
    { id: "vise", set: "LEA", collectorNumber: "233", name: "Black Vise", finish: "nonfoil", prices: { usd: "25.00", usdFoil: "" } }
  ], {
    byCardId: {
      treasure: { previousPrice: "0.70", priceDelta: "0.03", pricePercent: "4.29%", imageStatus: "完整" },
      vise: { imageStatus: "缺正面图" }
    }
  });
  assert.deepEqual(rows[0], ["系列", "编号", "卡牌名称", "闪卡状态", "美元价格", "日印", "中文名", "上次价格", "价格变化", "变化百分比", "价格更新时间", "Scryfall ID", "本地正面图", "本地背面图", "图片状态"]);
  assert.deepEqual(rows[1], ["XLN", "250", "Treasure Map // Treasure Cove", "Foil", "0.73", "是", "藏宝图", "0.70", "0.03", "4.29%", "2026-07-08T00:00:00.000Z", "treasure-id", "images/xln-250-treasure-map.png", "images/xln-250-treasure-map-back.png", "完整"]);
  assert.deepEqual(rows[2].slice(0, 7), ["LEA", "233", "Black Vise", "Non-Foil", "25.00", "", ""]);
  assert.equal(rows[2][14], "缺正面图");
  assert.deepEqual(parseExcelRows(rows).map(({ setCode, collectorNumber, expectedName, finish, JapanPrint }) => ({ setCode, collectorNumber, expectedName, finish, JapanPrint })), [
    { setCode: "XLN", collectorNumber: "250", expectedName: "Treasure Map // Treasure Cove", finish: "foil", JapanPrint: true },
    { setCode: "LEA", collectorNumber: "233", expectedName: "Black Vise", finish: "nonfoil", JapanPrint: false }
  ]);
});

test("JSON backups preserve the complete Cube and accept legacy exports", () => {
  const data = { meta: { id: "cube-test", name: "Test Cube", description: "Desc" }, notes: "Notes", cards: [{ id: "1", name: "Black Vise", finish: "nonfoil" }], basicLands: [{ id: "2", name: "Plains", finish: "foil" }] };
  const priceHistory = { cubeId: "cube-test", snapshots: { "2026-06-22": { totalUsd: 25 } } };
  const changeLog = { cubeId: "cube-test", entries: [{ id: "log-1" }] };
  const backup = buildBackup(data, { exportedAt: "2026-06-22T00:00:00.000Z", priceHistory, changeLog });
  assert.equal(backup.version, 3);
  assert.equal(backup.dataVersion, CURRENT_DATA_VERSION);
  assert.deepEqual(parseBackup(JSON.stringify(backup)), {
    version: 3,
    cubeData: data,
    priceHistoryData: priceHistory,
    changeLogData: changeLog
  });
  const migratedLegacy = parseBackup(JSON.stringify({ ...data, format: "arcana-cube-v1" }));
  assert.equal(migratedLegacy.cubeData.cards[0].name, "Black Vise");
  assert.equal(migratedLegacy.cubeData.cards[0].JapanPrint, false);
  assert.equal(migratedLegacy.cubeData.cards[0].localThumbnail, "");
  assert.equal(migratedLegacy.priceHistoryData, null);
  assert.equal(migratedLegacy.changeLogData, null);
  const versionTwo = parseBackup(JSON.stringify({ format: "arcana-cube-backup", version: 2, dataVersion: CURRENT_DATA_VERSION, data }));
  assert.deepEqual(versionTwo.cubeData, data);
  assert.equal(versionTwo.priceHistoryData, null);
  assert.throws(() => parseBackup({
    ...data,
    cards: [{ id: "printing-a", name: "Lightning Bolt", oracleId: "oracle-bolt" }, { id: "printing-b", name: "Lightning Bolt", oracleId: "oracle-bolt" }]
  }), /严格单例/);
  assert.throws(() => parseBackup({ ...data, cards: [{ name: "Missing ID" }] }), /内部 ID/);
  assert.throws(() => parseBackup('{"not":"a cube"}'), /有效/);
});
