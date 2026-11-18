# The Stream buffer is a preference, and two limits bound it

Issue #135: a Stream stutters when the network dips, and the owner asked for a
cache configurable from the preferences — by time, and with a ceiling on the
storage it may take. This records why mpv already caches, which two numbers bound
that cache, and why the Host holds both of them rather than a "cache size".

## The facts this rests on

Read from mpv's own option definitions and `--list-options` in the dev container
(mpv 0.37, FFmpeg 6.1), and from the same options in mpv 0.41's tree — the
version the Windows build runs:

- `cache=auto` (the default) enables the demuxer cache for network Streams, so
  every http(s) Stream this Host opens is already cached.
- `demuxer-max-bytes` defaults to **150 MiB** — the memory the demuxer may fill
  ahead of playback.
- `demuxer-max-back-bytes` defaults to **50 MiB** — the memory kept behind
  playback so a short seek back does not refetch.
- `cache-secs` defaults to **3,600,000 s** (1000 h): effectively no time limit.
  It is the look-ahead the demuxer aims for, and it only limits when it is lower
  than what the byte budget allows.
- All three are runtime-settable: `set cache-secs 300`, `set demuxer-max-bytes
  …` and `set demuxer-max-back-bytes …` each answered `success` on a live mpv
  0.37, so a change does not reopen the Stream.
- `cache-pause=yes` (the default) pauses when the cache runs out and resumes
  when data arrives. That pause is the visible stutter.

The arithmetic that matters: at a 4K remux's bitrate (60–80 Mbps) 150 MiB is
15–20 s of playback. A 20–30 s dip drains it. At 1080p bitrates (8–10 Mbps) the
same budget is ~2 min, so a stall there has another cause — connection loss, the
source, or the machine — and a larger buffer will not hide it.

## 1. One preference, two limits, because either alone lies

`StreamBuffer` is a pair: `seconds` is the look-ahead the Player aims for, and
`megabytes` is the ceiling on the memory it may take. Five minutes at a low
bitrate is a handful of megabytes; five minutes at a 4K remux's bitrate is tens of
gigabytes. A time alone would let a slow Stream eat memory without bound; a size
alone cannot say whether the memory buys 15 seconds or 2 minutes.

The pair is stored as one JSON document in the `preferences` table and carried by
one Action (`set_stream_buffer`), so a client cannot set one limit without the
other and the store writes the pair as one document, never as two rows that could
disagree. It is a preference of the Host's, not a Stream's: an owner sets it once,
and every Stream and every client follows it. It travels in every Snapshot.

The Player keeps the split between forward and back memory. `megabytes` is the
*whole* cache budget, and `host-mpv` divides it 3:1 — 384 MB ahead and 128 MB
behind for the 512 MB default — which is the ratio mpv's own defaults use. The
two halves therefore cannot add up to more than the number the owner chose.

Rejected, with reasons: **time alone** (the low-bitrate case caches for hours);
**size alone** (a number of megabytes is not a number of minutes, and the owner
asked in time); **per-Stream** (the thing an owner sets once and expects to hold
for the next episode too, like the subtitle appearance in ADR-0024); **a
`clear`/reset Action** (the default pair is a value the Host holds, not an
absence).

## 2. The defaults are raised, and that is deliberate

The default is **five minutes up to 512 MB**, not mpv's own 150 MiB / 50 MiB.
The reason is the report that motivated the ticket: at high bitrates mpv's
default is 15–20 s of look-ahead, which is shorter than a typical outage. 512 MB
is a desktop application's budget rather than a server's, the memory is only
taken as the network delivers, and the owner can lower it to 64 MB.

The bound is 5 s to 1 h and 64 MB to 4096 MB. Below 5 s the cache cannot ride out
even a seek's round trip; above an hour the byte ceiling is doing all the work
anyway. The ranges are validated in `StreamBuffer::parse`, so a client cannot set
a pair outside them. Settings offers presets inside the range; a Remote may send
any pair the bounds allow, and a value between presets is drawn as its own chip
rather than leaving every chip unpressed. The unit is the decimal megabyte, which
is what every label says: the ceiling is shown in MB throughout, so 1024 MB is
never quietly relabelled as a gigabyte.

## 3. Memory, not disk

`cache-on-disk=yes` exists in mpv 0.37 and 0.41, and it is not this. It writes
the same packet cache to a temporary file instead of RAM, and deletes the file when
playback closes; it does **not** increase how far ahead the demuxer reads (the
`demuxer-max-*` limits still apply, to metadata only). It is a way to save RAM at
the cost of disk I/O and lifetime, not a way to survive a longer outage. The
Streams this Host plays are private URLs a debrid Addon minted, and a cache file
on disk is another copy of bytes the owner did not ask the Host to keep. A torrent's bounded on-disk cache is the one exception (ADR-0042 §3).

Rejected, with reasons: **`cache-on-disk` as the "storage" limit** (it changes
where the cache lives, not how much is read ahead, and it is deleted at close);
**a persisted downloaded Stream** (a different feature: an offline copy with
licensing and retention questions, not a read-ahead).

## 4. One list, two clients

The window's Settings and the served Remote offer presets from
`src/stream-buffer.json`, spliced into the Remote at serve time exactly as the
subtitle appearance list is (ADR-0018 §1). The file carries the bounds
`StreamBuffer::parse` enforces and the default pair, and `host-wire`'s tests hold
all of them to the Host's constants, so a preset the window offers is one the
Host accepts and the Remote cannot drift.

The preference is applied as `Telling::StreamBuffer` in two places: once when the
Host starts, before anything is opened, and once per change. A Player that refuses
the telling does not stop the Host holding the preference — the next Stream
starts from it, as with the appearance.

## Consequences

- A Stream is read further ahead than mpv would read it by default, at high
  bitrates most of all; up to 512 MB of RAM is held while one plays.
- The setting changes the live Stream, not only the next one.
- It does not fix a stall whose cause is not a short dip: if 1080p still stutters
  with two minutes of buffer, the next places to look are the connection
  (mpv's own `reconnect` handling and its timeout), the source, and the machine.
- The Windows walkthrough still has to confirm the behaviour with a real 4K
  Stream and a controlled network dip; no unit test can see a network.
