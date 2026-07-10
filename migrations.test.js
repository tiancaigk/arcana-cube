const test = require("node:test");
const assert = require("node:assert/strict");
const { CURRENT_DATA_VERSION, migrateCubeData } = require("./migrations.js");

test("version 0 Cube data migrates image and collection fields without mutation", () => {
  const legacy = {
    meta: { name: "Legacy Cube" },
    cards: [{
      id: "card-1",
      name: "Card",
      collectorNumber: "126★",
      image: "images/tst-126★-card.png",
      backImage: "https://cards.scryfall.io/png/back/a/b/card.png",
      finish: "nonfoil"
    }]
  };
  const before = JSON.stringify(legacy);
  const migrated = migrateCubeData(legacy, 0);

  assert.equal(JSON.stringify(legacy), before);
  assert.notEqual(migrated, legacy);
  assert.equal(migrated.notes, "");
  assert.equal(migrated.cards[0].collectorNumber, "126★");
  assert.equal(migrated.cards[0].JapanPrint, false);
  assert.equal(migrated.cards[0].localImage, "images/tst-126★-card.png");
  assert.equal(migrated.cards[0].localThumbnail, "");
  assert.equal(migrated.cards[0].remoteBackImage, "https://cards.scryfall.io/png/back/a/b/card.png");
  assert.equal(migrated.cards[0].localBackThumbnail, "");
  assert.deepEqual(migrated.cards[0].localizedNames, {});
  assert.deepEqual(migrated.cards[0].prices, {});
});

test("current data migration is idempotent and future versions are rejected", () => {
  const current = { meta: { name: "Current" }, notes: "", cards: [] };
  assert.deepEqual(migrateCubeData(migrateCubeData(current, 0), CURRENT_DATA_VERSION), migrateCubeData(current, 0));
  assert.throws(() => migrateCubeData(current, CURRENT_DATA_VERSION + 1), /较新版本/);
});
