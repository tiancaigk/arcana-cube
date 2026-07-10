const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeWorkspaceHealth } = require("./health.js");

test("workspace health reports missing and orphan image files without changing input", () => {
  const cards = [{
    id: "card-1",
    scryfallId: "printing-1",
    oracleId: "oracle-1",
    name: "Front // Back",
    finish: "foil",
    prices: { usdFoil: "2.50" },
    localImage: "images/front.png",
    localThumbnail: "images/thumbnails/front.webp",
    localBackImage: "images/back.png",
    localBackThumbnail: "images/thumbnails/back.webp"
  }];
  const original = JSON.stringify(cards);
  const result = analyzeWorkspaceHealth({
    cards,
    originalFiles: ["images/front.png", "images/orphan.png"],
    thumbnailFiles: ["images/thumbnails/orphan.webp"]
  });

  assert.equal(JSON.stringify(cards), original);
  assert.deepEqual(result.summary, {
    cards: 1,
    originalFiles: 2,
    thumbnailFiles: 1,
    errors: 1,
    warnings: 1,
    info: 2
  });
  assert.equal(result.issues.find((issue) => issue.code === "missing-originals").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "missing-thumbnails").count, 2);
  assert.equal(result.issues.find((issue) => issue.code === "orphan-originals").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "orphan-thumbnails").count, 1);
});

test("workspace health identifies duplicate references and incomplete card records", () => {
  const sharedImage = "images/shared.png";
  const result = analyzeWorkspaceHealth({
    cards: [
      { id: "same", name: "Complete", scryfallId: "printing", oracleId: "oracle", finish: "nonfoil", prices: { usd: "1.00" }, localImage: sharedImage },
      { id: "same", name: "", finish: "foil", prices: {}, localImage: sharedImage }
    ],
    originalFiles: [sharedImage],
    thumbnailFiles: []
  });

  assert.equal(result.issues.find((issue) => issue.code === "duplicate-card-ids").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "duplicate-image-references").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "invalid-cards").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "missing-scryfall-identifiers").count, 1);
  assert.equal(result.issues.find((issue) => issue.code === "missing-selected-prices").count, 1);
});

test("workspace health returns a clean result for a complete folder", () => {
  const result = analyzeWorkspaceHealth({
    cards: [{ id: "card", name: "Card", scryfallId: "printing", oracleId: "oracle", finish: "foil", prices: { usdFoil: "3.00" }, localImage: "images/card.png", localThumbnail: "images/thumbnails/card.webp" }],
    originalFiles: ["images/card.png"],
    thumbnailFiles: ["images/thumbnails/card.webp"]
  });
  assert.equal(result.healthy, true);
  assert.deepEqual(result.issues, []);
});
