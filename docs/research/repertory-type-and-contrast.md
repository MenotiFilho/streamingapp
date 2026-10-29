# Ten-foot type and measured contrast for the repertory direction

**Ticket:** #144 (wayfinder map #143). **Run:** 2026-10-29 from the WSL host.
**Real client:** the Windows machine's WebView2 runtime, read from the
EdgeUpdate registry key as **156.0.4314.50**. No windowed walkthrough was run
for this note; the numbers below are from package metadata, the font binaries,
the standards, and one local registry query. Rendering on the actual panel is
still the prototype's job.

Scope: offline Fontsource families for three roles (display serif, UI grotesk,
mono), ten-foot sizing, WCAG 2.2 contrast pairs, tabular numerals, and the
WebView2/offline risks. Not in scope: choosing the final design, the Remote's
surface shape, iconography, motion, or artwork fallbacks. This note is evidence
for the prototype, not a design lock.

---

## Verdict

- The three-role split holds: a high-contrast serif for Titles, a quiet grotesk
  for controls/body, and a mono for timecode. The serif must not do UI work; a
  serif Title wants 48 CSS px or more on a 1080p canvas at ten feet, and must
  never go below 40.
- A ten-foot scale is roughly **1.75–2× the desk scale**: body **28–32 px**,
  captions **24 px**, section headers **32–38 px**, titles **48–64 px**, hero
  **72–96 px** at 1920×1080 CSS px. The current Velvet tokens (`--text-body:
  0.95rem` = 15.2 px, `--text-caption: 0.8125rem` = 13 px) are desk-scale and
  too small for ten feet.
- The measured palette is ink `#0B0A09`, ivory `#F2E9D8`, dim ivory `#C8BDA9`,
  muted ivory `#8C8375`, hairline `#6E6659`, and house brass `#C9A45C`. Every
  text pair in the recommended set clears 4.5:1; the hairline clears 3:1 as a
  non-text rule; ivory-on-brass is **1.95:1** and must never be used for text.
- The WebView2/offline path is straightforward: bundle the woff2 files, set
  `font-src 'self'`, and do not depend on a CDN. The real risks are bundle
  granularity (Fontsource's package CSS emits every subset, and the static Plex
  Mono package emits woff *and* woff2), first-frame FOUT, and the 4K-at-100%
  scaling trap where a rem-capped scale becomes physically half-size.
- The first prototype should test **two** pairings, not three:
  **Bodoni Moda + Inter + IBM Plex Mono** (drama, clarity, programme) and
  **Playfair Display + IBM Plex Sans + IBM Plex Mono** (one warm family system).
  Fraunces + Archivo + JetBrains Mono is the third option if the first reads too
  brittle or too fashion-masthead.

---

## What was measured, and how

1. **Package metadata.** The npm registry was queried for the candidate
   packages at their current `latest` (all `5.3.0` on 2026-10-29): licence,
   `unpackedSize`, file count, and tarball URL. The tarballs were downloaded and
   unpacked; the CSS entry points and the `files/` directories were inspected.
2. **Font binaries.** The Latin normal woff2 of each candidate was opened with
   fontTools **4.66.1**. The following were read from the file, not from a web
   page: `fvar` axes, `OS/2` `sxHeight`/`sCapHeight`, `hhea` ascender/descender,
   GSUB feature tags, digit advance widths, and the `tnum` substitution targets.
3. **Google Fonts metadata.** `METADATA.pb` for each shortlisted family was read
   from `google/fonts` to corroborate licence and axes [24].
4. **Contrast.** The WCAG 2.2 sRGB formula was implemented directly
   (`L = 0.2126 R + 0.7152 G + 0.0722 B`, with the 0.04045 linearisation) and
   every ratio in this note was computed from the hex values; none is eyeballed
   [1]. The calculation is reproducible from the formula quoted in §3.1.
5. **The real fallback fonts.** The Windows font files (`segoeui.ttf`,
   `SegUIVar.ttf`, `georgia.ttf`, `times.ttf`, `consola.ttf`,
   `CascadiaMono.ttf`, `arial.ttf`, `verdana.ttf`) were read from
   `/mnt/c/Windows/Fonts` with fontTools. Their metrics are used for the
   fallback stacks in §1 and the `size-adjust` suggestions in §5.
6. **The runtime.** `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\
   {F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}\pv` on the Windows machine returned
   `156.0.4314.50`.

Where a statement below is a **recommendation** rather than a measurement, it
says so. In particular: the exact type scale, the tracking of all-caps labels,
and the final pairing are prototype hypotheses; the contrast ratios, font
metrics, axes, package sizes, and platform minima are measured or quoted.

---

## 1. The three roles and the shortlist

All eight shortlisted packages are **SIL Open Font License 1.1** (`OFL-1.1`),
both in the npm metadata and in the package `LICENSE`; the Google Fonts metadata
agrees (`license: "OFL"`) [24][27]. No Apache-licensed family is in the
shortlist. Package sizes are the npm `unpackedSize` (the whole package: all
subsets, weights, italics, CSS and metadata), not what the app ships. The
"Latin woff2" column is the single upright Latin normal file that a lean bundle
would ship.

### 1.1 Shortlist

| Role | Family | Fontsource package | Axes in the package | Package (unpacked) | Latin woff2 | x-height / cap | `tnum` | Why it is here |
|---|---|---|---|---:|---:|---|---|---|
| Serif | **Bodoni Moda** | `@fontsource-variable/bodoni-moda` | `wght 400–900`, `opsz 6–96`, `ital 0–1` | 789 KB | 45.2 KB | .460 / .750 | yes | The strongest Didone; opsz lets one file serve 48–96 px titles; the most "repertory playbill" of the three. Brittle at small sizes. |
| Serif | **Playfair Display** | `@fontsource-variable/playfair-display` | `wght 400–900`, `ital 0–1` | 203 KB | 37.5 KB | .514 / .708 | no | High contrast with a much larger x-height than Bodoni; the safest high-contrast serif; smallest package. No tabular figures (irrelevant for Titles). |
| Serif | **Fraunces** | `@fontsource-variable/fraunces` | `wght 100–900`, `opsz 9–144`, `SOFT 0–100`, `WONK 0–1`, `ital 0–1` | 1.84 MB | 65.7 KB | .482 / .700 | no | Warmer, softer, less brittle; a letterpress-programme voice rather than a fashion masthead; full-axis file available. |
| Grotesk | **Inter** | `@fontsource-variable/inter` | `wght 100–900`, `opsz 14–32`, `ital 0–1` | 1.82 MB | 71.2 KB | .546 / .728 | yes | The largest x-height and the quietest UI face; best at distance; true tabular figures. The default safe choice. |
| Grotesk | **IBM Plex Sans** | `@fontsource-variable/ibm-plex-sans` | `wght 100–700`, `wdth 75–100`, `ital 0–1` | 1.35 MB | 64.0 KB | .516 / .698 | default tabular | Humanist warmth, no gimmick, and it pairs with IBM Plex Mono for the timecode. Default digits are already tabular (all 600 units). |
| Grotesk | **Archivo** | `@fontsource-variable/archivo` | `wght 100–900`, `wdth 62–125`, `ital 0–1` | 1.03 MB | 88.0 KB | .526 / .686 | yes | A true grotesk with a width axis and strong caps; the best of the three for dense metadata and tracked section labels. |
| Mono | **IBM Plex Mono** | `@fontsource/ibm-plex-mono` | static `100–700` + italics (no variable package) | 1.42 MB (244 files) | 14.4 KB (400) | .516 / .698 | tabular by construction | The most "film programme" mono; dotted zero; pairs with Plex Sans; the smallest single face. |
| Mono | **JetBrains Mono** | `@fontsource-variable/jetbrains-mono` | `wght 100–800`, `ital 0–1` | 199 KB | 39.5 KB | .550 / .730 | tabular by construction | Taller x-height and a marked zero; reads at distance without looking like code; variable, one file. |

Sources: npm registry and package tarballs [23]; axes and metrics from the
actual woff2 files; Google Fonts `METADATA.pb` for the same axes/licence [24].
The `tnum` column is the observed GSUB feature and its measured equal-width
substitution, not a marketing claim; see §4.

### 1.2 The serif candidates in detail

**Bodoni Moda.** `fvar` axes `wght 400–900` and `opsz 6–96` [23]. Its x-height is
.460 em, the lowest of the shortlist; a Bodoni title needs **33.2 px** to match
the lowercase height of Inter at 28 px, so a Bodoni title must be set larger
than an Inter title to look equally tall. The 400 weight is hairline-heavy; at ten feet the safe
range is 500–600 at 48–96 px, not 400 at 32 px. The `opsz` axis is the reason to
use it: 48–96 px gets the display cut; `font-optical-sizing: auto` follows the
computed font size. It has `tnum`, but it is a display face, not a timecode face.

**Playfair Display.** `wght 400–900`, no `opsz` in the Fontsource package [23].
x-height .514 em, cap .708; at 28 px it needs **29.7 px** to match Inter's
lowercase height. It is the sturdiest of the three at medium sizes and the
cheapest package (38 KB Latin). It has no `tnum` (the GSUB features are `calt`,
`ccmp`, `dnom`, `frac`, `liga`, `lnum`, `locl`, `numr`, `rlig`), so it must not
carry timecode or a column of numbers. It is the safest first prototype serif.

**Fraunces.** `wght 100–900`, `opsz 9–144`, `SOFT 0–100`, `WONK 0–1` [23]. The
`standard.css` entry point ships the `opsz`+`wght` file (65.7 KB Latin); the
`full.css` entry point ships all four axes. x-height .482 em, cap .700; at 28 px
it needs **31.7 px** to match Inter. `SOFT` rounds terminals; `WONK` turns on the
quirky alternate letterforms. It has no `tnum`. It is the warm option: good if the
programme should feel letterpress rather than couture.

**Rejected serif candidates.** **Cormorant Garamond** has a beautiful high
contrast but an x-height of .386 em: it needs **39.6 px** just to match Inter at
28 px, and its light strokes do not survive at a caption size. It is a
desk/print face, not a ten-foot face. **Newsreader** is a quiet reading serif
(x-height .426; default tabular; `tnum`) and would be a good body serif, but it
is not a display serif; the map asks for a high-contrast display face.
**Instrument Serif** is static (400 only) and has no variable package [23]; it
is charming but it cannot carry a weight range or an optical size.

### 1.3 The grotesk candidates in detail

**Inter.** x-height .546 em, the largest measured; cap .728. `opsz` 14–32 only,
so it is a UI face, not a display face; at 48 px the optical size clamps at 32.
It has `tnum` (all ten digits map to equal 1328-unit `.tf` glyphs). At 28 px its
x-height subtends 10.9 arcmin on a 55-inch 1080p panel at ten feet (§2); that is
the reference against which the serifs were compared.

**IBM Plex Sans.** x-height .516, cap .698; `wght 100–700`, `wdth 75–100`. Its
default digits are already tabular (all ten are 600 units), so
`font-variant-numeric: tabular-nums` is a no-op but harmless. It is slightly
warmer and less neutral than Inter, and it is the natural partner of Plex Mono.
At 28 px it needs **29.6 px** to match Inter's x-height.

**Archivo.** x-height .526, cap .686; `wght 100–900`, `wdth 62–125`; `tnum`
targets are all 579 units. The width axis is useful for dense metadata and for
section labels that need to be tracked without becoming a second family. It has
more character than Inter and less warmth than Plex Sans; at 28 px it needs
**29.1 px** to match Inter.

**Rejected/also measured grotesks.** **Schibsted Grotesk** is the lightest good
alternative (45.7 KB Latin, `wght 400–900`, x-height .527, `tnum`); it is quieter
than Archivo and more editorial than Inter, but it has no width axis. **Work
Sans** (49.1 KB Latin, x-height .500, `tnum`) is friendly and slightly quirky.
**Instrument Sans** (56.0 KB, `wght 400–700`, `wdth 75–100`, x-height .510,
`tnum`) is a fine grotesk but its weight range stops at 700, which is enough for
UI but not for a heavy poster caption. **Plus Jakarta Sans** (26.7 KB, x-height
.536, `tnum`) is the current face; it is competent but reads soft/geometric
rather than repertory, and the direction explicitly supersedes the Velvet
tokens.

### 1.4 The mono candidates in detail

**IBM Plex Mono.** Static weights 100–700 plus italics; there is **no**
`@fontsource-variable/ibm-plex-mono` (the registry returns 404) [23]. The Latin
400 woff2 is 14.4 KB. All ten digits are 600 units; the zero is dotted, and the
`1` has a base serif and a flag; at 150 px the `0`/`O` and `1`/`I`/`l` pairs are
unambiguous (visually checked). It pairs with Plex Sans and has the strongest
"printed programme" voice.

**JetBrains Mono.** Variable `wght 100–800`; 39.5 KB Latin. Digits are 600 units;
x-height .550, the tallest of the shortlisted monos; the zero is dotted; the `l`
has a tail.
It reads slightly more "code" than Plex Mono, but its taller lowercase makes it
the better pure timecode face at ten feet.

**Rejected/also measured monos.** **Roboto Mono** (32.0 KB Latin, `wght 100–700`,
x-height .528, tabular) is the neutral fallback; it has less character and a
slightly lower x-height. **Geist Mono** (22.6 KB Latin, `wght 100–900`, x-height
.530) is compact and modern. **Azeret Mono** (25.6 KB Latin, `wght 100–900`,
x-height .544) is quirkier. **Martian Mono** (37.6 KB Latin, `wght 100–800`,
`wdth 75–112.5`, x-height .600) is the sturdiest at distance but too wide and
too heavy for the quiet programme voice.

### 1.5 Fallback stacks

The stacks end in fonts actually present in the Windows 11 font list [25], with
the metrics read from the Windows files; Didot and Bodoni MT are optional
bonuses, not dependencies. Put the bundled face first; the fallback is only for
a failed asset or a first frame.

| Role | Stack | Why these fallbacks |
|---|---|---|
| Bodoni | `"Bodoni Moda Variable", "Bodoni Moda", Didot, "Bodoni MT", Georgia, serif` | Georgia is the Windows serif with the closest x-height (.481) and cap (.693); Didot/Bodoni MT are bonus if installed, not dependencies. |
| Playfair | `"Playfair Display Variable", "Playfair Display", Georgia, "Times New Roman", serif` | Georgia is sturdier than Times (x-height .481 vs .447) and keeps a title from collapsing to a thin line. |
| Fraunces | `"Fraunces Variable", Fraunces, Georgia, serif` | Fraunces' x-height (.482) is almost exactly Georgia's (.481); the fallback changes the voice but not the size. |
| Inter | `"Inter Variable", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` | Segoe UI Variable Text is the Windows 11 UI face (x-height .500); `system-ui` is the last resort. |
| Plex Sans | `"IBM Plex Sans Variable", "IBM Plex Sans", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` | Plex's x-height (.516) is only 3.2% above Segoe's; a small `size-adjust` closes the gap if FOUT is visible. |
| Archivo | `"Archivo Variable", Archivo, "Segoe UI", system-ui, sans-serif` | Segoe UI is the closest metric match on Windows; Archivo's caps are slightly lower, so titles may look a touch smaller. |
| Plex Mono | `"IBM Plex Mono", "Cascadia Mono", Consolas, ui-monospace, monospace` | Cascadia Mono (x-height .518) is a closer match than Consolas (.490); Consolas is the Windows 10-safe fallback. |
| JetBrains Mono | `"JetBrains Mono Variable", "JetBrains Mono", "Cascadia Mono", Consolas, ui-monospace, monospace` | JetBrains' .550 x-height is closest to Cascadia Mono; Consolas is the safe second. |

The exact fallback metrics and the optional `size-adjust` percentages are in
§5.5. Do not use `local()` as the primary source: it makes the design depend on
which fonts the machine happens to have, and the fallback metrics differ.

### 1.6 Licence and packaging facts

All shortlisted files are OFL-1.1. The OFL allows bundling with any software,
including a GPL-3.0 application; it does not make the app OFL, and it does not
require the app's source to be released [28]. The conditions that matter here:

- Each copy must carry the copyright notice and the licence text; a stand-alone
  `OFL.txt` in the installer resources or an About/credits screen is the
  practical route. The OFL FAQ recommends the copyright statement, the licence
  notice and the licence text for an app bundle, even though a bundled program
  can in some cases omit the full text [28, FAQ 1.10 and 1.20].
- Do not rename the font. A modified version may not use the Reserved Font Name
  without permission [27, condition 3].
- **Do not subset further.** The OFL FAQ treats subsetting as modification
  [28, FAQ 2.6]. Fontsource's shipped subsets are already prepared by the
  distributor; re-subsetting them in this repo would make the app the modifier
  and would raise the Reserved Font Name question. If a smaller file is needed,
  use the distributor's Latin file as shipped and keep its metadata, or rename
  the derivative and accept the OFL obligations.
- The package `LICENSE` files are the OFL text with the copyright line for each
  family; keep them next to the font files in the bundle.

---

## 2. Ten feet, not two feet

### 2.1 Why the CSS pixel is not a ten-foot unit

CSS defines the reference pixel at a nominal arm's length: 0.26 mm at 28 inches,
and 1.3 mm at 12 feet [8]. The same CSS pixel therefore subtends about five times
as much angle at 12 feet as at 28 inches. On a real 55-inch 1080p panel at ten
feet, one CSS pixel (at 100% Windows scaling) is 0.715 arcmin of visual angle;
the panel is 47.94 × 26.96 inches, so 1920 px across 47.94 inches gives
0.02497 in/px, and `atan(0.02497/120)` is 0.715 arcmin. At 28 inches on a
24-inch 1080p monitor, one CSS pixel is 1.56 arcmin. The ten-foot pixel is less
than half the desk pixel in angular terms, which is why a 15 px body that looks
fine at the desk is unreadable across the room.

Microsoft makes the same point from the platform side: a 1080p TV at ten feet
has "only 540 effective pixels" and is more like a 540-pixel monitor than a
1080p monitor [13]. UWP/XAML applies that viewing-distance scaling
automatically. **A Tauri WebView2 window does not**: it is a web page in a Win32
window, and its CSS pixels are scaled only by Windows display scaling, not by
viewing distance. That is the central sizing risk for this app, and the reason
the repertory shell must bake the ten-foot scale into its own tokens.

### 2.2 Platform anchors for ten-foot text

These are first-party platform guidelines, not design blogs. They converge on a
body floor of roughly 26–29 px at 1080p:

| Source | What it specifies | Consequence for this app |
|---|---|---|
| Apple tvOS HIG [12] | Body **29 pt / 36 pt leading**; Caption 1 25/32; Caption 2 23/30; Title 3 48/56; Title 2 57/66; Title 1 76/96 (at 1080p @1x). | The closest thing to a complete ten-foot type scale. Body 29 px, captions 23–25 px, titles 48–76 px. |
| Amazon Fire TV [16] | Body text **at least 14 sp**, approximately 28 px on 1080p; use greater line spacing than desktop; cool colours (blue, purple, grey) work better than warm (red, orange). | A 28 px body floor and a warning against a hot orange/red house colour on TV. |
| Microsoft Xbox/TV [14] | Main text and reading content **15 epx minimum**; non-critical text 12 epx; UWP scales 200% for XAML and 150% for HTML apps at 1080p. | At 200% scaling the 15 epx floor becomes 30 physical px; the "effective pixel" is doing the viewing-distance work. |
| Xbox Accessibility Guideline 101 [15] | Console text **26 px at 1080p** (52 px at 4K); PC/VR text 18 px at 1080p (36 px at 4K). | A hard floor for a ten-foot console-like UI: 26 px at 1080p. |
| WCAG 2.2 [1] | "Large scale" is 18 pt (24 px) or 14 pt bold (18.66 px); below that, the 4.5:1 text threshold applies. | 24 px is also a useful semantic boundary: at 24 px and above the large-text 3:1 rule applies. |

The convergence is strong: **28 px body, 24 px caption, 48 px title** at a
1920×1080 logical canvas. Apple is the most generous at the top (76 px Title 1)
and at the body (29 px); Amazon's 28 px body is a close second; Xbox's 26 px is
the conservative floor.

### 2.3 Proposed ten-foot scale

These are **recommendations to test**, expressed in CSS px on a 1920×1080
logical canvas. The desk column is the same role at a 2-foot monitor; it is the
comparison scale for the owner's verification monitor, not an automatic
breakpoint. A viewport media query cannot tell 2 feet from 10 feet: a 1366 px
window at the desk and a 1920 px TV across the room can have the same CSS width
but need different physical sizes. The repertory shell should either stay at the
TV scale everywhere (and look large on a desk) or expose an explicit viewing-mode
preference; it should not infer distance from width. The prototype's desk pass is
for legibility verification, not a second production scale.

| Role | 1080p @ 10 ft | 2 ft desk | Weight | Line height | Tracking | Face |
|---|---:|---:|---:|---:|---:|---|
| Hero / Home feature title | 72–96 px | 40–48 px | 500–600 | 1.05–1.15 | −0.010 to −0.016 em | Serif |
| Title / detail-page title | 48–64 px | 32–40 px | 500–600 | 1.10–1.20 | −0.010 to −0.014 em | Serif |
| Section header | 32–38 px | 20–24 px | 500–600 | 1.15–1.25 | 0; +0.04–0.06 em if all caps | Grotesk, or serif only if short |
| Body / description | 28–32 px | 16–18 px | 400 | 1.35–1.45 | +0.005 to +0.012 em | Grotesk |
| Caption / metadata | **24 px floor** | 13–14 px | 400–500 | 1.25–1.35 | +0.008 to +0.014 em | Grotesk |
| Control label | 26–28 px | 15–16 px | 500 | 1.20 | +0.005 to +0.010 em | Grotesk |
| Timecode | 24–28 px | 13–14 px | 400–500 | 1.00–1.10 | 0 | Mono |
| Eyebrow / programme label | 22–24 px | 12–13 px | 500 | 1.20 | +0.04–0.06 em (caps) | Grotesk |

Why these numbers:

- **Body 28–32 px.** This is Amazon's 28 px floor and close to Apple's 29 px
  body. At 28 px, Inter's x-height is 10.9 arcmin on a 55-inch 1080p panel; at
  24 px it is 9.4 arcmin. The 28 px body is the smallest size that still reads
  as a body rather than a caption at ten feet.
- **Caption 24 px floor.** Apple's Caption 2 is 23 px; Amazon's body floor is
  28 px. 24 px is the WCAG large-text boundary and keeps the caption from
  becoming a squint. Anything below 24 px should be non-critical only, and its
  contrast should still clear 4.5:1.
- **Title 48–64 px.** Apple's Title 3 is 48 px and Title 2 is 57 px. A 48 px
  serif has a Playfair x-height of 17.6 arcmin and a Bodoni x-height of 15.8
  arcmin; at 64 px those become 23.5 and 21.1. The lower end is for long titles;
  the upper end is for a hero.
- **Hero 72–96 px.** Apple's Title 1 is 76 px; 96 px is the top of Bodoni's
  `opsz` axis and a reasonable maximum before a title starts to crowd the
  artwork. Do not exceed 96 px on a 1080p canvas unless the string is very
  short.
- **Control labels 26–28 px.** They are read at a glance while navigating, not
  parsed; the Xbox 26 px console floor and the Amazon 28 px body floor bracket
  this. The 22 px eyebrow is the one deliberate exception: it is a short,
  non-critical label, and it must still clear 4.5:1.

**The current tokens are not this scale.** `src/tokens.css` has
`--text-body: 0.95rem` (15.2 px) and `--text-caption: 0.8125rem` (13 px); on a
55-inch 1080p panel at ten feet those are 10.9 and 9.3 arcmin em, with Inter
x-heights of 5.9 and 5.1 arcmin. They are roughly half the angular size of
Apple's 29 px body. The comment says "10-foot calibrated", but the values are
desk-scale. The repertory tokens should replace them, not inherit them. (The
same file carries the current `--display-tracking: -0.025em` and
`--accent: #ff4d4d` discussed below.)

### 2.4 The serif must give way to the UI face

Measured x-heights make the rule concrete. To match Inter at 28 px:

| Face | x-height (em) | Size needed to match Inter 28 px | At 48 px, x-height (arcmin, 1080p @10 ft) |
|---|---:|---:|---:|
| Inter | .546 | 28.0 px | 18.7 |
| Playfair Display | .514 | 29.7 px | 17.6 |
| Fraunces | .482 | 31.7 px | 16.5 |
| Bodoni Moda | .460 | 33.2 px | 15.8 |
| Cormorant Garamond | .386 | 39.6 px | 13.3 |
| Plex Sans | .516 | 29.6 px | 17.7 |
| Archivo | .526 | 29.1 px | 18.0 |

The rule for the prototype:

- **Serif only for Titles and the hero**, at **48 px or larger** on the 1080p
  canvas, in strings short enough to sit on one or two lines (roughly 40
  characters or fewer). Use weight 500–600, not 400, so the hairlines survive
  the panel and the anti-aliasing.
- **Switch to the grotesk when any of these is true:** the size would fall
  below 40 px; the string is longer than about 40 characters; the text is a
  control, label, metadata, caption, timecode, or body; the text sits over
  artwork without a solid plate; or the text needs tabular figures.
- **At the 2-foot desk**, the serif can go down to 32 px for a title, but it
  still should not carry body text or controls. The serif is a voice for names,
  not a reading face.
- **Do not use the serif for section headers by default.** A 32 px Playfair
  section header has a 11.8 arcmin x-height, barely above the 28 px body's
  10.9; it will read as a slightly odd body line, not as a header. If a serif
  section header is wanted, make it 38–44 px, or use the grotesk.

WCAG adds a measured caution: "particularly thin or unusual fonts may be
rendered by user agents with a much fainter color than the actual text color
defined in the underlying CSS", and the recommendation is to choose stronger
strokes or exceed the contrast requirement [2]. A Didone at 400 weight is
exactly that thin/unusual case. At 10 feet, the angular width of a hairline is
smaller than at the desk, so the caution bites earlier. This is why Bodoni at
48 px should be 500–600, and why Playfair is the safer first prototype serif.

### 2.5 Line height, tracking, and measure

**Line height.** The font's own `hhea` metrics differ enough that
`line-height: normal` is not a design decision, it is an accident:

| Face | `(ascender − descender) / upm` | What `normal` does |
|---|---:|---|
| Archivo | 1.088 | Tight; titles need a deliberate 1.1–1.2 |
| Inter | 1.210 | Close to a UI default |
| Fraunces | 1.233 | Close to a UI default |
| Plex Sans / Plex Mono | 1.300 | Loose for titles |
| Playfair | 1.333 | Loose; a 76 px title gets a tall line box |
| Bodoni | 1.525 | Very loose; explicit line-height is mandatory |

Recommendations: display **1.05–1.15** (Bodoni and Playfair work at 1.10; do not
go below 1.05 or descenders/accents collide), body **1.35–1.45**, captions
**1.25–1.35**, timecode **1.0–1.1**. These defaults are deliberately below
WCAG's 1.5: WCAG 1.4.12 does not require the author to *use* 1.5, it requires
the content to survive a user override to 1.5 line-height, 0.12 em letter
spacing, 0.16 em word spacing, and 2 em paragraph spacing without loss [5]. A
1.35 body default at ten feet is more comfortable for scanning than 1.5, but
every container must grow when the user overrides it. Apple's tvOS body is
29/36 = **1.24**, which supports the lower default; the platform uses a short
line box because the strings are short. WCAG 1.4.4 separately requires text to
resize to 200% without loss of content or functionality [6]; the prototype
should check the same containers at 200% zoom, not only at the default size.

**Tracking.** Apple's tvOS tracking table is the best primary anchor for a
proportional face [12]:

- 29 pt: **+14/1000 em** (+0.014 em)
- 48 pt: **+8/1000 em** (+0.008 em)
- 76 pt: **+1/1000 em** (+0.001 em)
- New York (serif) at 29 pt: **−12/1000 em** (−0.012 em); at 76 pt:
  **−16/1000 em** (−0.016 em).

So a display serif at 72–96 px should be tracked around **−0.010 to −0.016 em**,
not the current `-0.025em` in `src/tokens.css`; the current token is about
1.5–2× tighter than Apple's own serif at the same sizes. Body grotesk at 28–32 px
should be around **+0.005 to +0.012 em**, not zero. All-caps programme labels need positive
tracking, **+0.04 to +0.06 em**, but that is a prototype hypothesis: no platform
table gives a caps-specific number, so test it at ten feet.

**Measure.** WCAG 1.4.8 (AAA) caps a line at 80 characters and forbids
justification [7]. At ten feet, shorter is better: aim for **45–65 characters**
in a description, which at 28 px Inter is roughly a 34–38 em column; captions
can be shorter. Do not justify; the uneven word spacing is worse at distance.

### 2.6 The 4K-at-100% trap

A rem-capped scale such as the current
`--text-hero: clamp(2rem, 2.8vw, 3rem)` has a maximum of 48 px. On a 3840×2160
window at 100% Windows scaling, 48 px is physically half the height it is on a
1080p window, so it subtends half the angle. The measured consequence at ten
feet:

| Size | 55″ 1080p @10 ft | 65″ 4K @10 ft, 100% scaling | 65″ 4K @10 ft, 200% scaling |
|---:|---:|---:|---:|
| 24 px | 17.2 arcmin | 10.1 arcmin | 20.3 arcmin |
| 28 px | 20.0 arcmin | 11.8 arcmin | 23.7 arcmin |
| 32 px | 22.9 arcmin | 13.5 arcmin | 27.0 arcmin |
| 48 px | 34.3 arcmin | 20.3 arcmin | 40.6 arcmin |
| 64 px | 45.8 arcmin | 27.0 arcmin | 54.0 arcmin |
| 96 px | 68.7 arcmin | 40.6 arcmin | 81.2 arcmin |

At 4K/100%, a 28 px body is 11.8 arcmin em and an Inter x-height of 6.4 arcmin —
below the 1080p caption floor. There are two defensible policies:

1. **Assume Windows scaling** (200% on a 4K TV) and keep CSS px; this is what a
   properly configured HTPC does, and it preserves the 1920×1080 logical
   canvas.
2. **Use viewport-relative type with a floor and a ceiling in `vw`/`vh`**, not
   in `rem`, so the type grows with the window; this survives a 4K/100% desktop
   where the user never touched scaling. The cost is that a very wide window
   produces very large type; cap with a `vw` ceiling, not a `rem` ceiling.

The prototype should test both at 1920×1080 and 3840×2160 (100% and 200%) and
pick one policy. Do not mix a `vw` middle with a `rem` maximum: that is the
current bug.

---

## 3. Contrast

### 3.1 Method and thresholds

WCAG 2.2 defines relative luminance for sRGB as

`L = 0.2126 R + 0.7152 G + 0.0722 B`

with each channel linearised by `C/12.92` if `C ≤ 0.04045`, otherwise
`((C+0.055)/1.055)^2.4`, and the contrast ratio as
`(L_lighter + 0.05) / (L_darker + 0.05)` [1]. Ratios are not rounded: 4.499:1
does not meet 4.5:1 [2]. The thresholds:

- **4.5:1** for body text and images of text (1.4.3 AA) [2].
- **3:1** for large text (18 pt / 24 px, or 14 pt / 18.66 px bold) [1][2].
- **3:1** for non-text UI components and graphical objects, against adjacent
  colours (1.4.11 AA) [3].
- **3:1 change** for a focus indicator, with at least a 2 CSS px thick
  perimeter's area (2.4.13 AAA) [4]; 1.4.11 independently requires the focus
  indicator to contrast with its adjacent colours [3].

WCAG evaluates the specified colours, not the anti-aliased pixels; the
Understanding note warns that thin fonts can render fainter than their CSS
colour and suggests stronger strokes or exceeding the minimum [2]. That is why
the palette below has margin, and why the display serif is kept at 500–600.

### 3.2 Palette and measured pairs

The palette is ink-black with a warm ivory, one brass house colour, and the
existing red kept for status only. Hex values are the proposed tokens; the
ratios are computed, not sampled.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#0B0A09` | The canvas; a warm near-black, not pure #000 |
| `--ink-raised` | `#141210` | Panels, sheets, the programme card |
| `--ink-elevated` | `#1B1815` | The lightest surface allowed under body text and hairlines |
| `--ivory` | `#F2E9D8` | Primary text, focus keyline, active icon |
| `--ivory-dim` | `#C8BDA9` | Secondary text, captions |
| `--ivory-muted` | `#8C8375` | The body-text floor; metadata that must still pass 4.5:1 |
| `--hairline` | `#6E6659` | 1 px rules, dividers, icon strokes only |
| `--house` | `#C9A45C` | Brass: links, the house mark, the programme accent |
| `--house-deep` | `#B08A45` | Brass fill when a darker button is wanted |
| `--status-red` | `#FF4D4D` | Status/danger only; the existing accent is not the house colour |

Measured pairs:

| Pair | Ratio | Body 4.5 | Large 3.0 | Non-text 3.0 |
|---|---:|:---:|:---:|:---:|
| `--ivory` on `--ink` | **16.41:1** | pass | pass | pass |
| `--ivory` on `--ink-raised` | **15.50:1** | pass | pass | pass |
| `--ivory-dim` on `--ink` | **10.65:1** | pass | pass | pass |
| `--ivory-dim` on `--ink-raised` | **10.06:1** | pass | pass | pass |
| `--ivory-muted` on `--ink` | **5.29:1** | pass | pass | pass |
| `--ivory-muted` on `--ink-raised` | **5.00:1** | pass | pass | pass |
| `--house` brass on `--ink` | **8.43:1** | pass | pass | pass |
| `--house` brass on `--ink-raised` | **7.96:1** | pass | pass | pass |
| `--house-deep` on `--ink` | **6.19:1** | pass | pass | pass |
| `--hairline` on `--ink` | **3.49:1** | fail (rule only) | pass | pass |
| `--hairline` on `--ink-raised` | **3.30:1** | fail (rule only) | pass | pass |
| `--ink` on `--house` (filled brass button) | **8.43:1** | pass | pass | pass |
| `--ink` on `--house-deep` | **6.19:1** | pass | pass | pass |
| `--ivory` on `--house` | **1.95:1** | **fail** | **fail** | **fail** |
| `--ivory` on `--house-deep` | **2.65:1** | **fail** | **fail** | **fail** |
| `--status-red` on `--ink` | **6.05:1** | pass | pass | pass |
| `--house` vs `--status-red` | **1.39:1** | — | — | — |

Sources: formula and thresholds [1][2][3][4]; hex values are the proposed
tokens. Every ratio was computed with the WCAG 2.2 formula above and the
0.04045 sRGB linearisation; the table is the output, not a sample.

### 3.3 The rules that follow

1. **Body text:** use `--ivory`, `--ivory-dim`, or `--ivory-muted`; all pass
   4.5:1 on `--ink` and `--ink-raised`. `--ivory-muted` is the floor: do not
   introduce a darker grey for enabled body text.
2. **Large text:** the same set passes 3:1; `--hairline` also passes 3:1 but it
   is a rule colour, not a text colour. Do not set a paragraph in `--hairline`
   just because it is 24 px.
3. **Non-text UI:** `--hairline` is the minimum border/icon stroke at 3.49:1 on
   ink and 3.30:1 on raised. For icons that carry meaning, prefer `--ivory` or
   `--house`.
4. **Filled brass:** use `--ink` text. `--ivory` on brass is **1.95:1** and is
   the single trap in this palette; a brass button with ivory label will look
   elegant and fail. `--house-deep` with ink is 6.19:1 if a darker fill is
   wanted.
5. **Surface ceiling:** `--ink-elevated` `#1B1815` is the lightest surface that
   still lets `--ivory-muted` (4.73:1) and `--hairline` (3.12:1) pass, and both
   are marginal. At `#211D19`, muted drops to 4.48:1 and the hairline to
   2.96:1; both fail. If a third elevation is needed, keep it at or below
   `#1B1815`, or switch to ivory text and a brighter rule and re-measure.
6. **Disabled text is exempt** from 1.4.3, but do not use the exemption as a
   design tool. `#5E574D` is 2.78:1 on ink; it reads as disabled, not as body.
7. **Text over artwork:** do not. WCAG F83 fails background images that do not
   provide sufficient contrast [2]. Posters and backdrops are arbitrary; a scrim
   has to be measured at its worst pixel. Put captions and functional text on
   ink plates; let the artwork bleed around them. A `text-shadow` is not a
   substitute for a measured background.
8. **Focus:** use a 2 CSS px `--ivory` keyline on the ink gutter, plus the
   spotlight wash as decoration. The keyline is 16.41:1 on ink and meets the
   2.4.13 area/change rule; the wash alone does not. If the focused card is over
   artwork, give it an ink matte or an ink under-keyline so the ivory always has
   a dark neighbour; WCAG C40's two-colour indicator is the sufficient technique
   [3][4]. This keeps the map's "spotlight wash, not a double ring": one
   keyline, one wash, not two concentric rings.

### 3.4 The house colour

Brass `#C9A45C` is HSL **39.6°, 50.2%, 57.5%**; on ink it is **8.43:1**, on
raised **7.96:1**, and ink on brass is **8.43:1**. It reads gold, not red: its
hue is 39.6°, above the orange-red band, and its saturation is 50%, not the
80–100% that turns amber into a second alarm colour. It also
passes 4.5:1, so it can be used for link text, not just decoration.

Why not a warmer amber: the existing accent is `#FF4D4D` in `src/tokens.css`,
and brass-vs-red is **1.39:1** — nearly the same luminance. A protanope may see the red darken, but
the two colours are not reliably distinguishable by luminance, so never use
them as adjacent thin lines or as the only difference between "house" and
"status". WCAG's 1.4.3 Understanding note explicitly advises avoiding red on
black for protanopia [2]. Keep red for status/danger/live, always with a label
or icon; keep brass for the house voice.

Amazon's TV guidance warns that warm colours (red, orange) are harder on TV than
cool colours (blue, purple, grey) [16]. Brass at 50% saturation is the compromise:
warm enough to be a cinema house, desaturated enough not to bloom. Test it on
the actual panel. If it reads orange there, the measured alternatives are:

| Alternative | Hex | Ratio on ink | Character |
|---|---|---:|---|
| Old gold (less saturated) | `#B99B5E` | 7.46:1 | The same hue family, quieter; the safest brass fallback |
| Baize green | `#8FA37E` | 7.26:1 | A repertory/library green; unmistakably not red; cooler on TV |
| Deep teal | `#5B9A98` | 6.14:1 | A cooler house colour; more modern, less cinema |
| Slate blue | `#7C93B0` | 6.27:1 | The most "cool TV" option; least repertory |

All four pass 4.5:1 on ink. The prototype should put brass and baize side by
side on the panel and choose with the owner; this is a perceptual call the
research cannot make.

---

## 4. Tabular numerals and the timecode face

`font-variant-numeric: tabular-nums` enables the OpenType `tnum` feature [9,
§6.7]. Presence of `tnum` is not enough; the substitution has to produce
equal-width digits. The actual GSUB substitution was applied and the target
advance widths measured:

| Family | Default digits | `tnum` | Target widths (units/em) | Verdict |
|---|---|---:|---|---|
| Playfair Display | proportional | **no** | — | Cannot be used for timecode or columns |
| Bodoni Moda | proportional | yes | `zero.tf`…`nine.tf`, all 1160 | True tabular |
| Fraunces | proportional | **no** | — | Cannot be used for timecode |
| Inter | proportional | yes | `zero.tf`…`nine.tf`, all 1328 | True tabular |
| IBM Plex Sans | tabular by default | no feature needed | all 600 | True tabular |
| Archivo | near-tabular (575–577) | yes | `zero.tf`…`nine.tf`, all 579 | True tabular |
| Cormorant Garamond | proportional | yes | `.tosf`, all 491 | Tabular, but **old-style**; not for timecode |
| Newsreader | tabular by default | yes | all 1100 | True tabular |
| IBM Plex Mono | tabular by construction | — | all 600 | True tabular |
| JetBrains Mono | tabular by construction | — | all 600 | True tabular |

The important negative results: **Playfair Display and Fraunces have no `tnum`**
and their default digits are proportional. They are display faces; do not put a
duration, episode number, year, or rating in them unless the number is part of
the title artwork. **Cormorant's `tnum` is old-style tabular** (`.tosf`), so the
digits have varying heights; it is charming in a programme, wrong for a
timecode. **Bodoni has tabular figures**, but its hairlines make it a poor
timecode face at 24 px; tabular is not the same as legible.

The timecode face should be mono, and the measured choice is:

- **IBM Plex Mono** if the programme voice is classical and paired with Plex
  Sans. 14.4 KB for the Latin 400 woff2; dotted zero; 600-unit digits; the `1`
  has a base serif, so `1` and `I` are distinct.
- **JetBrains Mono** if the timecode must read at the back of the room. 39.5 KB
  variable; x-height .550 (the tallest mono), dotted zero; the `l` has a tail.
  It is the more legible face at 24–28 px, at the cost of a slightly "code"
  flavour.

Use `font-variant-numeric: tabular-nums` on every numeric UI element — elapsed
time, remaining time, durations, episode numbers, years — even when the face is
already tabular. It costs nothing and protects against a fallback face whose
default digits are proportional. For the mono, also set
`font-feature-settings: "tnum" 1` only if `font-variant-numeric` is not enough
on the target engine; do not set both to conflicting values.

---

## 5. WebView2 and offline packaging

### 5.1 The engine and the runtime

WebView2 uses Microsoft Edge as its rendering engine [17]. The Evergreen
Runtime "generally provides the same web platform capabilities and update
release cadence as the Stable channel of Microsoft Edge" [18]. On the Windows
machine used for this research the runtime is **156.0.4314.50**, read from the
registry; that is a modern Chromium, so variable fonts, `font-display`, WOFF2,
and `font-variant-numeric` are all in scope [9][11][29][30]. The runtime can lag
if an administrator suppresses updates or the machine is offline; Microsoft's
own guidance is to feature-detect recent APIs [19]. For the CSS features used here
that is a low risk, but the prototype should still record the runtime version in
its diagnostics.

WebView2 is supported on Windows 10 1709+ and Windows 11 [17]; Tauri's
prerequisite page says it is already present on Windows 10 from 1803 onward and
later [20]. The Evergreen Runtime is included with Windows 11, and most Windows
10 devices already have it; a fresh/offline machine may not [18].

### 5.2 Bundling and CSP

Tauri reads `frontendDist` recursively and **embeds all files in the application
binary** [22]. Vite emits every `url()` referenced by the CSS it processes as a
hashed asset, and `assetsInlineLimit` defaults to **4096 bytes**: assets below
that are base64 data URLs, larger ones are files [21]. The shortlisted woff2
files are 14–88 KB, so they stay files; the `data:` case does not arise unless a
font is deliberately inlined.

WOFF2 is the W3C Recommendation for the compressed webfont format [11], and it
is the format Fontsource ships. The CSP must allow the font origin. Tauri
appends its own nonces/hashes to bundled code and assets, but the font directive
is the app's: `font-src 'self'` for same-origin bundled fonts; add `data:` only
if a font is inlined. Do not allow `https://fonts.gstatic.com` or any CDN: the
app is offline, and a remote font is a network dependency and a CSP hole [22].

For the Rust-served Remote, the page is served by the Host, so `font-src 'self'`
works if the font files are served from the same origin. The Host must send
`font/woff2` as the MIME type; a mis-typed `.woff2` can be rejected by the
browser. The Remote's browser is not WebView2; test iOS Safari and Android
Chrome separately.

### 5.3 Fontsource import granularity (the real bundle cost)

Fontsource's package CSS is convenient but not granular:

- Variable packages' `wght.css`/`standard.css` contain one `@font-face` per
  **subset** (latin, latin-ext, cyrillic, vietnamese, …), all pointing at
  separate woff2 files. Vite emits every referenced file, even though the
  browser only downloads the subset whose `unicode-range` matches the text.
  Measured all-subset totals: Playfair 87.7 KB, Bodoni 133.3 KB, Fraunces
  143.0 KB, Inter **332.3 KB**, Plex Sans 235.5 KB, Archivo 205.9 KB, JetBrains
  Mono 84.2 KB. These are woff2 only for the variable packages.
- Static packages are worse: `@fontsource/ibm-plex-mono/latin-400.css` references
  **both** `…latin-400-normal.woff2` (14.4 KB) and `…latin-400-normal.woff`
  (12.8 KB), so Vite emits both. `400.css` (all subsets) emits 90.6 KB of
  woff2+woff. Chromium only needs the woff2.
- Therefore: importing the package CSS is fine for a quick prototype, but a
  production repertory bundle should use a small local `fonts.css` with one
  `@font-face` per chosen face, pointing only at the Latin woff2 (or Latin +
  Latin-ext if title languages need it). This also lets the app set
  `font-display` and the fallback metrics deliberately. The measured Latin
  files are in the shortlist table.
- For a font payload of 0.1–0.3 MB this is not a performance emergency; for the
  served Remote over a phone's LAN link it is worth trimming. The app already
  carries mpv, and the Windows installer may carry the WebView2 bootstrapper, so
  300 KB is noise there. The reason to trim is determinism, not size.

### 5.4 `font-display`, variable fonts, and the first frame

Fontsource's generated CSS sets `font-display: swap` on every face (observed in
the package CSS; e.g. `@fontsource-variable/bodoni-moda/standard.css`). The CSS
Fonts 4 definitions [9, §4.9]:

- `swap`: an extremely small block period (100 ms or less recommended) and an
  infinite swap period; the fallback is drawn immediately and the webfont swaps
  in when ready. This is the right default for body/UI text.
- `block`: a short block period (3 s recommended) and an infinite swap period;
  the text is invisible until the font loads. The spec says this is only for
  small pieces of text where a particular font is required for the page to be
  usable — not for body text.
- `fallback`/`optional` are the more conservative options; `optional` may never
  swap after the first paint.

Because the fonts are local, any of these resolve in a frame or two; the risk is
FOUT (a flash of Georgia/Segoe) rather than a network failure. The prototype
should:

1. Preload the display and UI woff2 with
   `<link rel="preload" as="font" type="font/woff2" crossorigin>`; CSS Fonts 4
   fetches fonts in CORS mode, so the preload must be CORS-enabled too
   [9, §4.8.2].
2. Keep `font-display: swap` for the UI and body. For the display face, test
   `swap` first; if the first-frame flash is unacceptable, a `block` on the
   *title face only* is spec-allowed for small pieces of text, but it is a
   worse accessibility default than a metric-matched fallback.
3. If a fallback flash is visible, use `size-adjust` and the metric overrides
   from CSS Fonts 5 [10, §4.4–4.5]. The measured `size-adjust` values are in
   §5.5; they make the fallback occupy the same x-height (body) or cap-height
   (display) as the bundled face.

Variable fonts are supported in Chromium-based engines; the axes are OpenType
Variations axes [29], and web.dev documents the CSS mapping [30]. Use the
`font-weight` ranges that Fontsource ships (`100 900`, etc.), not a single
weight. `font-optical-sizing: auto` is the default; it maps `opsz` to the
computed font size, so Bodoni/Fraunces/Inter will choose their optical cut
automatically [30]. For
Fraunces' `SOFT`/`WONK`, remember that `font-variation-settings` resets every
axis not named in the declaration; set all axes together or use CSS variables
[30]. Prefer the registered properties (`font-weight`, `font-optical-sizing`)
for `wght`/`opsz` and reserve `font-variation-settings` for the custom axes.

Fontsource uses the legacy `format('woff2-variations')` string. Chromium still
accepts it, but if the prototype writes its own `@font-face`, use the current
form `format('woff2') tech('variations')` with a plain `woff2` fallback; the
CSS Fonts 4 `src` parser explicitly supports both [9][30]. This is a
future-proofing detail, not a present failure.

### 5.5 Optional fallback metrics

The actual Windows fallback metrics (read from `/mnt/c/Windows/Fonts`) are:

| Fallback | x-height | cap-height | hhea asc/desc |
|---|---:|---:|---:|
| Segoe UI / Segoe UI Variable | .500 | .700 | 1.079 / −.251 |
| Georgia | .481 | .693 | .917 / −.219 |
| Times New Roman | .447 | .662 | .891 / −.216 |
| Consolas | .490 | .638 | .743 / −.257 |
| Cascadia Mono | .518 | .693 | .928 / −.234 |

If a FOUT is visible, the fallback `@font-face` can be adjusted:

| Primary → fallback | Match by x-height | Match by cap-height |
|---|---:|---:|
| Inter → Segoe UI | **109.2%** | 103.9% |
| Plex Sans → Segoe UI | **103.2%** | 99.7% |
| Archivo → Segoe UI | **105.2%** | 98.0% |
| Playfair → Georgia | 106.9% | **102.2%** |
| Bodoni → Georgia | 95.6% | **108.2%** |
| Fraunces → Georgia | **100.2%** | 101.0% |
| Plex Mono → Cascadia Mono | **99.6%** | 100.7% |
| JetBrains Mono → Cascadia Mono | **106.2%** | 105.3% |

Use x-height matching for body/UI and mono; cap-height matching for display
serif. This is optional: the app is offline and the fonts are local, so the
flash may be imperceptible. Do not add metric overrides unless the first-frame
test shows a visible reflow; every override is another thing to verify.

### 5.6 Runtime distribution

Tauri's Windows installer has these WebView2 modes [26]:

| Mode | Internet needed | Added installer size | Use here |
|---|---|---:|---|
| `downloadBootstrapper` (default) | yes | 0 MB | Fine for a normal online machine; not for a sealed cinema PC |
| `embedBootstrapper` | yes | ~1.8 MB | A little more robust on old Windows 10 |
| `offlineInstaller` | no | **~127 MB** | The right choice if the app must install offline |
| `fixedVersion` | no | **~180 MB** | Avoid unless reproducibility is mandatory; it pins Chromium and its security updates |
| `skip` | no | 0 MB | Only if the runtime is guaranteed |

Microsoft says the Fixed Version binaries are over 250 MB [18]; Tauri's ~180 MB
is the compressed installer delta. Pinning Chromium just to get variable-font
support would be the wrong trade: the Evergreen Runtime on this machine is 156
and variable fonts are old news. For a personal offline cinema PC, either
ensure the Evergreen runtime is present or use `offlineInstaller`; do not use
`fixedVersion` without a separate reason.

### 5.7 OFL in the bundle

The font files are OFL-1.1. Keep the package `LICENSE` text (or a consolidated
`fonts/OFL.txt`) in the installer resources and show the copyright/licence in
the app's About or credits. Do not rename the font, and do not re-subset it in
this repo without accepting the modification/RFN consequences [27][28]. The
`bundle.licenseFile` in `tauri.conf.json` is for the application's licence; it
is not a substitute for the font notices.

---

## 6. Shortlist for the first prototype

### 6.1 The eight

| Role | First choice | One-line reason |
|---|---|---|
| Serif | **Bodoni Moda** | The strongest high-contrast Didone; opsz 6–96 makes one 45 KB file serve 48–96 px titles. |
| Serif | **Playfair Display** | The safest high-contrast serif: larger x-height than Bodoni, 38 KB, no optical-size complexity. |
| Serif | **Fraunces** | The warm, letterpress option when Bodoni reads too brittle and Playfair too bridal. |
| Grotesk | **Inter** | The largest x-height and quietest voice; true tabular figures; the best pure legibility at ten feet. |
| Grotesk | **IBM Plex Sans** | Humanist warmth and default tabular digits; pairs with Plex Mono for a single programme system. |
| Grotesk | **Archivo** | A true grotesk with a width axis and strong caps; the best for dense metadata and tracked labels. |
| Mono | **IBM Plex Mono** | Dotted zero, 600-unit digits, 14 KB Latin 400; the most "film programme" mono. |
| Mono | **JetBrains Mono** | Tallest shortlisted mono x-height; variable 100–800; the most legible timecode at 24–28 px. |

### 6.2 Two pairings to test first

1. **Bodoni Moda + Inter + IBM Plex Mono.** The drama option: a Didone hero,
   the quietest UI face, and a programme mono. This is the closest to the
   "repertory cinema" brief. Risk: Bodoni hairlines at 48–64 px and the brass
   house colour both need the panel test.
2. **Playfair Display + IBM Plex Sans + IBM Plex Mono.** The warm option: one
   family system (Plex), a sturdy high-contrast serif, and default tabular
   digits in both the UI and the mono. This is the lowest-risk first slice.
3. **Fraunces + Archivo + JetBrains Mono** is the third option, not the first
   test: it is softer and more contemporary, and its no-`tnum` serif is fine
   because the grotesk and mono carry the numbers.

### 6.3 A token skeleton to start from

These are prototype values, not a lock. They are the TV scale on a 1920×1080
logical canvas; the desk column in §2.3 is a verification reference, not a
separate token set. The 4K policy is the one chosen after the test in §2.6.

```css
:root {
  color-scheme: dark;

  --ink: #0b0a09;
  --ink-raised: #141210;
  --ink-elevated: #1b1815;

  --ivory: #f2e9d8;
  --ivory-dim: #c8bda9;
  --ivory-muted: #8c8375;
  --hairline: #6e6659;

  --house: #c9a45c;
  --house-deep: #b08a45;
  --status-red: #ff4d4d;

  --font-display: "Bodoni Moda Variable", "Bodoni Moda", Didot, "Bodoni MT", Georgia, serif;
  --font-sans: "Inter Variable", Inter, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", "Cascadia Mono", Consolas, ui-monospace, monospace;

  /* ten-foot scale, 1080p logical; replace the rem caps in §2.6 */
  --text-hero: clamp(4.5rem, 5vw, 6rem);      /* 72–96 px */
  --text-title: clamp(3rem, 3.4vw, 4rem);     /* 48–64 px */
  --text-section: clamp(2rem, 2.1vw, 2.375rem); /* 32–38 px */
  --text-body: clamp(1.75rem, 1.7vw, 2rem);   /* 28–32 px */
  --text-caption: 1.5rem;                     /* 24 px floor */
  --text-control: 1.625rem;                   /* 26 px */
  --text-mono: 1.75rem;                       /* 28 px timecode */

  --leading-display: 1.1;
  --leading-body: 1.4;
  --leading-caption: 1.3;
  --tracking-display: -0.012em;
  --tracking-body: 0.008em;
  --tracking-caps: 0.05em;

  --focus-ring: 0 0 0 2px var(--ivory);
  --focus-wash: rgba(201, 164, 92, 0.12);
}
```

The `clamp()` ceilings above are the 1080p values; they are placeholders until
§2.6 picks the 4K policy. Do not ship the `rem` ceilings unchanged. Whichever
4K policy wins replaces them with `vw`-based limits or an explicit scaling
assumption. Do not copy the current `--text-micro: 0.72rem` (11.5 px) into the
repertory scale: nothing at ten feet should be that small.

### 6.4 Guards to add to the prototype

- A tiny Vitest unit over the palette tokens that computes the WCAG ratios and
  fails if `ivory`/`dim`/`muted` on `ink`/`raised` fall below 4.5, or
  `hairline` below 3.0. This is a pure decision seam; it belongs in the test
  suite, not in a review checklist.
- A CSS test that every `font-family` stack ends in the right generic and that
  `--font-mono` is never the display or sans face.
- A size test that `--text-caption` is at least 24 px at the 1080p canvas.
- A Windows walkthrough (not `verify.ps1`) with screenshots at the real viewing
  distance: one 1080p pass, one 4K/100% pass, one 4K/200% pass. The existing
  `verify.ps1` is a functional checklist and is not redesigned for this map;
  the owner verifies the window by hand.

---

## 7. What this research could not decide

These are the questions the prototype or the owner must answer; the evidence
above narrows them but does not close them.

1. **Which serif survives the panel.** Bodoni's hairlines, Playfair's sturdier
   strokes, and Fraunces' softness look different on a VA/OLED TV at ten feet
   than in a font inspector. The prototype needs screenshots at the real
   distance; a Linux screenshot is not evidence.
2. **Whether brass reads gold or orange.** `#C9A45C` is 39.6° hue and 50%
   saturation, which should read gold, but the panel's white point and the
   room's lighting can push it orange. The measured fallbacks are old gold
   `#B99B5E`, baize `#8FA37E`, and teal `#5B9A98`; the owner should choose on
   the panel.
3. **The final pairing.** Inter vs Plex Sans vs Archivo is a voice choice, not
   a legibility choice; all three pass. Bodoni vs Playfair vs Fraunces is the
   same. Test two, not three, in the first slice.
4. **The 4K policy.** Viewport-relative type with a `vw` ceiling, or a
   Windows-scaling assumption with a 1920×1080 canvas? Both are defensible;
   the prototype must test 4K/100% because that is where the rem cap fails.
5. **The hero composition.** A serif title over a backdrop needs a solid plate
   or a measured scrim; a title on ink is safe but less cinematic. This is a
   layout decision for the prototype and the Home feature ticket, not a type
   decision.
6. **The Remote's font delivery.** The served page can carry the same woff2
   files from the Host, or fall back to system fonts. It runs in a phone
   browser, not WebView2; test iOS Safari and Android Chrome. The window is the
   priority; the Remote can degrade without breaking the cinema.
7. **CJK and other-script titles.** The Fontsource Latin subsets do not cover
   Japanese, Chinese, Korean, Cyrillic, or Greek. WebView2 will fall back to
   Yu Gothic / Microsoft YaHei / Malgun Gothic; the fallback is legible but not
   the repertory voice. Decide whether titles in those scripts use the system
   fallback or a bundled Noto family (a much larger package).
8. **All subsets vs Latin-only.** The package CSS is quick but emits every
   subset; a local `fonts.css` is lean but couples to the package file names.
   The all-subset bundle is 84–332 KB for the variable faces and 27–91 KB for
   Plex Mono (because of the woff fallback); the Latin-only woff2 is 14–88 KB.
   Choose based on whether the installer or the Remote is the constraint.
9. **Whether FOUT needs metric overrides.** The `size-adjust` table is ready,
   but the flash may be imperceptible with local files. Test the first frame
   before adding overrides.
10. **Whether the serif also carries section headers.** The x-height math says
    a 32 px serif header is barely larger than a 28 px body; if the design wants
    serif headers, they need 38–44 px. That is a composition decision, not a
    font decision.

---

## References

All URLs were read on 2026-10-29.

1. W3C, *Web Content Accessibility Guidelines (WCAG) 2.2*, W3C Recommendation,
   12 December 2024. <https://www.w3.org/TR/WCAG22/> — relative luminance,
   contrast ratio, large-scale text, CSS pixel definitions.
2. W3C WAI, *Understanding SC 1.4.3: Contrast (Minimum)*.
   <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>
3. W3C WAI, *Understanding SC 1.4.11: Non-text Contrast*.
   <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>
4. W3C WAI, *Understanding SC 2.4.13: Focus Appearance*.
   <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>
5. W3C WAI, *Understanding SC 1.4.12: Text Spacing*.
   <https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html>
6. W3C WAI, *Understanding SC 1.4.4: Resize Text*.
   <https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html>
7. W3C WAI, *Understanding SC 1.4.8: Visual Presentation*.
   <https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html>
8. W3C, *Cascading Style Sheets, level 2 (CSS 2.1)*, §4.3.2 Length units.
   <https://www.w3.org/TR/CSS21/syndata.html#length-units>
9. W3C, *CSS Fonts Module Level 4*, Working Draft, 22 October 2026.
   <https://www.w3.org/TR/css-fonts-4/> — `@font-face`, `font-display`,
   `font-variant-numeric`, `font-optical-sizing`, CORS font fetch.
10. W3C, *CSS Fonts Module Level 5*, Working Draft, 13 September 2026.
    <https://www.w3.org/TR/css-fonts-5/> — `size-adjust`, metric overrides.
11. W3C, *WOFF File Format 2.0*, Recommendation.
    <https://www.w3.org/TR/WOFF2/>
12. Apple, *Human Interface Guidelines: Typography*, tvOS built-in text styles
    and tracking table.
    <https://developer.apple.com/design/human-interface-guidelines/typography>
    (data endpoint:
    <https://developer.apple.com/tutorials/data/design/human-interface-guidelines/typography.json>).
13. Microsoft Learn, *Screen sizes and breakpoints for responsive design*,
    "Why are TVs considered small?" and "Effective pixels and scale factor".
    <https://learn.microsoft.com/en-us/windows/apps/design/layout/screen-sizes-and-breakpoints-for-responsive-design>
14. Microsoft Learn, *Designing for Xbox and TV* (UWP).
    <https://learn.microsoft.com/en-us/previous-versions/windows/uwp/xbox-apps/designing-for-tv>
15. Microsoft Learn, *Xbox Accessibility Guideline 101*.
    <https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/101>
16. Amazon Developer, *Design and User Experience Guidelines (Fire TV)*.
    <https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html>
17. Microsoft Learn, *Introduction to Microsoft Edge WebView2*.
    <https://learn.microsoft.com/en-us/microsoft-edge/webview2/>
18. Microsoft Learn, *Distribute your app and the WebView2 Runtime*.
    <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>
19. Microsoft Learn, *Prerelease and Release SDKs for WebView2*.
    <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/versioning>
20. Tauri, *Prerequisites* (Windows / WebView2).
    <https://v2.tauri.app/start/prerequisites/>
21. Vite, *Static Asset Handling* and *Build Options* (`assetsInlineLimit`).
    <https://vite.dev/guide/assets.html>,
    <https://vite.dev/config/build-options#build-assetsinlinelimit>
22. Tauri, *Content Security Policy (CSP)* and *Configuration* (`frontendDist`).
    <https://v2.tauri.app/security/csp/>,
    <https://v2.tauri.app/reference/config/#frontenddist>
23. npm registry metadata and package tarballs, `@fontsource-variable/*` and
    `@fontsource/*` at 5.3.0, read 2026-10-29. Examples:
    <https://registry.npmjs.org/@fontsource-variable/bodoni-moda>,
    <https://registry.npmjs.org/@fontsource-variable/playfair-display>,
    <https://registry.npmjs.org/@fontsource-variable/fraunces>,
    <https://registry.npmjs.org/@fontsource-variable/inter>,
    <https://registry.npmjs.org/@fontsource-variable/ibm-plex-sans>,
    <https://registry.npmjs.org/@fontsource-variable/archivo>,
    <https://registry.npmjs.org/@fontsource/ibm-plex-mono>,
    <https://registry.npmjs.org/@fontsource-variable/jetbrains-mono>.
24. Google Fonts, `METADATA.pb` for each family, `google/fonts` repository.
    <https://github.com/google/fonts/tree/main/ofl> — e.g.
    `ofl/bodonimoda/METADATA.pb`, `ofl/playfairdisplay/METADATA.pb`,
    `ofl/fraunces/METADATA.pb`, `ofl/inter/METADATA.pb`,
    `ofl/ibmplexsans/METADATA.pb`, `ofl/archivo/METADATA.pb`,
    `ofl/ibmplexmono/METADATA.pb`, `ofl/jetbrainsmono/METADATA.pb`.
25. Microsoft Learn, *Font List Windows 11*.
    <https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list>
26. Tauri, *Windows Installer* (WebView2 installation modes).
    <https://v2.tauri.app/distribute/windows-installer/>
27. SIL, *SIL Open Font License 1.1*, official text.
    <https://openfontlicense.org/open-font-license-official-text/>
28. SIL, *OFL FAQ* (version 1.1-update7).
    <https://openfontlicense.org/ofl-faq/>
29. Microsoft, *OpenType Font Variations Overview*.
    <https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview>
30. web.dev, *Introduction to variable fonts on the web*.
    <https://web.dev/articles/variable-fonts>
