# Grid Card Information Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress grid card metadata into two rows while preserving the current list row.

**Architecture:** Keep the shared card template and add stable classes to its type and printing metadata. CSS flattens the existing row wrappers, hides mana cost and type only in grid mode, and restores both elements plus automatic seven-column placement in list mode.

**Tech Stack:** Vanilla JavaScript, HTML template strings, CSS Grid, Node test runner

## Global Constraints

- Grid row one is Japan print, card name, and Foil/Non-Foil.
- Grid row two is set/collector number/price and printing selection.
- Mana cost and card type remain visible in list mode.
- Each interactive control has one DOM instance.

---

### Task 1: Compact Grid Card Metadata

**Files:**
- Modify: `app.integration.test.js`
- Modify: `app.js:1180-1210`
- Modify: `styles.css:152-222`

**Interfaces:**
- Consumes: the existing `cardTemplate(card, index, priceView)` markup and `.list-mode` modifier.
- Produces: `.card-type` and `.card-printing` hooks plus a two-row grid layout.

- [ ] **Step 1: Write the failing source-level layout test**

Add a test that reads `app.js` and `styles.css`, then asserts the stable metadata classes, grid-only hiding rule, two-row placement, and list restoration rules exist.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test app.integration.test.js`

Expected: FAIL because `.card-type`, `.card-printing`, and the compact grid rules do not exist.

- [ ] **Step 3: Add template hooks and minimal CSS grid placement**

Add `class="card-type"` to the first metadata span and `class="card-printing"` to the set/price span. Flatten `.card-name-row` and `.card-meta` with `display: contents`; place the Japan toggle, name, and finish on row one; place printing metadata and the printing button on row two; hide `.card-cost` and `.card-type` by default. Under `.list-mode`, restore those two elements and reset explicit grid placement to automatic flow.

- [ ] **Step 4: Run focused and full automated verification**

Run:

```sh
node --test app.integration.test.js
npm run check
npm test
git diff --check
```

Expected: all commands exit zero and all tests pass.

- [ ] **Step 5: Verify both modes in the browser**

Confirm grid cards have exactly two metadata rows with no mana cost or type, then switch to list view and confirm mana cost and type remain visible.

- [ ] **Step 6: Commit**

```sh
git add app.integration.test.js app.js styles.css
git commit -m "Compact grid card metadata"
```
