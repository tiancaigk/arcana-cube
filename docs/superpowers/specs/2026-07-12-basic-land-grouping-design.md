# Basic Land Grouping Design

## Goal

Allow the basic-land archive to switch between grouping by basic-land kind and grouping by set, while keeping all existing card operations and value calculations unchanged.

## User Interface

- Add a compact segmented control to the basic-land heading with two options: `按类别` and `按系列`.
- Keep `按类别` as the default for users who have no saved preference.
- Persist the selected grouping mode in browser storage and restore it on the next visit.
- Both grouping modes use a five-column card grid on desktop so each row contains five basic lands.
- The five-column rule applies only to the basic-land archive and must not change the draft-pool grid.

## Grouping Rules

### By Basic-Land Kind

- Keep the fixed group order: Plains, Island, Swamp, Mountain, Forest.
- Within each group, sort cards by set release date from newest to oldest, then by collector number.

### By Set

- Group cards by Scryfall set identity, using the set code as the stable key and the set name as the displayed label.
- Show the set name, uppercase set code, release date, and card count in each heading.
- Sort set groups by release date from newest to oldest.
- Put sets without a usable release date after dated sets; order those fallback groups by set name.
- Within a set, sort by the fixed five-kind order and then by collector number.

## Data And Compatibility

- Do not change the saved Cube data schema. Grouping is a presentation preference only.
- Use the existing card fields for set name, set code, release date, and collector number.
- Cards with missing set metadata remain visible in an `未知系列` fallback group.
- Existing preview, finish, Japan-print, price, version selection, removal, backup, and export behavior remains unchanged.
- Basic lands continue to contribute to total value and price history while remaining excluded from the draft-pool count and analytics.

## Testing

- Test that the segmented control and five-column basic-land grid contract exist.
- Test kind grouping and its fixed order.
- Test set grouping from newest to oldest.
- Test undated and missing-set fallback behavior.
- Run the full automated suite and syntax checks.
- Verify both grouping modes in the local browser without modifying the user's collection.
