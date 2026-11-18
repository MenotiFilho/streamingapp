# The full control set: one telling, what travels, and whose crop it is

Ticket #28 ("The full control set") is the first ticket where a client does more
than start and stop a Stream. Nine decisions are worth writing down; the rest is
mechanical once they are made. ADR-0013 predicted this shape — "a control added
by #28 is a new `Action` variant, a telling in `host-mpv` and a property in the
reading" — and this is that prediction kept.

## One `tell`, and every control is a `Telling`

The Player seam gained exactly one method. `set_paused` and `seek` were folded
into it, and the whole v1 control set arrives as a value:

```rust
fn tell(&self, telling: Telling) -> Result<(), PlaybackError>;
```

A `Telling` is the Host's own word for one thing asked of a Player — `Pause`,
`Seek`, `AudioTrack`, `SubtitleTrack`, `SubtitleDelay`, `Speed`, `Volume`,
`Muted`, `Chapter`, `Crop`, `Autocrop`, `Aspect`, `SubtitleLanguage`,
`AddSubtitle` — and `host-mpv::telling` is the only place that knows what mpv
calls each one.
Opening a Stream and letting one go stay methods of their own: they are not
controls a client names.

Rejected, with reasons: **one method per control** (the trait would grow with
every control, and every future Player — a test's, a platform's — would have to
grow with it, which is the shape ADR-0013 already rejected for properties);
**one method per mpv property** (`aid`, `sid`, `sub-delay`, `speed` … the seam
would be mpv's API under another name); **a generic `command(&str, &[&str])`**
(the Host would hand out mpv's spelling, and `host-core` would start naming
things mpv names, which is the one thing the crate split exists to prevent).

## A control moves the Host's own record at the moment of the Action

ADR-0013's rule for pause and seek is now the rule for all of them: an Action
whose telling the Player took publishes a Snapshot carrying the change
immediately, and the Player's next report is what corrects it. Selecting an audio
track flips `selected` in the session's own copies of the tracks; a crop is
recorded as the rectangle asked for; a chapter step moves the index, clamped to
the list the Player last reported. `observe`'s fold compares its whole report
against that record, so a control that a platform silently ignores is corrected a
quarter-second later rather than believed.

A Player that *refuses* the telling is the one case that moves nothing: the
Action is refused with the Player's own words and the record stays as it was, so
a client is never told a control took when the limb it reached never took it.

A consequence worth stating: **a track change never reopens the Stream**. That is
asserted rather than intended — `no_control_reopens_the_stream` drives every
control and checks the fixture Player was never asked to `open` again — because
"survives a change without a re-open" is in the ticket, and a re-open would show
up as a position back at zero, which no assertion elsewhere would catch.

## The control set travels in the Snapshot, statistics included

Tracks, chapters, the current chapter, speed, volume, mute, subtitle delay, the
crop, the aspect, the picture's size and the statistics are all fields of
`PlaybackSnapshot`. They are facts about the Stream playing now, and a Snapshot
is exactly what every client is owed about it; a client that opened a menu is
not asking a question, it is reading the state it already has.

Rejected, with reasons: **an Action that answers "what are the tracks?"** (it
would be a second, client-specific way to learn the same state, and a client with
a menu open would have to poll it); **tracks and chapters as their own Answer**
(the answer path exists for what is *per-client* — a catalog row, a Title, a
Stream list — and playback is the one genuinely shared state, which is the
distinction ADR-0010 drew); **leaving statistics out because they are debug
output** (they are the only thing that answers "is the picture actually being
handled well", and the ticket puts them in the control set).

The statistics are three fields and no more: `bitrate`, `dropped_frames`,
`hardware_decode`. A readout is not an excuse for a dump of mpv's property tree,
and every field is one a client would show.

## Crop is manual, and clearing it is the empty string

A crop is a rectangle of the source, in the source's own pixels, or nothing.
Clearing it sets `video-crop ""`: on 0.37 — the version probed here — the
property reads back empty, and the reading half already treats empty as
"uncropped". It is also the stock script's own clear (`set
file-local-options/video-crop ''`), and the spelling the script tests for, so a
manual clear and the script's toggle now leave the crop in the same state. On
0.41 the same clear is expected to read back empty, but that is unverified until
the Windows walkthrough.

`0x0+0+0` — the manual's "override container crop and disable cropping" — is
still accepted by the reading half, which treats a zero width or height as
uncropped, but it is **no longer used**. On 0.37 the property reads back as the
string `0x0+0+0` rather than as empty, and the stock autocrop script treats any
non-empty `video-crop` as a crop already set: a clear spelled that way would make
the next toggle clear again instead of detecting. `set video-crop no` fails with
`MPV_ERROR_COMMAND` on mpv 0.41 (the prototype's finding, ADR-0003) and is used
by nothing. The probe facts are in `docs/research/mpv-control-facts.md` (#119).

## Autocrop is manual-only, and the script is still mpv's own

"Stock autocrop behaviour" means `TOOLS/lua/autocrop.lua`, the script mpv ships.
The Player embeds it (`include_str!`), writes it to a per-process temp directory
once per process and loads it through mpv's `scripts` option before
initialization, which is the only time that option can be set (`--script` is a
command-line alias for `--scripts-append`, not an option the client API knows).
The vendored copy stays **unmodified**: what changed with #119 is the option it
is started with, and who asks it to run.

The file is written as `autocrop.lua`, because mpv names a script after its
file: the binding is `autocrop/toggle_crop` and `script-opts` is keyed
`autocrop-*`. The Player starts it with `script-opts=autocrop-auto=no`, the
script's own supported way to opt out of its automatic pass. `file-loaded` then
finds `auto` false and returns, so a Stream opens exactly as its source is and
the first frame keeps whatever black bars it carries. A client that wants them
found takes `Action::Autocrop`, which the Player spells as `script-binding
autocrop/toggle_crop`: the script's own toggle, which detects while `video-crop`
is empty and clears while it is not. Pressing it again restores the full frame.
There is no clear-first step — the script reads the property itself, and an
explicit clear before every press would turn the second press into a third
detect.

The Host still detects nothing: the rectangle is the script's answer, and a
Snapshot carries it only once the Player reports the `video-crop` it set. A
manual crop and an autocropped one are the same `Crop` from that point on.

**This reverses the earlier rejection of "autocrop off by default."** That
rejection was made because the ticket then asked for the stock behaviour, and the
script's own default is on. The owner has since chosen the opposite: a Stream
must open uncropped, and cropping the bars is something a person asks for. The
stock behaviour kept is the script's *toggle*; the automatic pass it performs on
its own is the part switched off. Reversing it explicitly is the point — silently
overriding the old decision would leave the record in this file saying something
the Host no longer does.

Rejected, with reasons: **the Host detecting black bars itself** (it would be a
second implementation of `cropdetect` with a worse eye, and it would need the
picture's frames, which the Host never sees); **patching the script to remove
`on_start`** (a modified script stops being mpv's, and `auto=no` is exactly the
option upstream provides for this); **fetching the script at runtime** (a Player
with no network must not lose a player feature, and a script the Host plays must
be one the Host ships); **clearing the crop before detecting** (the script uses
an empty `video-crop` as its "nothing to clear, so detect" signal, so a clear
first would be dead work that fights the manual crop).

## Aspect is mpv's override, and "source" is its absence

`Aspect::Source` means the Stream's own shape; a ratio is an override applied
with `video-aspect-override`. mpv reports the override as a float and `0.0` when
there is none, so the read maps `0.0` (or a negative) to `Source` and anything
else to `Ratio`. The Host does not store the source's own ratio: it is mpv's
fact, it changes with the Stream, and a Snapshot that carried it would be
carrying two numbers that disagree whenever the override is on.

## The language preference is `slang`; the Host does not match languages

_Track choice superseded by ADR-0041; the Addon subtitles fallback's request and cap stand where 0041 does not change them._

The Host stores one global subtitle language and passes it through to mpv's
`slang`, which is exactly the feature asked for: when mpv selects a subtitle
track, it selects one that matches. Crucially, mpv's matcher already knows what
the Host would otherwise have to table out — `pt`, `pt-BR`, `por` and `por-BR`
all match a container's `por`, and `en` matches `eng` (verified; see the research
note). `slang` is set at startup, on every change of the preference, and it is
set *before* the `loadfile` that should use it, because mpv reads it at load
time.

Rejected, with reasons: **the Host picking the track itself** (it would need a
two-letter/three-letter language table and a policy for `und`, `mul` and
`zxx`, all of which mpv already has and maintains); **per-Title overrides** (the
spec says a global preference only, and a per-Title override is a thing to store,
sync and explain that nobody asked for).

A preference is Host state, so a Player that refuses the telling (a machine with
no usable libmpv) does not stop the owner expressing one: the refusal is dropped
and the preference persists.

## Embedded subtitles always win, and the Addon resource is the fallback

The rule has two halves. First, mpv's own selection prefers what the file
carries. Second, when the Player reports a live Stream carrying **no embedded
subtitle track at all**, the Host asks the configured Addons that answer the
`subtitles` resource for that Video, once per Stream, and tells the Player to
`sub-add` each one (`auto`, so mpv's selection rules still decide whether to
show it; the track's shown title is the Addon's own id for it, the only per-item
word the protocol carries besides the language). The attempt is recorded on the
session, so a Stream with no subtitles anywhere is asked about once and not four
times a second.

"Nothing embedded" is a *report*, not an absence: the Player says what the Stream
carries, and a Player that could not read the track list says nothing at all
(`tracks: None`) rather than saying "none". The fallback waits for a report it can
act on, so a read that failed leaves the attempt un-made — where treating it as an
empty Stream would have spent the one attempt on the wrong answer and loaded an
Addon's subtitles over a file that already had its own.

The fetch is made by `Host::sample`, which is the Host reading its own limb
(ADR-0013): the Host decides nothing about it on a client's behalf, and a client
cannot cause or prevent it. That the fetch is I/O inside the tick is deliberate —
playback subtitles are not a question a client asks; a Stream that needs them
needs them whether or not anyone has a menu open.

The provider seam carries it: `Provider::subtitles` is one more resource asked of
the one Addon transport, beside `Provider::streams`. The subtitle URL is a URL,
so it is kept the way a Stream's URL is kept — validated once, handed to the
Player, never published; a Snapshot carries the *track* that came of it. An
Addon's subtitle URL can carry a session token exactly the way a debrid Stream
URL can (ADR-0013's presumption), and a Snapshot reaches every paired client.

Rejected, with reasons: **fetching eagerly at `PlayStream`** (embedded tracks are
not known until the file is open, and the ticket says the resource is fetched
*only* when nothing is embedded); **a client-triggered "find subtitles" Action**
(the fallback would then depend on a client that happens to be watching, and the
policy would live in the client, which ADR-0002 exists to prevent); **a second
seam for subtitles** (there is one Addon transport; a second trait would be the
same fetch with a different name).

## Next episode re-asks for the Video and follows the same release

`Action::NextEpisode` is a Host rule, not arithmetic on an id: the Host asks the
configured Addons that answer `meta` for the Title, finds the Video it is on, and
takes the next one in the Addon's own order. The Title's id is what the episode's
own id carries before its last two parts — the protocol indexes an episode as
`{title}:{season}:{episode}`, and `{title}` is not always one part (`kitsu:12345`
indexes its episodes as `kitsu:12345:1:1`), so the shape read is "two numeric
parts at the end" rather than "exactly three parts". It then asks for that
Video's Streams and plays the first playable candidate from **the same Addon and
the same `bingeGroup`** as the one playing, falling back to the same Addon's first
playable candidate. If no Addon answers `meta`, or there is no next Video, or no
candidate, the Action is refused with the reason — playing something else, or
nothing, would be worse than saying so.

Rejected, with reasons: **incrementing the id's last component** (it would
invent an episode the Addon may not have, and the id's shape is the protocol's,
not the Host's); **the client computing the next Video and playing it** (the
ticket makes it an Action, and "what plays next" belongs on the one surface both
clients share); **re-ranking the candidates** ("the best next Stream" is the
scoring engine ADR-0012 rejected; continuing the same release is continuity, not
ranking, and is the only rule that keeps one binge-group's episodes together);
**remembering the Title a client had open** (browsing is per-client, ADR-0005,
and the Host keeping a client's last Title would be shared state invented for
one control).

## Consequences

Every control in the v1 set is now an Action, and the local window and the remote
client of #31/#32 will reach them the same way. A control added later is a
`Telling`, an `Action`, a field on the Snapshot and a property in the reading;
nothing above the seam changes shape. #119's Autocrop is the seam holding with
one field fewer: a `Telling` that is a script binding, an `Action` whose Change
moves no state, and the crop field that was already there carrying what the
script found. #29 reads Watch progress from the position the Host already
publishes and the `Ended` state it can see. The statistics reading is where #18's
HDR checklist will look for what is decoding the picture on a real display. The
Addon `subtitles` resource is where a per-Title subtitle preference would live,
if one is ever asked for.
