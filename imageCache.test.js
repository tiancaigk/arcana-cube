const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("./core.js");
const { createImageCache, preferPngImageUrl } = require("./imageCache.js");

function createHarness(overrides = {}) {
  const files = new Map();
  const writes = [];
  let fetchCount = 0;
  const workspace = {
    fileExists: async (_directory, path) => files.has(path),
    readFile: async (_directory, path) => files.get(path),
    writeFile: async (_directory, path, blob) => { files.set(path, blob); writes.push(path); }
  };
  const cache = createImageCache({
    workspace,
    getDirectoryHandle: () => ({ name: "Cube" }),
    fetchImpl: async (url) => {
      fetchCount += 1;
      return { ok: true, status: 200, blob: async () => new Blob([url], { type: "image/png" }) };
    },
    mapFetchUrl: (url) => url,
    buildFileName: core.buildLocalImageFileName,
    createThumbnail: async () => new Blob(["thumbnail"], { type: "image/webp" }),
    imageDirName: "images",
    thumbnailDirName: "thumbnails",
    timeoutMs: 100,
    ...overrides
  });
  return { cache, files, writes, getFetchCount: () => fetchCount };
}

function card(fields = {}) {
  return {
    id: "card",
    scryfallId: "printing",
    name: "Black Vise",
    set: "LEA",
    collectorNumber: "126★",
    image: "https://cards.scryfall.io/normal/front/a/b/card.jpg",
    remoteImage: "https://cards.scryfall.io/normal/front/a/b/card.jpg",
    localImage: "",
    localThumbnail: "",
    backImage: "",
    remoteBackImage: "",
    localBackImage: "",
    localBackThumbnail: "",
    ...fields
  };
}

test("image cache prefers Scryfall PNG URLs", () => {
  assert.equal(preferPngImageUrl("https://cards.scryfall.io/normal/front/a/b/card.jpg?1"), "https://cards.scryfall.io/png/front/a/b/card.png?1");
  assert.equal(preferPngImageUrl("https://example.com/card.jpg"), "https://example.com/card.jpg");
});

test("image cache stores exact-number originals and WebP thumbnails", async () => {
  const { cache, files, writes } = createHarness();
  const target = card();
  const result = await cache.cacheCard(target);
  assert.equal(result.status, "updated");
  assert.equal(target.localImage, "images/lea-126★-black-vise.png");
  assert.equal(target.localThumbnail, "images/thumbnails/lea-126★-black-vise.webp");
  assert.deepEqual(writes, ["images/lea-126★-black-vise.png", "images/thumbnails/lea-126★-black-vise.webp"]);
  assert.equal(files.get(target.localImage).type, "image/png");
});

test("image cache reuses an original and only creates its missing thumbnail", async () => {
  const target = card({ localImage: "images/lea-126★-black-vise.png", image: "images/lea-126★-black-vise.png" });
  const { cache, files, getFetchCount } = createHarness();
  files.set(target.localImage, new Blob(["original"], { type: "image/png" }));
  const result = await cache.cacheCard(target);
  assert.equal(result.status, "updated");
  assert.equal(getFetchCount(), 0);
  assert.equal(files.has("images/thumbnails/lea-126★-black-vise.webp"), true);
});

test("thumbnail failure preserves a newly downloaded original", async () => {
  const target = card();
  const { cache, files } = createHarness({ createThumbnail: async () => { throw new Error("thumbnail failed"); } });
  const result = await cache.cacheCard(target);
  assert.equal(result.status, "updated");
  assert.equal(result.errors.length, 1);
  assert.equal(files.has("images/lea-126★-black-vise.png"), true);
  assert.equal(target.localImage, "images/lea-126★-black-vise.png");
  assert.equal(target.localThumbnail, "");
});

test("image cache processes cards concurrently while reporting ordered progress", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const progress = [];
  const { cache } = createHarness({
    fetchImpl: async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { ok: true, status: 200, blob: async () => new Blob([url], { type: "image/png" }) };
    }
  });
  const cards = Array.from({ length: 6 }, (_value, index) => card({
    id: `card-${index}`,
    scryfallId: `printing-${index}`,
    collectorNumber: String(126 + index),
    ...(index === 0 ? { remoteBackImage: "https://cards.scryfall.io/png/back/a/b/card.png", backImage: "https://cards.scryfall.io/png/back/a/b/card.png" } : {})
  }));
  const checkpoints = [];
  const result = await cache.cacheAll(cards, {
    checkpointEvery: 2,
    onProgress: (entry) => progress.push(entry.index),
    checkpoint: (entry) => checkpoints.push(entry.updated)
  });
  assert.equal(result.total, 6);
  assert.equal(result.updated, 6);
  assert.deepEqual(progress, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(checkpoints, [2, 4, 6]);
  assert.equal(maxInFlight, 3);
  assert.equal(cards[0].localBackImage.endsWith("-back.png"), true);
  assert.equal(cards[0].localBackThumbnail.endsWith("-back.webp"), true);
});

test("empty image responses fail without creating a local path", async () => {
  const target = card();
  const { cache } = createHarness({ fetchImpl: async () => ({ ok: true, status: 200, blob: async () => new Blob([]) }) });
  const result = await cache.cacheAll([target]);
  assert.equal(result.failed, 1);
  assert.equal(target.localImage, "");
});
