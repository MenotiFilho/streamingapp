# The Marquee mockup

The drawing behind ADR-0043 and `docs/design-system.md`. It is a script that writes
a `.fig` file, so a change to the design is a reviewable change to code. The `.fig`
opens in Figma or in figlens. Nothing is installed on the host: both steps run in
throwaway containers.

```sh
scripts/fetch-assets.sh   # once: Cinemeta/metahub artwork and metadata into assets/
scripts/build.sh          # writes streamingapp-ui.fig and renders every frame to preview/
```

A full build takes a few minutes.

## What the file holds

| Page | What |
|---|---|
| Foundations | colour, type, the focus rule, radius and spacing |
| Components | sheets C0 Icons … C8 Remote (phone): every component, with its variants and properties |
| Screens | one row per area, the window's screens first and the phone's beside them |

Screens are composed only from the components. A screen that needs something the
library does not have gets a new component first.

## Working in `scripts/build.js`

- `variants()` and `single()` declare a component on a sheet; `use()` places an
  instance of one, choosing the variant and overriding text, images, logos, icons
  and visibility.
- **figlens draws an instance's overridden text from its main component**, because
  OpenPencil never stores glyphs for an override. So `use()` detaches any use whose
  text changes and names it after its component. `KEEP_LINKS=1 scripts/build.sh`
  keeps every use linked, which is right for Figma and wrong in figlens.
- Images, fills, visibility and icon swaps render fine on a linked instance.
  Moving a layer inside an instance is refused, so a logo swap detaches.
- New vector outlines are stored by hand (`storeOutline`). SVG strokes, ellipses
  and arcs do not render in figlens, so icons are filled Phosphor glyphs and ring
  shapes are SVG paths.
- Detaching drops the glyph swaps of the icons inside; `detachDeep` puts them back
  by matching each glyph's outline.

## What is not committed

`assets/` (third-party artwork, pinned to the titles in `scripts/assets.py`),
`tools/` (the containers' npm install), `preview/` and the `.fig`. All of it comes
back from the two commands above.
