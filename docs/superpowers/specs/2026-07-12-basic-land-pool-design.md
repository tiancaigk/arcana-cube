# Basic Land Pool Design

## Goal

Manage individually distinct Plains, Island, Swamp, Mountain, and Forest printings as part of the Cube collection value without counting them in the 600-card draft pool or draft analytics.

## Data

- Add `basicLands: []` beside `cards: []` in Cube data.
- Every entry is a complete normalized card record with its own printing, finish, Japan-print flag, images, and price.
- Only exact front names `Plains`, `Island`, `Swamp`, `Mountain`, and `Forest` are accepted.
- Wastes and snow-covered basics are rejected.
- Duplicate Scryfall printing IDs are rejected within `basicLands`.
- Data migration adds an empty array to old Cube files.

## UI

- Add a third primary navigation item named `基本地`.
- The page groups entries in fixed order: 平原、海岛、沼泽、山脉、树林.
- Show total basic-land count, each group count, and basic-land subtotal.
- Reuse card images, finish toggle, Japan-print toggle, printing selector, image archive, and removal behavior.
- The shared add dialog changes to basic-land mode while opened from this page and validates both name and set/collector lookups.

## Statistics And Price

- Draft count, color balance, card types, and mana curve continue to consume only `cards`.
- Total collection value, total price history, price refresh, and daily price changes consume `cards + basicLands`.
- Basic-land page subtotal is computed from `basicLands` only.

## Portability

- `cube-data.json` and JSON backups naturally include `basicLands`.
- Excel exports keep `Cube 牌表` unchanged and add a `基本地` worksheet.
- No new workspace file is introduced.

## Testing

- Migration and core tests protect old data and five-name classification.
- Price-history tests protect combined totals.
- App integration tests protect navigation, exclusion from draft analytics, add validation, and the extra Excel sheet.
- Browser verification covers adding and interacting with one basic land without changing draft count.
