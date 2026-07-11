# Remembered Folder Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reauthorize and restore the remembered Cube folder from the existing button without reopening the directory picker.

**Architecture:** Add a shared `activateDirectoryHandle()` helper for loading an authorized directory. Route the folder button to `reconnectRememberedFolder()` only when a saved handle exists but directory mode is inactive; otherwise retain the existing picker flow.

**Tech Stack:** Vanilla JavaScript, File System Access API, IndexedDB handle store, Node test runner.

## Global Constraints

- Permission requests must originate from a user click.
- Permission denial must not clear browser data or the remembered handle.
- Persistence file formats remain unchanged.

---

### Task 1: Remember And Reconnect The Saved Handle

**Files:**
- Modify: `app.js`
- Test: `app.integration.test.js`

- [ ] Write failing source-integration assertions for `rememberedDirectoryHandle`, `重新连接文件夹`, `reconnectRememberedFolder`, and click routing.
- [ ] Run `node --test app.integration.test.js` and confirm failure.
- [ ] Store the loaded handle in `state.storage.rememberedDirectoryHandle` while permission is pending.
- [ ] Extract `activateDirectoryHandle(directoryHandle)` to load all three JSON domains and enter directory mode.
- [ ] Add `reconnectRememberedFolder()` that calls `requestDirectoryPermission()` from the button click and then activates the handle.
- [ ] Preserve picker behavior for first connection and folder replacement.
- [ ] Run `npm test && npm run check && git diff --check`.
- [ ] Commit with `git commit -m "Reconnect remembered Cube folder"`.

### Task 2: Browser Verification And Integration

**Files:**
- Verify only

- [ ] Verify the remembered-state label and button routing in the local browser.
- [ ] Fast-forward the feature branch into `main`.
- [ ] Run `npm test && npm run check` on the merged result.
- [ ] Remove the owned worktree and feature branch.
