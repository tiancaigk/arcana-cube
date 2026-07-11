# Printing Foil Filter Design

## Goal

Replace the printing dialog's current Finish mutation control with a compact printing filter that switches between all paper printings and Foil-capable paper printings.

## Interface

The existing pill position remains unchanged. Its label becomes `版本`, with a state value of `全部` or `仅 Foil`. Each click toggles the filter state. Opening the printing dialog resets the filter to `全部`.

The version count reflects the combined text search and Foil filter. Empty results reuse the existing empty-state message. Both states continue to exclude digital-only printings.

## Selection Behavior

The filter does not modify the card when toggled. Selecting a printing while `仅 Foil` is active updates the printing and sets the card Finish to `foil`. Selecting from `全部` preserves the current Finish when the new printing supports it and otherwise uses the existing valid-finish fallback.

The dialog continues to close after selection and records the version change through the existing persistence and change-log path.

## Scope

The card-grid and list Finish controls remain unchanged. Search matching, paper-printing identity checks, local-image invalidation, and dialog scrolling remain unchanged.

## Verification

- Test combined text and Foil filtering with paper and digital fixtures.
- Test selection policy for Foil-filtered and all-printing modes.
- Verify the dialog count, labels, empty state, and automatic Foil selection in the browser.
