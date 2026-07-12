# Basic Land Set Number Order Design

## Goal

In the basic-land archive's `按系列` mode, display every printing in natural ascending collector-number order regardless of basic-land kind.

## Behavior

- Keep set groups ordered by release date from newest to oldest.
- Sort cards inside each set only by collector number using numeric-aware natural ordering.
- Preserve collector-number suffixes and special characters; do not sanitize stored values.
- Keep `按类别` grouping unchanged: fixed five-kind groups, then release date and collector number within each kind.
- Do not change saved data, prices, exports, or card operations.

## Testing

- Replace the existing set-group test expectation with an input where kind order conflicts with number order.
- Confirm natural ordering such as `2`, `9`, `10`, `126`, `126★`, `127`.
- Run the complete test and syntax-check suites.
