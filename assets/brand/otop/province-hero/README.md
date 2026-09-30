# Isan province hero image set

Twenty conceptual hero images for the interactive OTOP map. Each image is composed as a close, frame-filling texture so it stays legible when clipped by an irregular province SVG path.

## Asset sets

- `master/`: 1,254 × 1,254 PNG generation masters.
- `web/`: 960 × 960 WebP production derivatives, approximately 130–300 KB each.
- `province-hero-manifest.json`: province boundary key, Thai/English product name, and selected asset paths.
- `province-hero-contact-sheet-v2.jpg`: approved-set overview in manifest order.
- `rejected/`: superseded or invalid generations; never reference these in the UI.

## Shared generation direction

Premium editorial imagery for an Isan boutique marketplace; photorealistic Thai craft and food; close-up frame-filling composition; warm natural light; deep indigo, teak, clay, muted gold and warm ivory; tactile natural materials; restrained luxury. No people, hands, text, labels, logos, watermark, border, or empty packshot background.

## UI use

Use the `web` image as an `object-fit: cover` fill clipped by the matching `geoShapeName` path. Keep inactive provinces neutral. Load the selected province image on interaction rather than preloading all twenty full-resolution masters.

Display this disclosure near the prototype map or product details:

> ภาพจำลองเพื่อการนำเสนอแนวคิด สินค้าและรายละเอียดจริงอาจแตกต่างออกไป
