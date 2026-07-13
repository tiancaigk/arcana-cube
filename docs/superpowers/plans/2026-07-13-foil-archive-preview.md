# Foil Archive Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved showcase Foil treatment to large archive-preview card images.

**Architecture:** Expose the normalized finish on the archive preview root and wrap each image with a CSS target frame. Implement the effect entirely in scoped CSS so card data and dialog interactions remain unchanged.

**Tech Stack:** Vanilla JavaScript, HTML templates, CSS animations, Node test runner.

## Global Constraints

- Effect applies only to `foil` archive previews.
- Both faces of double-faced cards receive the effect.
- Non-Foil previews and collection-grid effects remain unchanged.
- Existing close interactions remain unchanged.
- Reduced-motion users receive a static effect.

---

### Task 1: Foil preview markup and styling

**Files:**
- Modify: `app.integration.test.js`
- Modify: `app.js`
- Modify: `styles.css`

- [ ] Add failing assertions for preview finish state, per-image frames, Foil border/glow/reflection selectors, and reduced-motion handling.
- [ ] Run `node --test app.integration.test.js` and confirm failure.
- [ ] Add `data-finish` to `.card-archive-preview` and wrap each preview image in `.card-archive-image-frame` without changing image click behavior.
- [ ] Add scoped showcase border, ambient glow, reflection, and animation CSS with no dark stripe.
- [ ] Add static reduced-motion styles.
- [ ] Run integration tests, the full suite, syntax checks, and `git diff --check`.
- [ ] Commit with message `Add Foil effect to archive previews`.

### Task 2: Visual verification and integration

**Files:**
- Verify modified files only.

- [ ] Start an isolated local server and inspect Foil and Non-Foil previews, including a double-faced fixture when available.
- [ ] Confirm image/background/close-button behavior and an error-free console.
- [ ] Fast-forward merge into `main`, rerun all checks, and clean the owned worktree.
