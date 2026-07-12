# Basic Land Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separately stored five-type basic-land pool that contributes to collection value but never to the 600-card draft pool.

**Architecture:** Migrate Cube data to `cards` plus `basicLands`, add small core classification helpers, and use a combined valued-card accessor only at price boundaries. Render a dedicated view while reusing existing card interactions through pool-aware lookup helpers.

**Tech Stack:** Vanilla JavaScript, CSS Grid, SheetJS, File System Access persistence, Node test runner.

## Global Constraints

- Only Plains, Island, Swamp, Mountain, and Forest are valid.
- Every physical basic land is a separate record; duplicate Scryfall printings are rejected.
- Draft analytics consume only `cards`.

---

### Task 1: Data Migration And Classification

**Files:** `migrations.js`, `migrations.test.js`, `core.js`, `core.test.js`, `storage.test.js`

- [ ] Add failing tests for migration version 2 and five-name classification.
- [ ] Set `CURRENT_DATA_VERSION = 2`, add `basicLands: []`, and export `getBasicLandKind` / `isSupportedBasicLand`.
- [ ] Run focused tests and commit `Add basic land pool data model`.

### Task 2: Dedicated Basic-Land View

**Files:** `index.html`, `app.js`, `styles.css`, `app.integration.test.js`

- [ ] Add failing assertions for navigation, five groups, subtotal, and pool-aware interactions.
- [ ] Render the view and make preview, printing, finish, Japan-print, and removal actions pool-aware.
- [ ] Restrict add-dialog results and prevent duplicate Scryfall printings.
- [ ] Run focused tests and commit `Add basic land collection view`.

### Task 3: Combined Value And Export

**Files:** `app.js`, `app.integration.test.js`, `priceHistory.test.js`

- [ ] Add failing assertions that price boundaries use `getValuedCards()` while draft selectors remain on `state.data.cards`.
- [ ] Include both pools in refresh, history, daily changes, image caching, and total value.
- [ ] Add a `基本地` Excel worksheet.
- [ ] Run full tests and commit `Include basic lands in collection value`.

### Task 4: Verify And Integrate

- [ ] Browser-test the dedicated page and confirm draft count is unchanged.
- [ ] Run `npm test && npm run check && git diff --check`.
- [ ] Fast-forward into `main`, rerun verification, and clean the owned worktree and branch.
