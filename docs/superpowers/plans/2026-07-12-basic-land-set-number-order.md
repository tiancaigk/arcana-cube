# Basic Land Set Number Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort basic lands inside set groups solely by natural collector-number order.

**Architecture:** Adjust the existing pure `groupBasicLands()` sorter in `core.js`; no UI or data-model changes are needed.

**Tech Stack:** Vanilla JavaScript and Node test runner.

## Global Constraints

- Set group ordering remains newest to oldest.
- Category grouping remains unchanged.
- Collector numbers remain exact stored strings.

---

### Task 1: Set-local collector ordering

**Files:**
- Modify: `core.test.js`
- Modify: `core.js`

- [ ] Change the set-group test so collector order conflicts with kind order and add natural-number/suffix coverage.
- [ ] Run `node --test core.test.js` and confirm the updated test fails under kind-first sorting.
- [ ] Remove the kind-rank comparison from set-mode sorting and use the existing numeric-aware collector comparator.
- [ ] Run `node --test core.test.js`, `npm test`, `npm run check`, and `git diff --check`.
- [ ] Commit with message `Sort basic lands by collector number within sets`.
- [ ] Merge into `main`, rerun all checks, and clean the owned worktree.
