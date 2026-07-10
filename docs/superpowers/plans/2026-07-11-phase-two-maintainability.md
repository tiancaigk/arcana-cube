# Arcana Cube Phase Two Maintainability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Arcana Cube's browser, persistence, catalog, image, derived-data, and rendering responsibilities into tested modules while preserving its UI and portable workspace format.

**Architecture:** `app.js` remains the composition root and delegates to UMD modules that also export through CommonJS for Node tests. State mutations increment data/history revisions, persistence writes only dirty domains, selectors build indexed view data, and a scoped scheduler merges DOM work.

**Tech Stack:** Browser-native JavaScript, HTML, CSS, File System Access API, Canvas, Node.js built-in test runner, existing Scryfall transport.

## Global Constraints

- Keep the current visual UI and visible copy unchanged.
- Keep `dataVersion` at `1`.
- Do not change JSON envelopes, Excel columns, image names, thumbnail paths, or Scryfall's 100 ms request interval.
- Do not add runtime dependencies, a bundler, a framework, or TypeScript.
- Never read, write, stage, or commit the ignored real runtime data during automated tests.
- Run `npm run check` and `npm test` before every commit.
- Implement on branch `codex/phase-2-maintainability` based on the approved design commit.

---

### Task 1: Deterministic Large-Cube Regression Fixtures

**Files:**
- Create: `testFixtures.js`
- Create: `testFixtures.test.js`

**Interfaces:**
- Produces: `buildCards(count = 600): Card[]`
- Produces: `buildPriceHistory(cards, days = 180): PriceHistory`

- [ ] **Step 1: Write the failing fixture tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCards, buildPriceHistory } = require("./testFixtures.js");

test("large Cube fixtures are deterministic and contain all display buckets", () => {
  const first = buildCards(600);
  const second = buildCards(600);
  assert.deepEqual(first, second);
  assert.equal(first.length, 600);
  assert.deepEqual(new Set(first.map((card) => card.bucket)), new Set(["W", "U", "B", "R", "G", "C", "M", "L"]));
});

test("price fixture creates one snapshot per requested day", () => {
  const cards = buildCards(600);
  const history = buildPriceHistory(cards, 180);
  assert.equal(Object.keys(history.snapshots).length, 180);
  assert.equal(Object.keys(history.snapshots[Object.keys(history.snapshots)[0]].cards).length, 600);
});
```

- [ ] **Step 2: Run `node --test testFixtures.test.js` and verify it fails because `testFixtures.js` does not exist**

- [ ] **Step 3: Implement deterministic builders**

Use fixed dates, IDs, colors, types, finishes, sets, collector numbers, and prices. Do not call `Date.now()`, `Math.random()`, the network, or the filesystem. Build price snapshot keys with `cardPriceKey` from `priceHistory.js`.

- [ ] **Step 4: Run `node --test testFixtures.test.js`, `npm run check`, and `npm test`; expect all tests to pass**

- [ ] **Step 5: Commit**

```bash
git add testFixtures.js testFixtures.test.js
git commit -m "Add large Cube regression fixtures"
```

### Task 2: Workspace File Service

**Files:**
- Create: `workspace.js`
- Create: `workspace.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Produces: `createWorkspaceService(options): WorkspaceService`
- `WorkspaceService` methods: `queryPermission`, `requestPermission`, `readCube`, `writeCube`, `readPriceHistory`, `writePriceHistory`, `readChangeLog`, `writeChangeLog`, `getImagesDirectory`, `getThumbnailsDirectory`, `fileExists`, `readFile`, `writeFile`, `listImageFiles`

- [ ] **Step 1: Write failing tests with in-memory fake file and directory handles**

Test JSON round trips, missing files returning configured defaults, write preservation, nested thumbnail enumeration, and permission results. Assert `listImageFiles()` returns `{ originalFiles, thumbnailFiles }` and ignores non-image files.

- [ ] **Step 2: Run `node --test workspace.test.js`; expect a missing-module failure**

- [ ] **Step 3: Implement `workspace.js` as a UMD module**

Use the same UMD wrapper as `storage.js`, exporting exactly `{ createWorkspaceService }` through both `module.exports` and `window.CubeWorkspace`. Validate the required parser, wrapper, filename, and default-value options when the service is created. All serializers, parsers, filenames, and missing-entry defaults come from `options`. The module does not access application state or DOM elements.

- [ ] **Step 4: Load `workspace.js` before `app.js`, update dependency-order tests, and add it to `npm run check`**

- [ ] **Step 5: Replace the directory/file helper block in `app.js` with one configured `workspace` instance**

Keep the existing app-level orchestration, confirmation dialogs, toasts, and state transitions. Route image file reads/writes and health enumeration through the service.

- [ ] **Step 6: Run focused tests, full checks, and browser smoke for folder controls**

```bash
node --test workspace.test.js app.integration.test.js
npm run check
npm test
```

- [ ] **Step 7: Commit**

```bash
git add workspace.js workspace.test.js app.js index.html app.integration.test.js package.json
git commit -m "Extract workspace file service"
```

### Task 3: Dirty-Domain Persistence Coordinator

**Files:**
- Create: `persistence.js`
- Create: `persistence.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Produces: `createPersistenceCoordinator(options)`
- Coordinator methods: `markDirty(domain, snapshot)`, `scheduleDirty(domain, snapshot, delayMs)`, `flush()`, `flushBrowserSync()`, `hasDirty(domain?)`, `clearDirectory()`
- Supported domains: `cube`, `priceHistory`, `changeLog`

- [ ] **Step 1: Write failing coordinator tests**

Cover domain isolation, latest-snapshot coalescing, serial ordering, 400 ms scheduled writes with an injected timer, synchronous browser recovery, flush promotion of delayed work, and failure preserving dirty state.

```js
test("twenty scheduled Cube changes coalesce without writing other domains", async () => {
  for (let index = 0; index < 20; index += 1) coordinator.scheduleDirty("cube", { revision: index }, 400);
  timers.runAll();
  await coordinator.flush();
  assert.deepEqual(writes.cube, [{ revision: 19 }]);
  assert.deepEqual(writes.priceHistory, []);
  assert.deepEqual(writes.changeLog, []);
});
```

- [ ] **Step 2: Run `node --test persistence.test.js`; expect a missing-module failure**

- [ ] **Step 3: Implement the coordinator with injected browser writers, directory writers, directory-handle getter, timer functions, and error callback**

Use a `Map` for the latest pending snapshot per domain and one drain promise. Never allow an older in-flight snapshot to replace a newer pending snapshot.

- [ ] **Step 4: Load the module and replace `saveState()` with explicit domain marking helpers**

Add app helpers `persistCube()`, `persistPriceHistory()`, `persistChangeLog()`, and `persistAll()`. Preserve the existing calls' behavioral domains. Notes call `scheduleDirty("cube", snapshot, 400)` and flush on blur. Add `pagehide` to call `flushBrowserSync()`.

- [ ] **Step 5: Require `flush()` before sync, reload, folder replacement, and disconnect**

Retain the current dirty indicator and success/error toasts. Directory failure continues browser-only operation and leaves recoverable browser data.

- [ ] **Step 6: Run all tests and browser smoke add/delete/notes/manual sync/reload/disconnect**

- [ ] **Step 7: Commit**

```bash
git add persistence.js persistence.test.js app.js index.html app.integration.test.js package.json
git commit -m "Coalesce workspace persistence"
```

### Task 4: Scryfall Catalog Service

**Files:**
- Create: `catalog.js`
- Create: `catalog.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Produces: `createCatalog({ requestJson, core }): Catalog`
- Catalog methods: `lookupNamed`, `searchByName`, `lookupPrinting`, `lookupById`, `resolvePrintingIdentity`, `lookupAllPrintings`, `lookupPrintingBatch`, `lookupCardNameBatch`, `clearPrintingCache`

- [ ] **Step 1: Write failing tests**

Use an injected request function to test paper-only search, pagination, repeated-page rejection, exact-printing 404 translation, 75-item collection batching, normalized keys, Oracle caching, and abort propagation.

- [ ] **Step 2: Run `node --test catalog.test.js`; expect a missing-module failure**

- [ ] **Step 3: Implement the UMD catalog service**

The service owns its `Map` printing cache and uses existing core helpers. It does not save cards, display toasts, or mutate application state.

- [ ] **Step 4: Load and configure `catalog.js`, then replace high-level Scryfall functions in `app.js`**

Keep controllers, request IDs, UI state, and Chinese user feedback in `app.js`. Save a newly resolved Oracle ID through the normal Cube persistence path.

- [ ] **Step 5: Run focused/full tests and browser smoke name search, exact lookup, and version dialog**

- [ ] **Step 6: Commit**

```bash
git add catalog.js catalog.test.js app.js index.html app.integration.test.js package.json
git commit -m "Extract Scryfall catalog service"
```

### Task 5: Local Image Cache Service

**Files:**
- Create: `imageCache.js`
- Create: `imageCache.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Produces: `createImageCache(options): ImageCache`
- ImageCache methods: `cacheCard(card)`, `cacheAll(cards, { onProgress, checkpoint })`
- Result shape: `{ updated, skipped, missing, failed, total, errors }`

- [ ] **Step 1: Write failing tests with injected fetch, bitmap-to-thumbnail adapter, and workspace service**

Cover PNG preference, fallback URL, empty-blob rejection, original reuse, thumbnail reuse, exact `126★` naming, front/back faces, original preservation after thumbnail failure, progress counts, and sequential processing.

- [ ] **Step 2: Run `node --test imageCache.test.js`; expect a missing-module failure**

- [ ] **Step 3: Move image candidate, download, extension, thumbnail, and per-face caching logic into the UMD module**

The module mutates only the supplied card's documented image fields. Thumbnail failure records an error but does not remove a successfully stored original.

- [ ] **Step 4: Configure the service in `app.js` with Canvas/CreateImageBitmap and workspace adapters**

Keep permission checks, button state, progress text, change-log entry, checkpoints, final persistence, render, and toast text unchanged.

- [ ] **Step 5: Run focused/full tests and browser smoke local image completion plus large preview**

- [ ] **Step 6: Commit**

```bash
git add imageCache.js imageCache.test.js app.js index.html app.integration.test.js package.json
git commit -m "Extract local image cache service"
```

### Task 6: Indexed Derived View Data

**Files:**
- Modify: `priceHistory.js`
- Modify: `priceHistory.test.js`
- Create: `selectors.js`
- Create: `selectors.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Price history produces: `buildPriceTrendIndex(history): { byKey: Map, totalTrend, totalSeries }`
- Selectors produce: `createCubeSelectors(core, priceHistory)` with `selectCards`, `selectStats`, `selectAnalytics`, `selectPriceView`, `cardById`

- [ ] **Step 1: Write failing price-index tests**

Assert one pass over 180 snapshots produces the same trends as `priceTrend(cardSeries(...))` for foil and nonfoil keys and the same total trend as `priceTrend(totalSeries(...))`.

- [ ] **Step 2: Implement `buildPriceTrendIndex` in `priceHistory.js` and run its focused tests**

Retain only the latest two valid points per card-price key while walking sorted snapshots.

- [ ] **Step 3: Write failing selector tests using 600-card fixtures**

Assert stable filtering/grouping/statistics, cache reuse for identical revisions, invalidation on data/history revision changes, and map lookup for card trends.

- [ ] **Step 4: Implement `selectors.js`, load it, and add revision counters to app state**

Increment `dataRevision` after card/meta/note changes and `historyRevision` after history changes. Replace repeated render-time sorting, statistics, and per-card history scans with selector results.

- [ ] **Step 5: Run all tests and browser smoke filters, analytics, price arrows, and history dialogs**

- [ ] **Step 6: Commit**

```bash
git add priceHistory.js priceHistory.test.js selectors.js selectors.test.js app.js index.html app.integration.test.js package.json
git commit -m "Index Cube view data"
```

### Task 7: Scoped Application Rendering

**Files:**
- Create: `renderScheduler.js`
- Create: `renderScheduler.test.js`
- Modify: `index.html`
- Modify: `app.integration.test.js`
- Modify: `package.json`
- Modify: `app.js`

**Interfaces:**
- Produces: `createRenderScheduler(renderers, options)`
- Scheduler methods: `request(...scopes)`, `flush()`
- Scopes: `meta`, `stats`, `nameLanguage`, `cards`, `analytics`, `storage`

- [ ] **Step 1: Write failing scheduler tests**

Assert duplicate scope merging, fixed scope order, microtask coalescing, explicit flush, and unknown-scope rejection.

- [ ] **Step 2: Implement the scheduler and load it before `app.js`**

- [ ] **Step 3: Replace broad `render()` calls with exact scope requests**

Keep a `renderAll()` wrapper for startup, restore, import, and fallback paths. Implement `replaceCardNode(cardId)` for finish/Japan-print changes and fall back to cards scope if the node is missing or the active filter excludes the changed card.

- [ ] **Step 4: Coalesce search input rendering through `requestAnimationFrame` and use one capturing image-error listener**

Do not add a long search debounce. Preserve immediate keyboard feel.

- [ ] **Step 5: Add integration assertions for scheduler script order and source-level absence of per-render image listener binding**

- [ ] **Step 6: Run focused tests, full checks, and complete browser regression**

Verify add, delete/undo, filters, view mode, language, finish, Japan print, printing replacement, import, restore, price refresh/history, image cache/preview, health check, folder sync/reload/disconnect, and console errors.

- [ ] **Step 7: Commit**

```bash
git add renderScheduler.js renderScheduler.test.js app.js index.html app.integration.test.js package.json
git commit -m "Add scoped application rendering"
```

### Task 8: Architecture Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Create: `docs/architecture.md`

**Interfaces:**
- Documents the final module ownership, persistence domains, render scopes, and verification workflow.

- [ ] **Step 1: Update README module and testing guidance without changing user workflow instructions**

- [ ] **Step 2: Write `docs/architecture.md` with module table, data flow, dirty-domain semantics, render invalidation rules, and extension guidance**

- [ ] **Step 3: Run final automated verification**

```bash
npm run check
npm test
git diff --check
git status --short
```

Expected: syntax checks pass, all tests pass, no whitespace errors, and only intended documentation files remain modified.

- [ ] **Step 4: Run final browser verification at `http://127.0.0.1:4173/` and confirm no console errors**

- [ ] **Step 5: Confirm ignored runtime data remains ignored**

```bash
git check-ignore -v cube-data.json price-history.json change-log.json images product-design-audit
```

- [ ] **Step 6: Commit**

```bash
git add README.md docs/architecture.md
git commit -m "Document phase two architecture"
```
