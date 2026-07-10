# Arcana Cube Phase Two Maintainability Design

**Date:** 2026-07-11

**Status:** Proposed for implementation planning

## Objective

Phase two improves Arcana Cube's internal maintainability and long-term performance without redesigning the UI or changing the portable workspace format. The work extracts browser and network responsibilities from `app.js`, prevents unrelated persistence writes, indexes derived data, and limits rendering to the parts of the page affected by an action.

The implementation remains a dependency-free, browser-native HTML/CSS/JavaScript application. It continues to run through `npm run serve` and keeps the current UMD-style modules exposed through `window.Cube*` globals in the browser and `module.exports` in Node tests.

## Current Constraints

- `app.js` is approximately 2,478 lines and owns state, rendering, File System Access operations, image caching, Scryfall workflows, import/export coordination, and event binding.
- The active Cube contains approximately 600 cards, 651 original image files, and 625 thumbnails.
- Card filtering rebuilds the full visible card DOM.
- Per-card rendering repeatedly derives price series from the complete price history.
- `saveState()` persists Cube data, price history, and change log together, even when only one domain changed.
- Notes input can trigger persistence on every keystroke.
- Existing workspace files and browser storage must remain readable throughout the migration.

## Goals

1. Give filesystem, persistence, Scryfall catalog, image cache, derived-data, and rendering responsibilities explicit module boundaries.
2. Preserve every current user-facing workflow and the current UI appearance.
3. Keep `cube-data.json`, `price-history.json`, `change-log.json`, Excel exports, image names, and thumbnail names compatible.
4. Prevent writes to unrelated persistence domains.
5. Avoid repeated full price-history scans during card rendering.
6. Avoid rebuilding all 600 card nodes for simple per-card state changes.
7. Make each change independently testable, reviewable, and revertible through Git.

## Non-Goals

- No React, Vue, build system, package bundler, or TypeScript migration.
- No UI redesign or layout changes.
- No IndexedDB migration for price history.
- No multi-Cube management, cloud synchronization, tags, deck archetypes, or automatic orphan-file deletion.
- No workspace schema change; `dataVersion` remains `1` unless implementation uncovers a genuine stored-data requirement and receives separate approval.
- No change to Scryfall's 100 ms minimum request interval.

## Chosen Approach

Use incremental extraction followed by targeted performance changes. Each extraction first preserves behavior behind a tested interface. Optimization is introduced only after the relevant responsibility has a stable boundary.

This is preferred over isolated patches because patches would leave the monolithic ownership problem intact. A framework rewrite is rejected because its regression surface is disproportionate to the project's current needs.

## Architecture

```text
DOM events
   |
   v
app.js command orchestration
   |---------------------> catalog.js ---------> scryfall.js
   |---------------------> imageCache.js ------> workspace.js
   |---------------------> persistence.js -----> workspace.js / localStorage
   |
   v
in-memory state + revision counters
   |
   v
selectors.js derived view data
   |
   v
scoped render scheduler
   |
   v
meta / stats / cards / analytics / storage DOM regions
```

`app.js` remains the composition root. It creates services, owns transient UI state, translates DOM events into commands, and requests render scopes. It no longer contains filesystem primitives, image conversion internals, high-level Scryfall catalog workflows, or repeated view-data derivation.

## Module Design

### Large-Cube Test Fixtures

Create `testFixtures.js` with deterministic builders for a 600-card Cube and multi-month price history. Fixtures contain synthetic values and never read the user's ignored runtime files.

Tests assert operation counts and output stability rather than wall-clock timing. This avoids flaky performance tests while still proving that history indexes and persistence batching are reused.

### Workspace Service

Create `workspace.js` and `workspace.test.js`.

Responsibilities:

- Query and request directory permissions.
- Read and write the three JSON workspace documents.
- Return handles for `images/` and `images/thumbnails/`.
- Read, write, and test the existence of local image files.
- Enumerate original and thumbnail image paths for the health check.
- Normalize missing-entry errors into explicit results where absence is expected.

The service receives the existing Cube, price-history, and change-log serializers through dependency injection. This keeps it testable with in-memory fake file handles and prevents it from owning domain normalization.

The service does not decide when to save and does not mutate application state.

### Persistence Coordinator

Create `persistence.js` and `persistence.test.js`.

The coordinator recognizes three dirty domains:

- `cube`
- `priceHistory`
- `changeLog`

`markDirty(domain, snapshot)` records the latest immutable snapshot for that domain. Browser mirror writes occur only for marked domains. Directory writes are serialized and coalesced so repeated pending writes for the same domain retain only the latest snapshot.

Critical commands such as add, delete, finish change, Japan-print change, printing replacement, import, restore, and price refresh mark their affected domains immediately. The notes textarea uses a 400 ms trailing debounce for the `cube` domain and flushes on blur.

The notes value is always updated in memory immediately. A `pagehide` handler synchronously writes the latest Cube snapshot to the browser mirror if the debounce has not fired. Directory persistence cannot be guaranteed during page shutdown, so the folder remains dirty and receives the latest snapshot when the saved directory is restored or the user next performs an explicit flush.

`flush()` is mandatory before manual folder synchronization, folder reload, folder replacement, and disconnect. Browser storage remains the immediate recovery mirror if directory writing fails. A failed directory write preserves dirty state and produces the existing visible failure feedback; it must not report success or silently discard a newer snapshot.

Price-history changes never cause a Cube or change-log file write unless those domains were also marked dirty. Change-log entries likewise do not force a price-history write.

### Scryfall Catalog Service

Create `catalog.js` and `catalog.test.js` on top of the existing `ScryfallClient.requestJson` transport.

Responsibilities:

- Fuzzy named-card lookup.
- Paper-card name search across pagination.
- Exact set and collector-number lookup.
- Scryfall ID lookup.
- Printing identity resolution.
- Oracle printing pagination with duplicate-page detection.
- Collection endpoint batching in groups of 75.
- Normalized mapping by printing key and card name.
- In-memory Oracle printing cache.

Every public asynchronous method accepts an `AbortSignal`. UI code continues to own controllers and request-generation IDs so stale responses cannot update a closed or replaced dialog.

The transport retains timeout, retry, rate-limit, and Retry-After behavior. The catalog translates expected 404 cases into domain results or the current Chinese error messages.

### Local Image Cache Service

Create `imageCache.js` and `imageCache.test.js`.

Responsibilities:

- Prefer Scryfall PNG URLs while retaining fallback URLs.
- Download and validate non-empty image blobs.
- Preserve exact set code, collector number, card name, and face suffix naming rules.
- Store original blobs without recompression.
- Generate 360 px WebP thumbnails at quality `0.82`.
- Reuse existing originals and thumbnails.
- Process front and back faces.
- Emit progress and per-card results without manipulating the DOM.

Canvas creation and bitmap decoding are injected browser adapters so the orchestration can be tested without a real DOM. File access is delegated to `workspace.js`.

Image processing starts with concurrency `1`, matching current memory and network behavior. Raising concurrency requires separate measured evidence and is not part of this phase.

### Derived Data Selectors

Create `selectors.js` and `selectors.test.js`. Extend `priceHistory.js` only where the price-specific index belongs naturally.

The derived model contains:

- A `cardById` map.
- Filtered and sorted cards.
- Cards grouped by color bucket.
- Cube statistics and price status.
- Current total price and total trend.
- Latest per-card price trend keyed by printing and finish.
- Analytics data for overall and per-color mana curves.

State owns monotonic `dataRevision` and `historyRevision` counters. Selectors reuse cached results when their relevant revision and filter inputs have not changed. UI-only changes such as opening a dialog do not invalidate card or price indexes.

Price indexing walks each historical snapshot once and builds the latest two valid points for every card-price key. Rendering 600 cards then performs map lookups rather than 600 complete history scans.

### Scoped Rendering

Introduce a small render scheduler, either as `renderScheduler.js` with tests or as a pure tested helper in `selectors.js` if the final interface remains trivial.

Supported scopes are:

- `meta`
- `stats`
- `cards`
- `analytics`
- `storage`
- `nameLanguage`

Multiple requests in the same JavaScript turn are merged and executed once through `queueMicrotask`. Rendering order is meta, stats, name language, cards, analytics, storage.

Per-card operations follow these rules:

- Japan-print toggle updates the card node and stats only when the active Japan-print filter remains valid; otherwise it requests the complete cards scope.
- Foil toggle updates the card node and stats only when the active finish filter remains valid; otherwise it requests the complete cards scope.
- Localized-name completion updates the relevant name node without rebuilding the collection.
- Add, delete, undo, import, restore, printing replacement, language switch, and price refresh may request a complete cards render.
- Search input is coalesced to one cards render per animation frame. It is not delayed by a long textual debounce.

Image error handling moves to one capturing listener on the card grid instead of one listener per image after every render.

If a targeted card node cannot be found or its group membership would change, the renderer falls back to the complete cards scope. Correctness takes priority over partial rendering.

## State and Data Flow

Commands update in-memory state first, increment the appropriate revision, record change-log entries where current behavior requires them, mark persistence domains dirty, and request render scopes.

The order for a finish toggle is:

1. Validate the requested finish against the selected printing.
2. Update the card and increment `dataRevision`.
3. Append the existing change-log entry and mark `changeLog` dirty.
4. Mark `cube` dirty.
5. Request `stats` and either a targeted card update or complete `cards` rendering according to the active filter.

Directory persistence runs independently through the serial coordinator. A slower write never replaces a newer snapshot because the coordinator retains the latest pending value for each domain.

## Error Handling

- Workspace permission loss preserves the browser mirror and reports that folder synchronization stopped.
- JSON parse and migration errors retain the current file-specific Chinese messages.
- Scryfall cancellation is silent when caused by closing or replacing a dialog.
- Scryfall timeout and service errors retain actionable user feedback and do not block local usage.
- A failed image face is counted without preventing other cards from being processed.
- Thumbnail failure never overwrites or deletes a successfully stored original.
- Selector or targeted-render lookup misses fall back to full rendering rather than leaving stale UI.

## Testing Strategy

Every task follows test-first development and ends in its own Git commit.

Unit tests cover:

- Fake directory handles and JSON round trips.
- Dirty-domain isolation, coalescing, flush ordering, and failure recovery.
- Scryfall pagination, batching, caching, cancellation, and duplicate-page protection.
- Original-image preservation, thumbnail reuse, two-face processing, and progress results.
- 600-card filtering, grouping, statistics, price indexing, and cache invalidation.
- Render-scope merging, ordering, and fallback decisions.

Integration tests verify script dependency order and the continued presence of all interactive regions. Browser verification covers add, delete and undo, finish toggle, Japan-print toggle, printing replacement, filters, language switch, import preview, JSON restore, manual price update, image caching, health check, folder write, reload, and disconnect.

Tests use examples and fake handles. They do not modify `cube-data.json`, `price-history.json`, `change-log.json`, or `images/`.

## Git and Delivery Sequence

Implementation begins on branch `codex/phase-2-maintainability` from the commit containing this approved design document.

Expected commits:

1. `Add large Cube regression fixtures`
2. `Extract workspace file service`
3. `Coalesce workspace persistence`
4. `Extract Scryfall catalog service`
5. `Extract local image cache service`
6. `Index Cube view data`
7. `Add scoped application rendering`
8. `Document phase two architecture`

Each commit must pass `npm run check` and `npm test`. A browser smoke test is required after commits 3, 5, and 7 because those checkpoints cross persistence, browser image APIs, and DOM rendering boundaries.

## Acceptance Criteria

- Existing UI layout and copy remain unchanged.
- All existing user workflows continue to work.
- Workspace files, backup files, Excel columns, image paths, and thumbnail paths remain compatible.
- `dataVersion` remains `1`.
- Twenty rapid notes input events result in at most one trailing Cube directory write and no price-history or change-log writes.
- A card-grid render uses an indexed price-trend lookup rather than calling `cardSeries` once per card.
- Japan-print and finish toggles do not rebuild the complete card grid when their active filter allows a targeted update.
- Failed directory writes retain unsaved state and visible feedback.
- All existing and new tests pass.
- Browser verification produces no console errors.
- `app.js` is reduced to orchestration and UI coordination, with a target size of approximately 1,500 lines. This is a diagnostic target, not permission to create meaningless modules or duplicate code.

## Rollback Strategy

The implementation branch preserves the approved design commit as its pre-phase base. Because each responsibility is extracted and integrated in a separate commit, a problematic module can be reverted without discarding later user data. No implementation step deletes or automatically rewrites local images. Workspace documents continue to use the existing parsers and migration path, so reverting code does not require a data downgrade.
