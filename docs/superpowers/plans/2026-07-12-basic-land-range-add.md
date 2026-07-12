# Basic Land Range Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add partial-success numeric collector-range importing to the basic-land dialog.

**Architecture:** Add a pure parser in `core.js`, reuse `catalog.lookupPrintingBatch()` for network batching, and orchestrate classification/persistence/result rendering in `app.js`. Keep exact single-printing behavior unchanged and avoid schema changes.

**Tech Stack:** Vanilla JavaScript, Scryfall collection API, Node test runner.

## Global Constraints

- Range syntax works only for basic-land additions.
- Only inclusive ascending numeric ranges of at most 100 entries are accepted.
- Single collector numbers, including special characters, remain exact literals.
- Batch additions allow partial success and persist once.
- Only the five supported paper basic lands may be added.

---

### Task 1: Collector range parser

**Files:**
- Modify: `core.js`
- Test: `core.test.js`

**Interfaces:**
- Produces: `parseCollectorNumberRange(value, maxItems = 100)` returning `{ isRange, numbers }` or throwing a Chinese validation error.

- [ ] Write failing tests for a single literal, inclusive numeric range, malformed syntax, descending range, and 100-item limit.
- [ ] Run `node --test core.test.js` and confirm failure because the parser is absent.
- [ ] Implement and export the minimal pure parser.
- [ ] Run `node --test core.test.js` and commit with message `Add collector number range parser`.

### Task 2: Basic-land batch addition

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Modify: `styles.css`
- Test: `app.integration.test.js`

**Interfaces:**
- Consumes: `parseCollectorNumberRange()` and `catalog.lookupPrintingBatch()`.
- Produces: basic-land-only range flow and an in-dialog result report.

- [ ] Write failing integration assertions for basic-only detection, batch lookup, classification labels, one persistence call, and updated hint copy.
- [ ] Run `node --test app.integration.test.js` and confirm failure.
- [ ] Add a batch helper that expands targets, classifies missing/unsupported/duplicate cards, appends valid normalized cards, records changes without per-card persistence, then saves once.
- [ ] Render counts and per-number skipped reasons in `lookupResult`, retain the open dialog, and update input hint/placeholder only in basic mode.
- [ ] Keep draft and exact-single flows unchanged.
- [ ] Run `node --test app.integration.test.js`, `npm test`, and `npm run check`; commit with message `Add basic land range importing`.

### Task 3: Verification and integration

**Files:**
- Verify all modified files.

**Interfaces:**
- Produces the merged, clean feature.

- [ ] Run `npm test`, `npm run check`, and `git diff --check` in the feature worktree.
- [ ] Browser-test a valid range with partial failures in isolated storage; verify the dialog report and collection count.
- [ ] Verify no console errors.
- [ ] Fast-forward merge into `main`, rerun the complete checks, then remove the owned worktree and feature branch.
