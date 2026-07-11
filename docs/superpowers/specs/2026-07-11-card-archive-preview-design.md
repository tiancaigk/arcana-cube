# Card Archive Preview Design

## Goal

Replace the current image-only preview with a desktop two-column card archive. The left side presents the highest-quality available card images; the right side presents durable card and printing metadata plus the existing price-history view.

## Layout And Interaction

- Use the existing `imagePreviewDialog` and restyle its content as a two-column desktop layout.
- The left column shows the front image. Double-faced cards show front and back images together within the left column.
- The right column shows the card archive details and remains independently readable when its content is taller than the image.
- Clicking a card image or the dialog backdrop closes the preview, preserving the current interaction.
- Clicking anywhere in the details panel does not close the dialog.
- The dialog remains constrained to the desktop viewport and scrolls internally when necessary.

## Information Hierarchy

The right column contains:

1. English and currently selected localized card name, card type, and mana cost.
2. Finish, set code and collector number, and Japan-print status.
3. Oracle rules text. Double-faced cards label and display front and back rules separately when available.
4. Set name, rarity, artist, release date, color, and mana value.
5. Current price for the selected finish and the existing per-card price-history chart.

Missing optional metadata renders as `暂无资料`; it never prevents the image preview from opening.

## Data Model

Extend normalized card records with:

- `oracleText`: front-face Oracle text, or the single-face Oracle text.
- `backOracleText`: back-face Oracle text when present.
- `artist`: front/single-face artist.
- `backArtist`: back-face artist when present.
- `setName`: full Scryfall set name.
- `releasedAt`: Scryfall release date.

All fields default to an empty string for old or incomplete records. Existing storage migration remains compatible because normalization supplies those defaults without changing the schema version.

## Metadata Enrichment

- The preview opens immediately with locally available data.
- If archive metadata is incomplete and the card has a Scryfall ID, request that exact printing through the existing catalog layer.
- Apply the enriched metadata only if the same preview/card is still active when the response completes.
- Persist enriched card data through the existing Cube persistence path and rerender the open preview.
- Network failure leaves the preview usable and shows unavailable fields as `暂无资料`; it does not show a blocking error dialog.
- Avoid repeated failed requests during the same session by tracking attempted card IDs.

## Boundaries

- The preview is read-only; finish, printing, and Japan-print controls remain in the card grid/list.
- No mobile-specific layout is introduced because the project targets desktop browsers.
- The price-history storage format and chart calculation do not change.
- Scryfall remains the authoritative source for card and printing metadata.

## Testing

- Core normalization tests cover single-faced and double-faced archive metadata.
- Catalog tests cover exact-printing lookup used by enrichment.
- Integration tests cover the two-column archive markup, metadata labels, and non-closing details panel.
- Browser verification covers single-faced layout, filter-independent opening, dialog close behavior, and absence of console errors.
