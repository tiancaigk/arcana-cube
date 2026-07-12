# Basic Land Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add category/set grouping controls to the basic-land archive, with newest-set-first ordering and five cards per desktop row.

**Architecture:** Put pure grouping and sorting logic in `core.js` so it is directly testable. Keep display preference and rendering orchestration in `app.js`, use semantic segmented buttons in `index.html`, and scope the fixed five-column layout to the basic-land archive in `styles.css`.

**Tech Stack:** Vanilla JavaScript, HTML, CSS, Node test runner, localStorage.

## Global Constraints

- Default to category grouping when no preference exists.
- Persist only the presentation preference; do not change the Cube data schema.
- Set groups sort by release date newest first, with undated groups last.
- Cards inside a set sort by Plains, Island, Swamp, Mountain, Forest, then collector number.
- Only the basic-land archive uses exactly five desktop columns.
- Existing basic-land operations, value calculations, backup, and export behavior remain unchanged.

---

### Task 1: Pure grouping and sorting

**Files:**
- Modify: `core.js`
- Test: `core.test.js`

**Interfaces:**
- Produces: `groupBasicLands(cards, mode)` returning an ordered array of `{ key, label, setCode, releasedAt, cards }`.

- [ ] **Step 1: Write failing tests** covering fixed category order, newest-first set order, kind/collector-number ordering inside sets, and the undated `未知系列` fallback.
- [ ] **Step 2: Run `node --test core.test.js`** and confirm failure because `groupBasicLands` is not exported.
- [ ] **Step 3: Implement `groupBasicLands(cards, mode)`** with stable normalized set keys, ISO date comparison, fixed basic-kind ranks, and collector-number comparison using numeric collation.
- [ ] **Step 4: Run `node --test core.test.js`** and confirm all core tests pass.
- [ ] **Step 5: Commit `core.js` and `core.test.js`** with message `Add basic land grouping logic`.

### Task 2: Grouping control and rendering

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`
- Test: `app.integration.test.js`

**Interfaces:**
- Consumes: `core.groupBasicLands(cards, mode)`.
- Produces: `state.basicLandGrouping`, persisted under `arcanaCube.basicLandGrouping`, and two buttons with `data-basic-land-grouping`.

- [ ] **Step 1: Write failing integration assertions** for two accessible grouping buttons, persisted preference handling, `groupBasicLands` use, set metadata headings, and the scoped five-column CSS rule.
- [ ] **Step 2: Run `node --test app.integration.test.js`** and confirm the new assertions fail.
- [ ] **Step 3: Add the segmented control** beside the add button and initialize the grouping preference defensively to `kind` or `set`.
- [ ] **Step 4: Refactor `renderBasicLands()`** to render ordered groups from `groupBasicLands`, include set code/date for set headings, update `aria-pressed`, and keep existing card templates/actions.
- [ ] **Step 5: Add click handling and scoped CSS** so switching rerenders immediately and `.basic-land-grid .card-group-grid` uses five equal columns on desktop.
- [ ] **Step 6: Run `node --test app.integration.test.js` and `npm test`** and confirm all tests pass.
- [ ] **Step 7: Commit UI and tests** with message `Add basic land grouping switcher`.

### Task 3: Verification

**Files:**
- Verify: `core.js`, `app.js`, `index.html`, `styles.css`

**Interfaces:**
- Consumes the complete feature.
- Produces no new code unless verification exposes a defect.

- [ ] **Step 1: Run `npm run check` and `git diff --check`** and require clean output.
- [ ] **Step 2: Start the local server** and verify both modes, newest-first set headings, five cards per row, and persistence after reload without changing collection data.
- [ ] **Step 3: Confirm browser console has no errors.**
- [ ] **Step 4: Commit any verification-only correction separately**, then confirm `git status --short --branch` is clean.
