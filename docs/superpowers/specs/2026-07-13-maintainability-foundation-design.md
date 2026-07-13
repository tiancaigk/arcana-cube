# Maintainability Foundation Design

## Goal

Improve Arcana Cube's maintainability without changing its UI, saved-data schema, or user-visible workflows. Establish small module boundaries and a consistent mutation pipeline before attempting larger extractions from `app.js`.

## Scope

### Local Server Configuration

- Make `scripts/local-server.js` honor `--host` while preserving `127.0.0.1` as the safe default.
- Validate host and port parsing through exported pure helpers.
- Keep the Scryfall image proxy and static-file protections unchanged.

### Basic-Land Domain Module

- Create `basicLands.js` as the owner of collector-range parsing, category/set grouping, and batch-result classification.
- Keep generic card identity helpers such as `getBasicLandKind()` in `core.js` because they are also shared predicates.
- Move existing behavior without changing sorting, range limits, duplicate detection, or accepted land kinds.
- Add direct unit tests for partial-success batch classification rather than relying only on application-source assertions.

### Collection Command Executor

- Create `collectionCommands.js` to consistently execute successful collection mutations.
- A command descriptor may contain one or more change-log entries, dirty persistence domains, a render request, and a toast message.
- The executor records all changes with deferred persistence, saves once, requests rendering once, then displays feedback.
- Adopt it for version replacement, Finish changes, Japan-print changes, individual additions, range additions, removal, and undo removal.
- Validation failures remain in their owning action and do not execute a command.

### View Preferences

- Create `viewPreferences.js` for safely loading and saving constrained browser preferences.
- Move card-name language and basic-land grouping persistence to the module.
- Continue to default to English names and category grouping when storage is missing or unavailable.

### Documentation And Tests

- Add `ARCHITECTURE.md` describing ownership boundaries, state domains, persistence, render scheduling, and the mutation pipeline.
- Replace relevant source-presence checks with direct module behavior tests where practical.
- Update script ordering and syntax checks for every new browser module.

## Non-Goals

- No framework migration.
- No UI redesign or CSS reorganization.
- No Cube schema migration.
- No large extraction of preview, price, or import/export rendering in this phase; the new boundaries prepare those later extractions.

## Success Criteria

- All existing workflows behave the same.
- New modules have focused direct tests.
- Collection mutations adopted in this phase cannot forget persistence or rendering independently.
- `npm test`, `npm run check`, browser smoke tests, and `git diff --check` pass.
