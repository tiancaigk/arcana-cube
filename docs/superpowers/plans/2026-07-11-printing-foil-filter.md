# Printing Foil Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the printing dialog Finish control into an all/Foil printing filter and force Foil when selecting from the Foil-only view.

**Architecture:** Extend the pure printing helpers so filtering and preferred-finish selection remain testable outside the DOM. The app owns a transient `printingFinishFilter` state, renders the existing pill as a filter, combines it with text search, and supplies `foil` as the preferred Finish only when selecting under the Foil-only filter.

**Tech Stack:** Vanilla JavaScript, Scryfall printing data, Node test runner, browser DOM

## Global Constraints

- Both filter modes include paper printings only.
- Opening the dialog resets the filter to `all`.
- Toggling the filter never mutates the Cube card.
- Selecting under `foil` sets the chosen card Finish to `foil`.
- Card-grid and list Finish controls remain unchanged.

---

### Task 1: Pure Printing Filter and Preferred Finish

**Files:**
- Modify: `core.test.js`
- Modify: `core.js:331-375`

**Interfaces:**
- Produces: `filterPrintings(printings, query, finishFilter = "all")`.
- Produces: `replacePrinting(currentCard, printing, preferredFinish = currentCard.finish)`.

- [ ] **Step 1: Add failing tests**

Add paper printings with `foil`, `nonfoil`, and digital availability. Assert `filterPrintings(..., "", "foil")` returns only Foil-capable paper printings and still combines with text search. Assert a preferred `foil` passed to `replacePrinting` produces a Foil card.

- [ ] **Step 2: Run `node --test core.test.js` and verify RED**

Expected: the Foil filter includes non-Foil printings and preferred Finish is ignored.

- [ ] **Step 3: Implement minimal helper changes**

Use `getAvailableFinishes(printing).includes("foil")` after the existing paper filter. Pass the optional preferred Finish into `chooseValidFinish` during replacement.

- [ ] **Step 4: Run `node --test core.test.js` and verify GREEN**

Expected: all core tests pass.

### Task 2: Printing Dialog Filter Control

**Files:**
- Modify: `app.integration.test.js`
- Modify: `app.js:108-165,1360-1455,2080-2140`

**Interfaces:**
- Consumes: the Task 1 helper signatures.
- Produces: transient `state.printingFinishFilter` with values `all | foil`.
- Produces: `[data-toggle-printing-finish-filter]` pill control.

- [ ] **Step 1: Add failing integration assertions**

Assert the app contains the transient filter state, the new data attribute and labels, passes the filter to `filterPrintings`, and passes a Foil preference into `replacePrinting` during selection.

- [ ] **Step 2: Run `node --test app.integration.test.js` and verify RED**

Expected: FAIL because the filter state and control do not exist.

- [ ] **Step 3: Implement the dialog behavior**

Reset the state to `all` on open. Render `版本 / 全部` or `版本 / 仅 Foil`, toggle it without saving, combine it with text search, and pass `foil` as preferred Finish only when selecting from Foil mode. Replace the dialog's old Finish event handler while leaving grid/list Finish handlers untouched.

- [ ] **Step 4: Run focused and full verification**

```sh
node --test app.integration.test.js core.test.js
npm run check
npm test
git diff --check
```

Expected: all commands exit zero.

- [ ] **Step 5: Verify in the browser**

Confirm the default label and full paper count, toggle to Foil-only and confirm count/list reduction, choose a Foil-capable version and confirm the resulting card is Foil, then restore the test card version if changed.

- [ ] **Step 6: Commit**

```sh
git add core.js core.test.js app.js app.integration.test.js
git commit -m "Filter printing selector by Foil support"
```
