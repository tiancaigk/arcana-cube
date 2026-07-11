# Card Archive Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the card image preview into a left-image/right-details archive and persist complete Scryfall printing metadata for every card opened there.

**Architecture:** Extend `CubeCore.normalizeScryfallCard` with archive metadata and add a focused merge helper that preserves local card state. Split preview rendering from asynchronous enrichment in `app.js`: render local data immediately, fetch the exact Scryfall printing only when metadata is incomplete, merge and persist it, then rerender if the same preview is still open.

**Tech Stack:** Vanilla JavaScript, HTML `<dialog>`, CSS Grid, Node test runner, existing Scryfall catalog and persistence services.

## Global Constraints

- Preserve the existing desktop-only application target.
- Use the highest-quality locally available card images.
- Double-faced cards show both images and label front/back Oracle text separately.
- Missing metadata displays `暂无资料` and never blocks image preview.
- Preview details are read-only; existing finish, version, and Japan-print controls do not move.
- Existing price-history format and calculations remain unchanged.

---

### Task 1: Normalize And Merge Archive Metadata

**Files:**
- Modify: `core.js:71-116`
- Test: `core.test.js`

**Interfaces:**
- Produces: `mergeArchiveMetadata(currentCard, scryfallCard) -> card`
- Produces normalized fields: `oracleText`, `backOracleText`, `artist`, `backArtist`, `setName`, `releasedAt`

- [ ] **Step 1: Write failing normalization and merge tests**

Add assertions for a single-faced Scryfall card and a double-faced card:

```js
assert.equal(normalized.oracleText, "Deal 3 damage.");
assert.equal(normalized.artist, "Sample Artist");
assert.equal(normalized.setName, "Test Set");
assert.equal(normalized.releasedAt, "2026-01-02");
assert.equal(doubleFaced.oracleText, "Front rules");
assert.equal(doubleFaced.backOracleText, "Back rules");
assert.equal(doubleFaced.backArtist, "Back Artist");

const merged = mergeArchiveMetadata(existing, scryfallCard);
assert.equal(merged.oracleText, "Deal 3 damage.");
assert.equal(merged.localImage, existing.localImage);
assert.equal(merged.finish, existing.finish);
assert.equal(merged.JapanPrint, true);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test core.test.js`

Expected: failure because archive fields and `mergeArchiveMetadata` are missing.

- [ ] **Step 3: Extend normalization and add the merge helper**

Add archive fields in `normalizeScryfallCard`:

```js
oracleText: card.oracle_text || (face && face.oracle_text) || "",
backOracleText: (backFace && backFace.oracle_text) || "",
artist: card.artist || (face && face.artist) || "",
backArtist: (backFace && backFace.artist) || "",
setName: card.set_name || "",
releasedAt: card.released_at || "",
```

Add and export:

```js
function mergeArchiveMetadata(currentCard, scryfallCard) {
  const normalized = normalizeScryfallCard(scryfallCard);
  return {
    ...currentCard,
    oracleText: normalized.oracleText,
    backOracleText: normalized.backOracleText,
    artist: normalized.artist,
    backArtist: normalized.backArtist,
    setName: normalized.setName,
    releasedAt: normalized.releasedAt
  };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test core.test.js`

Expected: all `core.test.js` tests pass.

- [ ] **Step 5: Commit the core data change**

```bash
git add core.js core.test.js
git commit -m "Store card archive metadata"
```

### Task 2: Render And Enrich The Archive Preview

**Files:**
- Modify: `app.js:20-50,1175-1200,2175-2180`
- Modify: `app.integration.test.js`

**Interfaces:**
- Consumes: `mergeArchiveMetadata(currentCard, scryfallCard)`
- Consumes: `catalog.lookupById(scryfallId, signal)`
- Produces: `renderImagePreview(card)` and `enrichPreviewMetadata(cardId)`

- [ ] **Step 1: Write a failing integration test for archive structure and enrichment**

Add source-level assertions:

```js
assert.match(appSource, /class="card-archive-preview"/);
assert.match(appSource, /class="card-archive-images/);
assert.match(appSource, /class="card-archive-details"/);
assert.match(appSource, /规则文字/);
assert.match(appSource, /系列与编号/);
assert.match(appSource, /catalog\.lookupById\(card\.scryfallId/);
assert.match(appSource, /mergeArchiveMetadata\(current, printing\)/);
assert.match(appSource, /event\.target\.closest\("\.card-archive-images img"\)/);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --test app.integration.test.js`

Expected: failure because the archive preview markup and enrichment flow do not exist.

- [ ] **Step 3: Add preview state and rendering helpers**

Add state for the active preview, abort controller, and attempted IDs. Implement:

```js
function renderImagePreview(card) {
  const finish = normalizeFinish(card.finish);
  const images = [frontImage, backImage].filter(Boolean);
  elements.imagePreview.innerHTML = `<div class="card-archive-preview">
    <div class="card-archive-images${images.length > 1 ? " two-sided" : ""}">...</div>
    <section class="card-archive-details">...</section>
  </div>`;
}

async function enrichPreviewMetadata(cardId) {
  const card = selectors.cardById(state.data.cards, state.dataRevision, cardId);
  if (!card || !card.scryfallId || (card.setName && card.releasedAt)) return;
  state.previewMetadataAttempts.add(cardId);
  const printing = await catalog.lookupById(card.scryfallId, state.previewController.signal);
  if (!printing || state.previewCardId !== cardId || !elements.imagePreviewDialog.open) return;
  const index = state.data.cards.findIndex((item) => item.id === cardId);
  const current = state.data.cards[index];
  state.data.cards[index] = mergeArchiveMetadata(current, printing);
  saveState("cube");
  renderImagePreview(state.data.cards[index]);
}
```

Escape all card text and render `暂无资料` for empty optional fields. Use the front face for primary name, type, mana cost, colors, Oracle text, and artist. Render the existing `renderPriceHistoryPanel` inside the details column.

- [ ] **Step 4: Preserve close behavior and prevent details clicks from closing**

Update the image-preview listener:

```js
if (event.target === elements.imagePreviewDialog || event.target.closest(".card-archive-images img")) closeImagePreview();
```

Abort pending enrichment and clear active preview state in `closeImagePreview` and the dialog `cancel`/`close` paths.

- [ ] **Step 5: Run the focused integration test and verify GREEN**

Run: `node --test app.integration.test.js core.test.js`

Expected: all focused tests pass.

- [ ] **Step 6: Commit preview behavior**

```bash
git add app.js app.integration.test.js
git commit -m "Add card archive preview behavior"
```

### Task 3: Style And Verify The Desktop Archive

**Files:**
- Modify: `styles.css:296-305`
- Modify: `app.integration.test.js`

**Interfaces:**
- Consumes markup classes from Task 2.
- Produces a viewport-constrained two-column desktop dialog with independently scrollable details.

- [ ] **Step 1: Add failing style assertions**

```js
assert.match(styleSource, /\.card-archive-preview\s*\{[^}]*grid-template-columns:/s);
assert.match(styleSource, /\.card-archive-details\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(styleSource, /\.card-archive-images\.two-sided/);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --test app.integration.test.js`

Expected: failure because the archive styles do not exist.

- [ ] **Step 3: Implement the selected A layout**

Replace the former column preview rules with:

```css
.image-preview-dialog { width:min(1180px,calc(100vw - 36px)); max-height:calc(100vh - 36px); overflow:hidden; }
.card-archive-preview { display:grid; grid-template-columns:minmax(360px,46%) minmax(0,54%); max-height:calc(100vh - 36px); background:linear-gradient(145deg,#22211d,#151513); }
.card-archive-images { display:grid; place-items:center; gap:18px; padding:24px; overflow:auto; cursor:zoom-out; }
.card-archive-images.two-sided { grid-template-columns:repeat(2,minmax(0,1fr)); align-content:center; }
.card-archive-details { min-width:0; overflow-y:auto; padding:28px; scrollbar-color:#615840 #151513; scrollbar-width:thin; }
```

Add compact archive header, metadata pills, Oracle text blocks, metadata grid, and price panel styles consistent with the existing dark/gold system. Do not add mobile media queries.

- [ ] **Step 4: Run all automated verification**

Run: `npm test && npm run check && git diff --check`

Expected: all tests pass, syntax checks pass, and no whitespace errors are reported.

- [ ] **Step 5: Verify in the local browser**

Open one single-faced and one double-faced card preview. Confirm:

- image column is left and details column is right;
- details scroll without moving the backdrop;
- image click and backdrop click close the dialog;
- details click does not close it;
- metadata enrichment persists after reopening;
- no console errors appear.

- [ ] **Step 6: Commit the visual implementation**

```bash
git add styles.css app.integration.test.js
git commit -m "Style card archive preview"
```

### Task 4: Final Integration

**Files:**
- Verify only

- [ ] **Step 1: Run fresh final verification**

Run: `npm test && npm run check && git status --short`

Expected: all tests pass, syntax checks pass, and only intentionally ignored brainstorm artifacts remain outside Git.

- [ ] **Step 2: Fast-forward the completed feature branch into `main`**

```bash
git checkout main
git merge --ff-only codex/card-archive-preview
git branch -d codex/card-archive-preview
```

### Task 5: Persistent Preview Close Button

**Files:**
- Modify: `app.js`
- Modify: `styles.css`
- Test: `app.integration.test.js`

**Interfaces:**
- Consumes: existing `closeImagePreview()` behavior.
- Produces: `[data-close-image-preview]` icon button with `aria-label="关闭卡图预览"`.

- [ ] **Step 1: Write a failing integration test**

```js
assert.match(appSource, /data-close-image-preview/);
assert.match(appSource, /aria-label="关闭卡图预览"/);
assert.match(appSource, /closest\("\[data-close-image-preview\]"\)/);
assert.match(styleSource, /\.card-archive-close\s*\{[^}]*position:\s*absolute/s);
```

- [ ] **Step 2: Run the integration test and verify RED**

Run: `node --test app.integration.test.js`

Expected: failure because the close icon does not exist.

- [ ] **Step 3: Render and bind the icon button**

Insert the button as the first child of `.card-archive-preview`:

```html
<button type="button" class="close-button card-archive-close" data-close-image-preview aria-label="关闭卡图预览">×</button>
```

Handle it in the existing preview-dialog click listener before the image/backdrop condition:

```js
if (event.target.closest("[data-close-image-preview]")) {
  closeImagePreview();
  return;
}
```

- [ ] **Step 4: Position the button**

```css
.card-archive-preview { position: relative; }
.card-archive-close { position: absolute; z-index: 3; top: 14px; right: 14px; }
```

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run check && git diff --check`

```bash
git add app.js styles.css app.integration.test.js
git commit -m "Add archive preview close button"
```
