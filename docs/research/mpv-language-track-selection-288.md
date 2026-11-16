# How mpv 0.41 chooses subtitle and audio tracks from a list of languages (#288)

**Date:** 2026-11-16. **Ticket:** #288 (map #283; feeds #289).
**Primary sources:** Upstream `mpv-player/mpv` tag `v0.41.0` (commit `41f6a645068483470267271e1d09966ca3b9f413`) — source (`player/loadfile.c`, `player/command.c`, `player/core.h`, `options/options.c`, `options/m_option.c`, `misc/language.c`, `osdep/language-win.c`, `common/common.h`, `demux/demux_mkv.c`, `demux/demux_lavf.c`) and manual (`DOCS/man/options.rst`, `DOCS/man/input.rst`, `DOCS/man/mpv.rst`). Host implementation read from `crates/host-mpv/src/{lib.rs,telling.rs,observing.rs}`, `crates/host-core/src/{host.rs,playback.rs,preferences.rs,subtitles.rs}`, `docs/research/mpv-control-facts.md`, and `docs/adr/0014-the-full-control-set-one-telling-and-what-travels.md`.

> Note on Windows build target: `scripts/windows/build.ps1` downloads `mpv-dev-x86_64-v3` from `shinchiro/mpv-winbuild-cmake/releases/latest` (0.41 at the time of #28 / `mpv-control-facts.md`). Everything below is verified against `mpv` `v0.41.0`.

## Summary

mpv can take ordered comma-separated lists on `slang` and `alang`, and for embedded tracks at load time its list priority strictly outranks `default` and `forced` flags. However, five verified behaviors in mpv 0.41 limit what delegating to `slang`/`alang` alone can deliver for #289:

1. **`pt-BR` does not outscore bare `pt`/`por` in code** (`misc/language.c:273-293`), even though the manual says more matching subtags win: `pt-BR` and `por` tie at `INT_MAX`, while `pt-PT` drops by `1000`.
2. **`pob` is unknown to mpv's canonicalization table** (`misc/language.c:29-221`): `pt-BR` and `por` score `0` against an Addon or container track tagged `pob`.
3. **Addon subtitles added via `sub-add <url> auto` after load never join `slang` selection** (`player/command.c:6316-6375`): `select_default_track` only runs once before `MPV_EVENT_FILE_LOADED`; `sub-add ... auto` adds tracks with `selected: false` and leaves `sid` unchanged.
4. **`hearing-impaired` is ignored during selection** (`player/loadfile.c:457-627`) and **changing `slang`/`alang` mid-file does not re-select tracks** (`player/command.c:7900-8050`).
5. **Turning subtitles off (`sid=no`, i.e., `-2`) persists across files** (`player/loadfile.c:567, 656-663`), silently bypassing `slang` on subsequent Streams even when track layouts differ.

---

## 1. `slang` and `alang` as lists: matching, priority, and no-match fallback

### List option representation

Both `alang` (`stream_lang[STREAM_AUDIO]`) and `slang` (`stream_lang[STREAM_SUB]`) are `OPT_STRINGLIST` options (`options/options.c:629-630`, `options/m_option.c:1654`).

- Passed as strings (e.g., `set slang pt-BR,por,en` or `set alang ja,en`), `separate_input_param` splits on `,` with `\`-escaping (`options/m_option.c:1420-1495`, `DOCS/man/mpv.rst`, *List Options*).
- Via `libmpv` `MPV_FORMAT_NODE_ARRAY`, `str_list_set` accepts an array of strings directly (`options/m_option.c:1596-1613`).
- Passing `""` sets `["" , NULL]`; `select_default_track` treats both `NULL` and `langs[0] == ""` as empty (`player/loadfile.c:572`).

### Matching and scoring (`mp_match_lang`)

`mp_match_lang(char **langs, const char *lang)` (`misc/language.c:251-298`) scores one track's `lang` against an ordered `langs` array:

1. If the track has no `lang` (`NULL`), return `0`.
2. Split the track `lang` on `'-'` into `lang_parts[0..lang_parts_n - 1]`.
3. For each entry `langs[idx]` (`idx = 0, 1, ...`), split on `'-'` and match subtag by subtag:
   - **Primary subtag (`part == 0`)**: canonicalize both `lang_parts[0]` and the preference's primary subtag via `canonicalize()` (`misc/language.c:242-249`), a case-insensitive `bsearch` over `langmap[]` (`misc/language.c:29-221`). If they differ, this list entry yields `0`. If they match, base `score = INT_MAX - idx`.
   - **Remaining subtags (`part >= 1`)**: while both `langs[idx]` and `lang` have subtags, each case-insensitive mismatch subtracts `1000`. If `langs[idx]` runs out of subtags first, each extra subtag on the track (`lang_parts_n - part`) subtracts `1000` (`misc/language.c:291`). If the track runs out of subtags first (`part >= lang_parts_n`), the loop simply breaks (`misc/language.c:282-283`) with **no penalty and no bonus**.
4. Return `best_score = max(score)` across all entries in `langs`.

### Concrete examples: `pt-BR` against `pt`, `por`, `pob`, `pt-PT`

`langmap[]` maps ISO 639-1 two-letter and ISO 639-2/T three-letter codes to ISO 639-2/B canonical codes (e.g., `pt` -> `por` at `misc/language.c:172`, `en` -> `eng` at `misc/language.c:68`, `ja` -> `jpn` at `misc/language.c:107`). **`pob` is not in `langmap[]`** (no occurrence anywhere in mpv 0.41.0).

| `langs` list | Track `lang` | `mp_match_lang` score | Outcome |
|---|---|---|---|
| `["pt-BR"]` | `pt-BR` | `INT_MAX` | Match (`idx=0`, both subtags match) |
| `["pt-BR"]` | `pt` or `por` | **`INT_MAX`** | **Ties `pt-BR`** (track ends at `part=1`, no penalty/bonus) |
| `["pt-BR"]` | `pt-PT` | `INT_MAX - 1000` | Penalized by `1000` for `PT != BR` |
| `["pt-BR"]` | `pob` | `0` | No match (`canonicalize("pob") = "pob" != "por"`) |
| `["pt"]` or `["por"]` | `pt-BR` | `INT_MAX - 1000` | Penalized by `1000` for extra `-BR` subtag on track |
| `["pt-BR", "en"]` | `pt-PT` vs `en` | `INT_MAX - 1000` vs `INT_MAX - 1` | **`en` beats `pt-PT`** (`-1` > `-1000`) |
| `["pt-BR", "por", "pob"]` | `pob` | `INT_MAX - 2` | Matches only because `pob` is listed explicitly |

> **Source vs. manual discrepancy:** `DOCS/man/options.rst:11-12, 34-36` states *"A track that matches more subtags will be preferred over one that matches fewer"* and gives `--slang=pt-BR` as preferring Brazilian Portuguese over generic Portuguese. In `misc/language.c:273-293`, `pt-BR` does beat `pt-PT`, **but ties with bare `pt` / `por` at `INT_MAX`** — so container order (`user_tid`) or `default` decides between `por` and `pt-BR` when both exist. (Meanwhile, `pt-BR` followed by `pt-PT` would need `pt-BR,pt-PT` or `pt-BR,por` depending on whether `en` sits between them, because `-1000` outweighs list index `< 1000`.)

### Priority order across the list

Each list step subtracts `1` (`INT_MAX - idx`), so for identical subtag fit, `langs[0]` beats `langs[1]` beats `langs[2]`. However, a subtag mismatch (`-1000`) outweighs up to 999 list positions.

### What mpv chooses when nothing matches

Track selection runs once per `STREAM_TYPE` in `enum stream_type` order: `STREAM_VIDEO` (`0`), `STREAM_AUDIO` (`1`), `STREAM_SUB` (`2`) (`common/common.h:75-80`, `player/loadfile.c:1786-1795`), so `current_track[0][STREAM_VIDEO]` and `current_track[0][STREAM_AUDIO]` are already chosen before subtitles are evaluated.

- **Audio (`alang`)** (`player/loadfile.c:614-615`): Every eligible audio track can initialize `pick` (`!pick || compare_track(...)`). When nothing in `alang` matches (`l1 == l2 == 0` for all tracks), `compare_track` still picks a track using the remaining tie-breakers (external > matching video `program_id` > `default` > non-`attached_picture` > non-`image` > non-`dependent` > `hls_bitrate` > lowest `user_tid`). Thus mpv **always selects an audio track** if one exists (unless `aid=no` or `track-auto-selection=no`).
- **Subtitles (`slang`)** (`player/loadfile.c:596-613`): An initial `pick` (`!pick`) is accepted **only** if at least one of `forced`, `lang_match`, or `subs_fallback` holds (all gated by `subs_matching_audio`):
  ```c
  bool audio_matches = mp_match_lang((char *[]){ (char *)audio_lang, NULL }, track->lang) > 0;
  bool forced = track->forced_track && (opts->subs_fallback_forced == 2 ||
                (audio_matches && opts->subs_fallback_forced == 1));
  bool lang_match = !os_langs && mp_match_lang(langs, track->lang) > 0;
  bool subs_fallback = (track->is_external && !track->no_default) || opts->subs_fallback == 2 ||
                       (opts->subs_fallback == 1 && track->default_track);
  bool subs_matching_audio = (!mp_match_lang(langs, audio_lang) || opts->subs_with_matching_audio == 2 ||
                              (opts->subs_with_matching_audio == 1 && track->forced_track));
  ```
  With 0.41 defaults (`subs-fallback=default`, `subs-fallback-forced=yes`, `subs-with-matching-audio=yes`), when **no track matches `slang`**:
  - A track flagged `default` in another language passes `subs_fallback` and **is selected**.
  - A track flagged `forced` in the same language as the chosen audio track passes `forced` and **is selected**.
  - An autoloaded/non-`no_default` external track passes `subs_fallback` and **is selected**.
  - If none of those exist, **`pick` remains `NULL`** (subtitles stay off, `sid = no` / `false`).

---

## 2. Relevant options, mpv 0.41 defaults, and how each changes selection

Defaults in `options/options.c:1029, 1056-1059` (option definitions at `options/options.c:633-637, 721`):

| Option | 0.41 Default | Allowed values | Effect on selection (`player/loadfile.c`) |
|---|---|---|---|
| `track-auto-selection` | `yes` (`true`) | `yes`, `no` | If `no`, `select_default_track` is never called (`loadfile.c:1791-1792`); no video, audio, or sub tracks are selected on load and playback waits instead of failing with `NOTHING_TO_PLAY`. |
| `subs-with-matching-audio` | `yes` (`2`) | `no` (`0`), `forced` (`1`), `yes` (`2`) | Checks `mp_match_lang(langs, audio_lang)` (`loadfile.c:604-605`). Under `no`, if the selected audio matches `langs` (`slang`, or OS langs when `slang` empty), **no subtitle track at all** (not even `forced` or `default`) is auto-selected. Under `forced`, only `forced` tracks are eligible. **Multi-language pitfall:** if `slang=pt-BR,en` and `subs-with-matching-audio=no`, English audio matches `en` in `slang` and suppresses `pt-BR` subtitles too. |
| `subs-match-os-language` | `yes` (`true`) | `yes`, `no` | Active **only** when `slang` is empty/unset (`!langs \|\| !strcmp(langs[0], "")`, `loadfile.c:572`); **completely ignored** whenever `slang` has any entry. Reads `mp_get_user_langs()` (`osdep/language-win.c:37` calls `GetUserPreferredUILanguages` then `GetSystemPreferredUILanguages`). Never applies to `alang`. Sets `os_langs = true`, which disables `lang_match` (`loadfile.c:601`) and demotes language matching below `default` and `!forced` (`loadfile.c:487, 495`). |
| `subs-fallback` | `default` (`1`) | `no` (`0`), `default` (`1`), `yes` (`2`) | Controls non-`slang`-matching fallback (`loadfile.c:602-603`). `no`: never fall back to non-matching embedded tracks (unless `forced`). `default`: fall back only to tracks with `default_track`. `yes`: any subtitle track satisfies `subs_fallback`, so mpv picks a subtitle even if nothing matches `slang`. |
| `subs-fallback-forced` | `yes` (`1`) | `no` (`0`), `yes` (`1`), `always` (`2`) | Controls `forced` (`loadfile.c:599-600`). `no`: `forced` is always `false` (note: if the *only* `slang`-matching track is forced, `lang_match` can still pick it!). `yes`: `forced` is true if `forced_track` and `track->lang` matches `audio_lang`. `always`: `forced` is true for any `forced_track`, ignoring `audio_lang`. |

### Track-ID persistence across files (`sid=no` / `track_layout_hash`)

`check_previous_track_selection` (`player/loadfile.c:649-667`, `DOCS/man/options.rst:88-100`) only resets `opts->stream_id[i][t]` when `>= 0` (explicit numeric track IDs when a new file has a different track layout hash). **`sid=no` (`-2`) is `< 0`, so it is never reset across files**: if a user disables subtitles (`set sid no`) on one Stream, `select_default_track` returns `NULL` at `if (tid == -2) return NULL` (`player/loadfile.c:567`) on every subsequent Stream until `sid` is explicitly set back to `auto` (`-1`) or a track ID.

---

## 3. Forced, `default`, and `hearing-impaired` flags vs. language priority

Exact comparison order in `compare_track(t1, t2, ...)` (`player/loadfile.c:461-511`) when `!os_langs` (i.e., `slang`/`alang` is non-empty):

1. `--no-autoload-files`: embedded beats external (`loadfile.c:465-466`).
2. External without `no_default` (`is_external && !no_default`) beats embedded (`loadfile.c:467-474`).
3. Explicitly loaded external (`!auto_loaded`) beats directory-autoloaded (`auto_loaded`) (`loadfile.c:475-476`).
4. Matching video `program_id` (HLS/MPEG-TS) (`loadfile.c:477-481`).
5. **Language list score `mp_match_lang(langs, t->lang)`** (`loadfile.c:486-488`) — **outranks `default`, `forced`, and track order**.
6. **`forced`** (`if (forced) return t1->forced_track`, `loadfile.c:489-490`) — breaks ties within the same language score when `subs-fallback-forced=always`, or when `subs-fallback-forced=yes` and `track->lang` matches `audio_lang` (note: this causes a forced track to beat a full track of the *same* `slang` language when audio is also in that language).
7. **`default_track`** (`t1->default_track != t2->default_track && !t2->forced_select`, `loadfile.c:491-492`) — `default=yes` beats `default=no` within the same language score (unless `t2` was selected via `forced`).
8. **Non-forced over unrequested forced** (`if (sub && !t2->forced_select && t2->forced_track) return !t1->forced_track`, `loadfile.c:493-494`) — penalizes forced tracks that did not qualify for `forced` (e.g., `subs-fallback-forced=yes` with audio in a different language).
9. *(When `slang` is empty and `subs-match-os-language=yes`, `os_langs` language score is checked **here**, **after** `default` and `!forced`, at `loadfile.c:495-496`.)*
10. Non-`attached_picture`, non-`image`, non-`dependent_track`, `hls_bitrate`, and finally lowest `user_tid` (`t1->user_tid <= t2->user_tid`, container order) (`loadfile.c:497-511`).

### `hearing-impaired`

`track->hearing_impaired_track` is populated from Matroska `FlagHearingImpaired` (`demux/demux_mkv.c:962-964`), FFmpeg `AV_DISPOSITION_HEARING_IMPAIRED` (`demux/demux_lavf.c:839`), external filename suffixes `.sdh`/`.hi`/`.cc` (`misc/language.c:338`), or `sub-add ... +hearing-impaired` (`player/command.c:7265`). It is exposed as `track-list/N/hearing-impaired` (`player/command.c:2058`), **and nowhere else in selection**: `select_default_track` and `compare_track` never read `hearing_impaired_track`. Between a regular track and an SDH track of the same language and flags, mpv picks whichever has the lower `user_tid` (appears first in the container).

---

## 4. External subtitle files added after load (`sub-add`)

`sub-add <url> [<flags> [<title> [<lang>]]]` is handled by `cmd_track_add` (`player/command.c:6316-6375`) calling `mp_add_external_file` (`player/loadfile.c:828-935`).

What each primary flag does (`cmd_track_add` encodes `select=0`, `auto=1`, `cached=2`, combinable with `+hearing-impaired`, `+visual-impaired`, `+forced`, `+default`, `player/command.c:7261-7271`):

- **`select` (`0`, mpv default)**: After adding the external track(s), immediately calls `mp_switch_track(mpctx, STREAM_SUB, t, FLAG_MARK_SELECTION)` on the first stream (`n == first`) if `playback_initialized` is true (or `mark_track_selection` if false). Unconditionally selects the track, **ignoring `slang`**. Calling `sub-add <url> select` for multiple candidates leaves the **last** added subtitle selected.
- **`auto` (`1`, what the Host sends today)**: Sets `t->no_default = true` and **never calls `mp_switch_track` or `select_default_track`** (`player/command.c:6346-6360`).
  - If called *before* `select_default_track` runs (e.g., inside an `on_load` / `on_preloaded` hook while `playback_initialized == false`), the track is in `mpctx->tracks` when `select_default_track` runs at `player/loadfile.c:1792` — with `no_default = true` suppressing the external-over-embedded boost.
  - When called **after `MPV_EVENT_FILE_LOADED`** (when `playback_initialized == true` at `player/loadfile.c:1866`, which is when the Host's Addon fallback runs), **`sub-add <url> auto` never triggers selection at all**: the track is appended to `track-list` with `selected: false`, and `sid` remains unselected (`no`).
- **`cached` (`2`)**: Calls `find_track_with_url` (`player/command.c:5253-5268`). If an external track with the same normalized URL already exists, immediately selects that existing track (`mp_switch_track`) and returns (ignoring new `title`/`lang`). Otherwise loads the file and selects it (`select != 1`).

Note also that `cmd_track_add` sets `t->title` and `t->lang` after `mp_add_external_file` (`player/command.c:6361-6366`) and does not run `mp_guess_lang_from_filename` (only `autoload_external_files` and `sub-reload` do).

---

## 5. Mid-file changes to `slang` and `alang`

Changing `slang` or `alang` at runtime (`set slang ...` / `set alang ...` via `mp_property_generic_option`, `player/command.c:418-452, 7696`) updates `opts->stream_lang[...]` and emits `mp_notify_property(mpctx, co->name)` (`player/command.c:7854-7900`). Neither `slang` nor `alang` has an `UPDATE_*` flag (`options/options.c:629-630`), and `mp_option_run_callback` has no branch for `opts->stream_lang` (`player/command.c:7900-8050`).

Therefore, **changing `slang` or `alang` mid-file never re-selects tracks on the currently playing Stream**; it only takes effect on the next `loadfile` (and only while `sid`/`aid` is `auto`).

---

## 6. What the Host can observe to decide for itself

All track metadata and selection state are exposed as scalar sub-properties (readable through `libmpv2` without `MPV_FORMAT_NODE`, `docs/research/mpv-control-facts.md:45-50`):

- **`track-list/count` and `track-list/N/*`** (`player/command.c:2024-2131`, `DOCS/man/input.rst:3308-3539`):
  - `id` (`i64`, the ID passed to `set sid <id>` / `set aid <id>`)
  - `type` (`"video"`, `"audio"`, `"sub"`)
  - `lang` (`String`, unavailable if unset)
  - `title` (`String`, unavailable if unset)
  - `codec` (`String`)
  - `external` (`bool`), `external-filename` (`String`, unavailable if embedded)
  - `selected` (`bool`), `main-selection` (`i64`, `0` for `sid`/`aid`/`vid`, `1` for `secondary-sid`, unavailable if unselected)
  - `default` (`bool`), `forced` (`bool`), `hearing-impaired` (`bool`), `visual-impaired` (`bool`), `dependent` (`bool`)
- **`current-tracks/{video,audio,sub,sub2}/*`** (`player/command.c:2257-2300`, `DOCS/man/input.rst:3541-3553`):
  - Redirects directly to `track-list/<selected_index>/*` for the active track of that kind, or `M_PROPERTY_UNAVAILABLE` when nothing is selected (e.g., `current-tracks/sub/id`, `current-tracks/sub/lang`, `current-tracks/audio/lang`).
- **Invalidation events** (`player/command.c:4581-4582`): `MP_EVENT_TRACKS_CHANGED` and `MP_EVENT_TRACK_SWITCHED` invalidate both `track-list` and `current-tracks`.

Today `MpvPlayer::tracks` (`crates/host-mpv/src/lib.rs:321-356`) already reads `id`, `type`, `lang`, `title`, `codec`, `external`, `selected`, `default`, `forced`, and maps them into `host_core::Track` (`crates/host-core/src/playback.rs:368-391`). It does **not** yet read `hearing-impaired` (or `current-tracks/*`), though `track-list/N/selected` already tells the Host what mpv chose. Because the Host can read every candidate track's `id`, `lang`, `default`, `forced`, `external` (and optionally `hearing-impaired`) and write `set sid <id>` / `set sid no` / `set aid <id>`, it has full information to decide or override track selection itself.

---

## 7. How the Host tells mpv today, and what a language list changes

### Today's Host implementation

- **Preferences & Action surface** (`crates/host-core/src/preferences.rs:12-36, 145-209`): stores a single `subtitle_language: Option<SubtitleLanguage>` (one BCP-47-shaped tag, no audio language preference).
- **Host lifecycle** (`crates/host-core/src/host.rs:213-215, 1156-1168`): sends `Telling::SubtitleLanguage(...)` once at startup and on every `SetSubtitleLanguage` / `ClearSubtitleLanguage` change.
- **Telling spelling** (`crates/host-mpv/src/telling.rs:124-129, 143-155`):
  - `Telling::SubtitleLanguage(Some(lang))` -> `set slang <lang>`
  - `Telling::SubtitleLanguage(None)` -> `set slang ""`
  - `Telling::AddSubtitle { url, title, language }` -> `sub-add <url> auto [<title_or_empty> [<lang>]]`
  - Never sets `alang`, `subs-fallback`, `subs-fallback-forced`, `subs-with-matching-audio`, `subs-match-os-language`, or `track-auto-selection`.
- **Addon subtitles fallback** (`crates/host-core/src/host.rs:1036, 1082-1144`; `crates/host-core/src/subtitles.rs:45-160`): triggers inside `Host::sample` once a Stream is `Playing | Paused` with no embedded subtitle tracks; keeps Addon order, stops after `MAX_FALLBACK_SUBTITLES = 5` across all Addons, and issues `sub-add ... auto`.
- **`docs/research/mpv-control-facts.md:61-72` and ADR-0014**: document that the Host passes `slang` through unchanged without implementing its own language matching, and `docs/adr/0014-the-full-control-set-one-telling-and-what-travels.md` assumes `sub-add ... auto` lets mpv's selection rules decide whether to show the added subtitle.

### What a list of languages changes

1. **`set slang` / `set alang` spelling**: Passing a comma-joined list (e.g., `set slang pt-BR,por,en`, `set alang ja,en`) works natively in `telling.rs` (`OPT_STRINGLIST`), and clearing with `""` stays valid. Adding an audio language list requires a new `Telling` variant mapping to `alang`.
2. **Relying solely on `slang`/`alang` breaks down on four points the Host should decide in #289**:
   - **Tag variants & `pob`**: mpv matches `pt-BR` equally to `pt`/`por` (no regional preference over bare `por`) and never matches `pob` unless `"pob"` is explicitly included in the list.
   - **No-match policy (`subs-fallback`)**: with mpv's default `subs-fallback=default`, an unrelated `default=yes` subtitle track is still selected when none of the list's languages exist (unless `subs-fallback=no` is set, or the Host selects/deselects tracks itself). Conversely, with `slang=""`, `subs-match-os-language=yes` picks an OS-language subtitle unasked.
   - **Addon subtitles fallback (`sub-add`)**: `sub-add <url> auto` after `FILE_LOADED` **never** selects an Addon subtitle regardless of `slang` (contrary to ADR-0014's assumption), and `MAX_FALLBACK_SUBTITLES = 5` currently truncates Addon results in Addon order *before* checking the user's language list — so preferred languages past position 5 are dropped before mpv ever sees them.
   - **Mid-file changes, `hearing-impaired`, and `sid=no` stickiness**: mpv ignores `hearing-impaired`, does not re-evaluate `slang`/`alang` mid-file, and retains `sid=no` across Streams. If #289 wants immediate re-selection on preference change, preference/avoidance of `hearing-impaired`, true `pt-BR` > `por`/`pob` > `pt-PT` ranking, or auto-selection of Addon fallback subtitles, the Host must rank `track-list` (and Addon `Subtitle` responses before the `sub-add` cap) itself and issue `set sid <id>` / `set sid no` / `set aid <id>` (or reset `sid`/`aid` to `auto` on `open`).
