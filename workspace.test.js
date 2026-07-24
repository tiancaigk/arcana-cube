const test = require("node:test");
const assert = require("node:assert/strict");
const { createWorkspaceService } = require("./workspace.js");

class MemoryFileHandle {
  constructor(name) {
    this.kind = "file";
    this.name = name;
    this.value = new Blob([]);
  }

  async getFile() {
    return this.value;
  }

  async createWritable() {
    return {
      write: async (value) => { this.value = value instanceof Blob ? value : new Blob([value]); },
      close: async () => {},
      abort: async () => {}
    };
  }
}

class MemoryDirectoryHandle {
  constructor(name = "Cube") {
    this.kind = "directory";
    this.name = name;
    this.entriesByName = new Map();
    this.permission = "prompt";
  }

  async queryPermission() { return this.permission; }
  async requestPermission() { this.permission = "granted"; return this.permission; }

  async getFileHandle(name, options = {}) {
    const existing = this.entriesByName.get(name);
    if (existing && existing.kind === "file") return existing;
    if (!options.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    const handle = new MemoryFileHandle(name);
    this.entriesByName.set(name, handle);
    return handle;
  }

  async getDirectoryHandle(name, options = {}) {
    const existing = this.entriesByName.get(name);
    if (existing && existing.kind === "directory") return existing;
    if (!options.create) throw Object.assign(new Error("missing"), { name: "NotFoundError" });
    const handle = new MemoryDirectoryHandle(name);
    this.entriesByName.set(name, handle);
    return handle;
  }

  async *entries() {
    yield* this.entriesByName.entries();
  }
}

function createService() {
  const wrap = (format) => (data) => ({ format, data });
  const parse = (format) => (text) => {
    const payload = JSON.parse(text);
    if (payload.format !== format) throw new Error("bad format");
    return payload.data;
  };
  return createWorkspaceService({
    cubeFileName: "cube-data.json",
    priceHistoryFileName: "price-history.json",
    changeLogFileName: "change-log.json",
    imageDirName: "images",
    thumbnailDirName: "thumbnails",
    wrapCube: wrap("cube"),
    parseCube: parse("cube"),
    wrapPriceHistory: wrap("prices"),
    parsePriceHistory: parse("prices"),
    emptyPriceHistory: () => ({ snapshots: {} }),
    wrapChangeLog: wrap("changes"),
    parseChangeLog: parse("changes"),
    emptyChangeLog: () => ({ entries: [] })
  });
}

test("workspace service round-trips each JSON domain independently", async () => {
  const directory = new MemoryDirectoryHandle();
  const workspace = createService();
  assert.equal(await workspace.readCube(directory), null);
  assert.equal(await workspace.readPriceHistory(directory), null);
  assert.equal(await workspace.readChangeLog(directory), null);

  await workspace.writeCube(directory, { cards: [1] });
  await workspace.writePriceHistory(directory, { snapshots: { date: {} } });
  await workspace.writeChangeLog(directory, { entries: [1] });

  assert.deepEqual(await workspace.readCube(directory), { cards: [1] });
  assert.deepEqual(await workspace.readPriceHistory(directory), { snapshots: { date: {} } });
  assert.deepEqual(await workspace.readChangeLog(directory), { entries: [1] });
});

test("workspace service handles permissions and local image files", async () => {
  const directory = new MemoryDirectoryHandle();
  const workspace = createService();
  assert.equal(await workspace.queryPermission(directory, "read"), "prompt");
  assert.equal(await workspace.requestPermission(directory, "readwrite"), true);

  await workspace.writeFile(directory, "images/card.png", new Blob(["original"], { type: "image/png" }));
  await workspace.writeFile(directory, "images/thumbnails/card.webp", new Blob(["thumbnail"], { type: "image/webp" }));
  await workspace.writeFile(directory, "images/notes.txt", new Blob(["ignored"]));

  assert.equal(await workspace.fileExists(directory, "images/card.png"), true);
  assert.equal(await workspace.fileExists(directory, "images/missing.png"), false);
  assert.equal(await (await workspace.readFile(directory, "images/card.png")).text(), "original");
  assert.deepEqual(await workspace.listImageFiles(directory), {
    originalFiles: ["images/card.png"],
    thumbnailFiles: ["images/thumbnails/card.webp"]
  });
});

test("workspace service rejects paths outside the configured image directory", async () => {
  const workspace = createService();
  const directory = new MemoryDirectoryHandle();
  await assert.rejects(() => workspace.writeFile(directory, "../cube-data.json", new Blob([])), /图片路径/);
});

test("workspace service aborts a writable stream after a failed write", async () => {
  const workspace = createService();
  let aborted = false;
  const directory = new MemoryDirectoryHandle();
  directory.entriesByName.set("cube-data.json", {
    kind: "file",
    async createWritable() {
      return {
        async write() { throw new Error("disk full"); },
        async close() {},
        async abort() { aborted = true; }
      };
    }
  });
  await assert.rejects(() => workspace.writeCube(directory, { cards: [] }), /disk full/);
  assert.equal(aborted, true);
});

module.exports = { MemoryDirectoryHandle };
