# Maintainability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first maintainability foundation through focused browser modules, a unified collection mutation pipeline, configurable local serving, direct behavior tests, and architecture documentation.

**Architecture:** Preserve the existing UMD-style browser modules and vanilla JavaScript runtime. Extract pure domain logic first, then inject application side effects through a small command executor so `app.js` remains the composition root.

**Tech Stack:** Vanilla JavaScript, Node test runner, browser localStorage, existing persistence/render services.

## Global Constraints

- No UI or saved-data behavior changes.
- Every task uses red-green testing and ends in an independent Git commit.
- New browser modules load before `app.js` and are included in `npm run check`.
- Existing local-file, folder, price, and image behavior must remain intact.

---

### Task 1: Configurable Local Server

**Files:** `scripts/local-server.js`, `localServer.test.js`

- [ ] Add failing tests for default host, explicit `--host`, environment/argument port handling, and invalid ports.
- [ ] Export pure option parsing without starting a server when required as a module.
- [ ] Use parsed host in `server.listen()` and startup output.
- [ ] Run focused and full tests; commit `Support configurable local server host`.

### Task 2: Basic-Land Domain Module

**Files:** `basicLands.js`, `basicLands.test.js`, `core.js`, `core.test.js`, `index.html`, `app.js`, `app.integration.test.js`, `package.json`

- [ ] Write failing direct tests for grouping, collector ranges, and batch partial-success classification.
- [ ] Move basic-land grouping/range logic into the new module and implement pure batch classification.
- [ ] Wire the module into the page and application while preserving output.
- [ ] Run focused and full tests; commit `Extract basic land domain module`.

### Task 3: Collection Command Executor

**Files:** `collectionCommands.js`, `collectionCommands.test.js`, `index.html`, `app.js`, `app.integration.test.js`, `package.json`

- [ ] Write failing tests proving multiple log entries, one save, one render, and one toast per command.
- [ ] Implement the injected executor.
- [ ] Adopt it for version, Finish, Japan print, add, batch add, remove, and undo operations.
- [ ] Run focused and full tests; commit `Centralize collection mutation effects`.

### Task 4: View Preference Storage

**Files:** `viewPreferences.js`, `viewPreferences.test.js`, `index.html`, `app.js`, `app.integration.test.js`, `package.json`

- [ ] Write failing tests for enum validation, defaults, save, and unavailable storage.
- [ ] Implement the preference store and replace application-local storage helpers.
- [ ] Run focused and full tests; commit `Extract view preference storage`.

### Task 5: Architecture And Verification

**Files:** `ARCHITECTURE.md`

- [ ] Document module ownership, state partitions, mutation effects, persistence, and rendering.
- [ ] Run `npm test`, `npm run check`, and `git diff --check`.
- [ ] Browser-smoke-test card addition/mutation, basic-land grouping, and archive preview on an isolated server.
- [ ] Commit `Document Arcana Cube architecture`, fast-forward merge to `main`, rerun checks, and clean the owned worktree.
