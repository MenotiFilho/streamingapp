#!/usr/bin/env bash
# The video for the walkthrough's Addon fixture, generated where ffmpeg is: the
# dev container. The Windows side has no encoder of its own.
#
#   scripts/windows/fixture-video.sh /mnt/c/Users/<you>/streamingapp-verify
#
# It is not just something to play. The control set has to be walkable on it, so
# the file carries, in the container itself:
#
#   - two audio tracks, `eng` ("English stereo") and `por` ("Portuguese");
#   - three embedded subtitle tracks: `eng` and `por` plain text (SRT), and an
#     ASS track whose line is authored red. Embedded, because an embedded track
#     is the one that has to win over an Addon's fallback (ADR-0014), and of two
#     kinds because the subtitle appearance has to be checked on both: colour
#     reaches the SRT text, an ASS track keeps the colour it was authored with,
#     and size reaches both (#126, ADR-0024);
#   - two chapters (`Intro`, `Middle`), so the chapter controls move;
#   - 1280x540 of picture padded into a 1280x720 frame, so there are 90 px black
#     bars top and bottom for the Autocrop toggle to find;
#   - two minutes, so a person can walk the menu while it plays and so the
#     Autocrop detect — which needs more than a second of playtime remaining —
#     has something to work on at the crop step;
#   - H.264 `yuv420p`, compressed, so hardware decode has something to engage on.
#     A raw stream would say nothing about whether a GPU decoder did anything.
#
# The ffmpeg that makes it, run in the container from the repo root:
#
#   ffmpeg -y \
#     -f lavfi -i "testsrc2=size=1280x540:rate=30:duration=120" \
#     -f lavfi -i "sine=frequency=440:duration=120" \
#     -f lavfi -i "sine=frequency=880:duration=120" \
#     -f ffmetadata -i chapters.txt -i en.srt -i pt.srt -i styled.ass \
#     -map 0:v -map 1:a -map 2:a -map 4:s -map 5:s -map 6:s -map_metadata 3 \
#     -vf "pad=1280:720:0:90:black" \
#     -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
#     -c:a aac -b:a 96k -c:s srt -c:s:2 ass \
#     -metadata:s:a:0 language=eng -metadata:s:a:0 title="English stereo" \
#     -metadata:s:a:1 language=por -metadata:s:a:1 title="Portuguese" \
#     -metadata:s:s:0 language=eng -metadata:s:s:1 language=por \
#     -metadata:s:s:2 language=eng -metadata:s:s:2 title="ASS styled" \
#     verify-controls.mkv
#
# It is a real Matroska file with an index and a duration — not a fragmented
# pipe, which has no index and so no length for a player to seek by. ffmpeg
# writes into the container; the file is copied out, so nothing lands in the
# repo.
set -euo pipefail

target="${1:?usage: fixture-video.sh <windows-path-as-seen-from-wsl>}"
repo="$(git rev-parse --show-toplevel)"
cd "$repo"

mkdir -p "$target/fixture"
echo "encoding $(docker compose exec -T dev ffmpeg -version 2>/dev/null | head -1) ..."

# The subtitles and the chapter list are text ffmpeg reads. They are written on
# this side of the container and copied in, so the mux is one ffmpeg call and no
# scratch file of theirs lands in the repo.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

cat > "$scratch/chapters.txt" <<'EOF'
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=0
END=60000
title=Intro
[CHAPTER]
TIMEBASE=1/1000
START=60000
END=120000
title=Middle
EOF

# The lines stay on screen long enough for a person to walk the OSD and take
# the screenshot the appearance step reviews (#126).
cat > "$scratch/en.srt" <<'EOF'
1
00:00:00,500 --> 00:00:55,000
English subtitle one - this line takes the colour chosen in Settings.

2
00:00:56,000 --> 00:01:55,000
English subtitle two - still in the chosen colour.
EOF

cat > "$scratch/pt.srt" <<'EOF'
1
00:00:01,000 --> 00:00:55,000
Legenda em portugues um - esta linha recebe a cor escolhida.

2
00:00:56,000 --> 00:01:55,000
Legenda em portugues dois - ainda na cor escolhida.
EOF

# An ASS track with its own colour: red (ASS colour is &HBBGGRR, so &H000000FF
# is red). Its authored colour, font and typesetting must survive the Host's
# sub-colour preference; only the size the Host sets reaches it (ADR-0024).
cat > "$scratch/styled.ass" <<'EOF'
[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Styled,Arial,40,&H000000FF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,1,2,60,60,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.50,0:01:55.00,Styled,,0,0,0,,ASS styled line - authored red, 40 px
EOF

docker compose cp "$scratch/chapters.txt" dev:/tmp/verify-chapters.txt >/dev/null
docker compose cp "$scratch/en.srt" dev:/tmp/verify-en.srt >/dev/null
docker compose cp "$scratch/pt.srt" dev:/tmp/verify-pt.srt >/dev/null
docker compose cp "$scratch/styled.ass" dev:/tmp/verify-styled.ass >/dev/null

docker compose exec -T dev ffmpeg -hide_banner -loglevel error -nostdin -y \
  -f lavfi -i "testsrc2=size=1280x540:rate=30:duration=120" \
  -f lavfi -i "sine=frequency=440:duration=120" \
  -f lavfi -i "sine=frequency=880:duration=120" \
  -f ffmetadata -i /tmp/verify-chapters.txt \
  -i /tmp/verify-en.srt -i /tmp/verify-pt.srt -i /tmp/verify-styled.ass \
  -map 0:v -map 1:a -map 2:a -map 4:s -map 5:s -map 6:s -map_metadata 3 \
  -vf "pad=1280:720:0:90:black" \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -c:s srt -c:s:2 ass \
  -metadata:s:a:0 language=eng -metadata:s:a:0 title="English stereo" \
  -metadata:s:a:1 language=por -metadata:s:a:1 title="Portuguese" \
  -metadata:s:s:0 language=eng \
  -metadata:s:s:1 language=por \
  -metadata:s:s:2 language=eng -metadata:s:s:2 title="ASS styled" \
  /tmp/verify-controls.mkv

docker compose cp dev:/tmp/verify-controls.mkv "$target/fixture/verify-controls.mkv"

echo "wrote $target/fixture/verify-controls.mkv ($(wc -c <"$target/fixture/verify-controls.mkv") bytes)"
echo "next: run fixture-addon.ps1 on the Windows side, pointed at that file"
