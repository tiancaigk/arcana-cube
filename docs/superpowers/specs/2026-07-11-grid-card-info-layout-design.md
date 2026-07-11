# Grid Card Information Layout Design

## Goal

Compress the grid card information area from three rows to two without changing the list view.

## Grid Layout

The first row contains the Japan-print toggle, card name, and the existing Foil/Non-Foil button. The finish button occupies the position previously used by mana cost.

The second row contains set, collector number, price and price trend on the left, with the existing printing-selection button on the right.

Mana cost and card type are hidden in grid mode. They remain visible in list mode.

## Implementation

Keep one shared card template and one instance of each interactive control. Add stable classes to the type and printing metadata, then use CSS grid placement to flatten and reorder the existing row wrappers in grid mode. List-mode selectors restore the mana-cost and type elements and retain the current seven-column row layout.

No card data, filtering, sorting, persistence, or interaction behavior changes.

## Verification

- Add a source-level integration assertion for the metadata classes and two-row grid rules.
- Run syntax checks and the full test suite.
- Verify in the browser that grid cards show two information rows and list cards retain mana cost and type.
