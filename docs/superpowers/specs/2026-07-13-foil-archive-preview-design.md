# Foil Archive Preview Design

## Goal

Apply the approved high-impact showcase Foil treatment to card images in the large archive/details dialog.

## Visual Behavior

- Only cards whose current collection finish is `foil` receive the effect.
- Wrap each preview image in a dedicated frame so effects never cover or alter the details panel.
- Use a bright animated rainbow border, colored ambient glow, and a broad screen-blended reflection band without a dark center line.
- Keep the card art fully legible and preserve the existing rounded card shape.
- For double-faced cards, apply the treatment independently to both front and back images.
- Non-Foil previews retain their current image and shadow styling.

## Interaction And Accessibility

- Clicking either card image still closes the preview.
- Clicking the details panel still does not close it.
- The top-right close button and background-close behavior remain unchanged.
- Under `prefers-reduced-motion: reduce`, freeze the reflection and hue animation at a representative static state.

## Scope

- Reuse the approved visual direction; do not change the dialog layout or card data.
- Do not change the existing collection-grid Foil effect.

## Testing

- Verify the preview markup exposes finish state and wraps every image.
- Verify Foil-only frame, border, glow, reflection, double-face, and reduced-motion CSS contracts.
- Verify existing close interactions remain covered.
- Run all automated tests, syntax checks, and local browser visual verification.
