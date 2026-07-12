# Basic Land Range Add Design

## Goal

Allow the basic-land add dialog to accept an inclusive numeric collector-number range such as `UST 112-115` and add every valid physical five-kind basic land found in that range.

## Interaction

- Reuse the existing `系列与编号` fields; no new lookup mode is added.
- A single collector number continues to work unchanged.
- Numeric `start-end` syntax is enabled only while adding basic lands.
- Ranges are inclusive, ascending, and limited to 100 collector numbers.
- Non-numeric range endpoints, descending ranges, and ranges over 100 entries are rejected without changing collection data.
- Literal single collector numbers containing special characters remain untouched and use the existing exact lookup path.

## Batch Behavior

- Expand a valid range into set/collector-number targets and use the existing Scryfall collection batch endpoint.
- Preserve partial success: add valid supported basic lands and skip invalid results.
- Skip missing printings, non-paper printings, cards outside Plains/Island/Swamp/Mountain/Forest, and already-collected Scryfall printings.
- Save Cube and change-log data once after the batch rather than once per card.
- Keep the dialog open after a range operation and render a result summary with added, missing, unsupported, and duplicate counts plus a per-number reason list.
- Single-printing addition retains its existing close-and-toast behavior.

## Boundaries

- Range lookup is unavailable for normal draft-pool cards.
- Added basics contribute to value and price history but remain outside the draft count and analytics.
- No Cube data schema change is required.

## Testing

- Unit-test range parsing for single values, inclusive ranges, malformed/descending input, special-character preservation, and the 100-item limit.
- Integration-test batch partial success, duplicate/unsupported/missing classification, one save cycle, result rendering, and draft-mode exclusion.
- Run all tests, syntax checks, and browser verification.
