# Subtitle appearance is a preference, and colour does not override authored ASS styling

Ticket #126 gives the Host a subtitle *appearance* beside its subtitle language:
the colour and the size the Player draws subtitles in. libass draws them, so the
appearance is ultimately mpv's; what this records is who decides it, what the
colour may or may not override, and where the two values live.

## The facts this rests on

Probed for #126 against mpv 0.37 in the dev container (the ticket records the
probe; `docs/research/mpv-control-facts.md` records the control set this
extends), with a real ASS track and plain subtitle text:

- `sub-color` recolours subtitles that do **not** carry styling of their own.
- A red ASS line stayed red under `--sub-color=#00FF00`. Only
  `sub-ass-override=force` turned it green, and that same option also overrides
  the track's authored fonts and typesetting.
- `sub-scale` scaled the ASS line (18 px → 28 px at 1.5×) and plain text alike.
- `sub-font-size` did not affect that ASS line.

The Windows build runs mpv 0.41. The same behaviour is **pending** there in the
walkthrough, against a fixture with two SRT tracks and one ASS track: the owner batches
that run after #126, #127 and #128, and it was not run as part of this change.
It is a manual check because it is a fact about pixels, which no unit test can
see.

## 1. Appearance is two Host preferences, not a per-Stream setting

`subtitle_color` (`#RRGGBB`, normalized uppercase) and `subtitle_scale` (finite,
0.5–2.0) are stored in the `preferences` table beside the subtitle language.
Their defaults are `#FFFFFF` and `1.0`, and an absent row means the default — a
store written before #126 reads exactly as it did.

Both are always in `PreferencesSnapshot`. A client therefore never has to invent
a value, and the window and the Remote read the same answer. There are no reset
Actions: white and 1.0 *are* the defaults, and asking for one is asking for a
value like any other.

Rejected, with reasons: **per-Stream appearance** (a person picks subtitles once
and expects every Stream after it to look the same; per-Stream state is the thing
Watch progress already shows is easy to lose); **a client-local setting** (the
Remote is the window's equal, and a colour kept in one client would diverge the
moment the other one changes it — ADR-0018); **a `clear`/reset Action** (there is
no "unset" to clear to; white is a colour the Host holds).

## 2. Colour applies where the track leaves it open; size applies to both

The Host sets `sub-color` and `sub-scale`, and deliberately **does not set
`sub-ass-override`**. An ASS track keeps the colour, font and typesetting it was
authored with; the preference changes subtitles that leave those choices to the
player, which is the common case for SRT. Size is the one property of the two
that reaches both: a styled track's text is scaled too.

This is the whole reason the feature is not a single "force my subtitle style"
switch. `force` would recolour everything, and in doing so replace the authored
fonts, positioning and typesetting of every ASS track — a change to how a
subtitle *reads*, not just how large it is.

Rejected, with reasons: **`sub-ass-override=force`** (it overrides authored
fonts and typesetting as well as colour, and the ticket puts that out of scope);
**`sub-font-size` as the size control** (it did not affect the probed ASS line,
so it would be a control that silently does nothing on half the files);
**stripping or re-authoring ASS styling** (the Host does not own third-party
subtitle files, and rewriting them would be a second subtitle pipeline).

## 3. The values are domain types, and a refusal writes nothing

`SubtitleColor::parse` accepts exactly `#` and six hexadecimal digits and
normalizes them to uppercase. `SubtitleScale::parse` accepts a finite number in
`0.5..=2.0`. Both are judged in `Action::validate` before anything else runs, so
an invalid value cannot reach the Player, the store or a Snapshot: it is an
`invalid_subtitle_color` / `invalid_subtitle_scale` Action error and no partial
write happens. A scale that is not a number at all — `NaN`, an infinity — has no
wire form, but it is refused here rather than left to reach mpv.

Rejected, with reasons: **validating strings in the store** (the store reads what
it wrote, and a corrupt row is a read error — `host-sqlite` tests it); **named
colours** (`red` is mpv's spelling, and the Host's state does not speak mpv's
vocabulary — ADR-0008); **letting a client send any hex form** (`#FFF`, `RRGGBB`
and `rgba()` would each need their own rule on the way to one mpv property).

## 4. The Player is told twice: at startup and on every change

Two new `Telling`s — `SubtitleColor(SubtitleColor)` and
`SubtitleScale(SubtitleScale)` — and `host-mpv::telling` spells them `set
sub-color #RRGGBB` and `set sub-scale <f64>`. They are told once at startup,
after the subtitle language and before any Stream opens, and with every change.
A Player that refuses either is not a reason the Host cannot hold the preference:
the refusal is dropped and the preference persists, exactly as the subtitle
language already does (ADR-0013, ADR-0014).

Rejected, with reasons: **setting `sub-color`/`sub-scale` in `open`** (they are
properties a Stream can be changed to while it plays, unlike `slang`, which is
read at load time); **a second method on the Player** (the seam has one `tell`
for every control, and the appearance is a control — ADR-0014).

## 5. The window and the Remote offer the same presets and steps

Settings > Preferences has a **Subtitle appearance** section: colour chips
(White, Yellow, Cyan, Green) and size chips (80%, 100%, 125%, 150%, named Small
through Larger), each an Action. The copy says plainly that an ASS track keeps
its authored colour.

The player OSD's Subtitles menu has a **Size** group — `−` / `+` with a
percentage readout — because that is where a person adjusts subtitles while
looking at them. One press moves to the **neighbouring preset**, never between
them: 80% → 100% → 125% → 150%, clamped at the ends (the interview settled those
four). That keeps the OSD and the Settings chips naming the same four sizes.
There is deliberately **no colour control in the OSD**: the colour is not
something a person can judge without a subtitle showing, and the Settings screen
already has it. The Remote mirrors both: colour and size in Settings, size in
the Audio & Subtitles sheet.

The Host still accepts any finite scale from 0.5 to 2.0 on the wire, so a Remote
can set a value between the four presets (105%, 120%, 160%, or 50%). Settings
and the Remote's Settings then show a pressed **Other (n%)** chip beside the
four, the same way the language picker names a tag its list does not know, so no
screen is left with every choice unpressed. The OSD's next press brings the
value back onto the four-preset ladder.

Because the values are preferences, the OSD's size change reaches the Settings
chips and the next Stream at once, and both survive a restart.

Rejected, with reasons: **a five-per-cent OSD step** (it lands on 105% and 120%,
sizes no Settings chip presses, and the interview chose four presets instead);
**a colour picker in the OSD** (another surface for one preference, and the
sheet is already the busiest); **a stepper in Settings** (the chips are the
presets a person wants; the OSD is where the four-preset step belongs);
**separate window and Remote lists** (ADR-0018's capability list asserts the
surface, and the lists are one JSON — `src/subtitle-appearance.json` — imported
by the window and spliced into the served page, so they are the same values by
construction).

## 6. What is verified where

| What | Where |
|---|---|
| colour/scale parse, refusals, Snapshot fields | `host-core` unit and Action-surface tests |
| startup telling and refusal keeps the preference | `host-core/tests/controls.rs` |
| round-trip, absent row, corrupt row | `host-sqlite/tests/store.rs`, `restart.rs` |
| `set sub-color` / `set sub-scale` spellings | `host-mpv/src/telling.rs`, and `crates/host-mpv/tests/mpv.rs` asserts a real mpv accepts them |
| SRT recolours, ASS keeps its authored colour, both scale | the Windows walkthrough (`scripts/windows/verify.ps1`), **pending** the owner's batch after #126–#128 |
| the one appearance list matches the Host's bounds and reaches both clients | `src/controls.test.ts`, `host-wire`'s `remote.rs` tests |
| the Remote declares and wires both Actions | `host-wire` capability and handler tests, `tests/wire.rs` |

## Consequences

- The Action surface grew two variants, so `Action::SPELLINGS` did too, and the
  Remote's capability list had to name them (ADR-0018). The parity test fails
  until it does.
- Every Snapshot carries the appearance, so a client that has just connected
  draws the Host's values without asking.
- The presets and the accepted range live in one JSON beside the language list:
  the window imports it and `host-wire` splices it into the served page, so a
  change reaches both clients and the bounds are tested against
  `SubtitleScale::MIN`/`MAX`.
- A stored appearance that cannot be read is a store read error, like a corrupt
  language or Featured catalog — never a value silently replaced.
- A future "force my subtitle style" preference would be a third value and not a
  change to these two; this ADR deliberately keeps `sub-ass-override` unset.
