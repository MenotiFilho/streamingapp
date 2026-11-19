// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"strings"
	"testing"
)

// files builds a torrent's file list from "path:size" shorthand, in order.
func files(spec ...string) []torrentFile {
	out := make([]torrentFile, len(spec))
	for i, s := range spec {
		path, size, _ := strings.Cut(s, ":")
		out[i] = torrentFile{Path: path, Size: sizeOf(size)}
	}
	return out
}

func sizeOf(s string) int64 {
	var n int64
	for _, c := range s {
		n = n*10 + int64(c-'0')
	}
	return n
}

func episode(season, ep int) Hints { return Hints{Season: ptr(season), Episode: ptr(ep)} }

func TestChooseFile(t *testing.T) {
	cases := []struct {
		name    string
		files   []torrentFile
		fileIdx *int
		hints   Hints
		want    int
	}{
		// 1. fileIdx, trusted only when in range and a video.
		{"a fileIdx in range at a video is trusted", files("a.mkv:10", "b.mkv:500", "c.mkv:20"), ptr(2), Hints{}, 2},
		{"a fileIdx at the first file", files("a.mkv:10", "b.mkv:500"), ptr(0), Hints{}, 0},
		{"a fileIdx beats the episode match", files("s01e01.mkv:10", "s01e02.mkv:20"), ptr(0), episode(1, 2), 0},
		{"a fileIdx past the end is distrusted", files("a.mkv:10", "b.mkv:500", "c.mkv:20"), ptr(3), Hints{}, 1},
		{"a negative fileIdx is distrusted", files("a.mkv:10", "b.mkv:500", "c.mkv:20"), ptr(-1), Hints{}, 1},
		{"a fileIdx at a non-video is distrusted", files("a.mkv:10", "notes.txt:900", "b.mkv:50"), ptr(1), Hints{}, 2},
		{"a distrusted fileIdx falls through to the episode match", files("Show.S01E01.mkv:10", "Show.S01E02.mkv:20", "x.nfo:1"), ptr(2), episode(1, 1), 0},

		// 2. the exact filename hint.
		{"the exact filename hint", files("a.mkv:900", "Film.2020.1080p.mkv:10", "c.mkv:20"), nil, Hints{Filename: ptr("Film.2020.1080p.mkv")}, 1},
		{"the filename hint matches the file's own name, not its folder", files("Pack/a.mkv:900", "Pack/Film.mkv:10"), nil, Hints{Filename: ptr("Film.mkv")}, 1},
		{"the filename hint is exact, not a prefix", files("a.mkv:900", "Film.2020.1080p.mkv:10"), nil, Hints{Filename: ptr("Film.2020")}, 0},
		{"a filename hint at a non-video is not played", files("a.mkv:10", "Film.nfo:900"), nil, Hints{Filename: ptr("Film.nfo")}, 0},
		{"a filename hint no file has falls through", files("a.mkv:10", "b.mkv:500"), nil, Hints{Filename: ptr("zzz.mkv")}, 1},
		{"the filename hint beats the episode match", files("Show.S01E01.mkv:10", "Show.S01E02.mkv:20", "other.mkv:5"), nil, Hints{Filename: ptr("other.mkv"), Season: ptr(1), Episode: ptr(1)}, 2},

		// 3. video extensions only.
		{"every allowed extension is a video", files("a.mkv:1", "b.mp4:2", "c.avi:3", "d.mov:4", "e.wmv:5", "f.flv:6", "g.webm:7", "h.m4v:8", "i.mpg:9", "j.mpeg:10", "k.ts:11", "l.m2ts:12", "z.txt:99"), nil, Hints{}, 11},
		{"an extension is read in any case", files("a.txt:99", "B.MKV:5"), nil, Hints{}, 1},
		{"the largest file is not a video", files("a.mkv:10", "disc.iso:9000", "b.mp4:20", "c.srt:80"), nil, Hints{}, 2},

		// 4. the episode.
		{"SxxEyy", files("Show.S01E01.mkv:10", "Show.S01E02.mkv:10", "Show.S01E03.mkv:10"), nil, episode(1, 3), 2},
		{"sxey in lower case and one digit", files("show.s1e1.mkv:10", "show.s1e2.mkv:10"), nil, episode(1, 2), 1},
		{"NxNN", files("Show 1x01.mkv:10", "Show 1x02.mkv:10", "Show 1x03.mkv:10"), nil, episode(1, 3), 2},
		{"NxNN with a two-digit season", files("Show 12x01.mkv:10", "Show 12x02.mkv:10"), nil, episode(12, 2), 1},
		{"SxxEyyEzz matches either episode", files("Show.S01E01E02.mkv:10", "Show.S01E03E04.mkv:10"), nil, episode(1, 4), 1},
		{"SxxEyyEzz matches the first", files("Show.S01E01E02.mkv:10", "Show.S01E03E04.mkv:10"), nil, episode(1, 1), 0},
		{"an episode is not matched by a longer number", files("Show.S01E031.mkv:10", "Show.S01E03.mkv:5"), nil, episode(1, 3), 1},
		{"a season other than the one asked is not a match", files("Show.S02E03.mkv:900", "Show.S01E03.mkv:10"), nil, episode(1, 3), 1},
		{"a season folder and a leading NN", files("Show/Season 1/01 - Pilot.mkv:10", "Show/Season 1/02 - Two.mkv:10", "Show/Season 2/02 - Other.mkv:10"), nil, episode(1, 2), 1},
		{"a season folder and a leading ENN", files("Show/Season 1/E01.mkv:10", "Show/Season 1/E02.mkv:10"), nil, episode(1, 2), 1},
		{"a season folder and a leading Episode N", files("Show/Season 1/Episode 1.mkv:10", "Show/Season 1/Episode 2.mkv:10"), nil, episode(1, 2), 1},
		{"a Series N folder", files("Show/Series 3/01.mkv:10", "Show/Series 3/02.mkv:10"), nil, episode(3, 2), 1},
		{"an SNN folder", files("Show/S02/01.mkv:10", "Show/S02/02.mkv:10"), nil, episode(2, 2), 1},
		{"a season folder with a tag after it", files("Show.S01.1080p/01.mkv:10", "Show.S01.1080p/02.mkv:10"), nil, episode(1, 2), 1},
		{"a leading number without a season folder is not an episode", files("01.mkv:10", "02.mkv:10", "extras.mkv:5"), nil, episode(1, 2), -1},
		{"a resolution is not an episode number", files("Show/Season 1/720p.mkv:50", "Show/Season 1/02.mkv:10"), nil, episode(1, 2), 1},
		{"a season folder of another season does not match", files("Show/Season 2/01.mkv:900", "Show/Season 1/01.mkv:10"), nil, episode(1, 1), 1},
		{"a file's own SxxEyy wins over its folder", files("Show/Season 1/Show.S02E01.mkv:10", "Show/Season 1/Show.S01E01.mkv:5"), nil, episode(1, 1), 1},
		{"absolute numbering does not match", files("Anime - 105.mkv:10", "Anime - 106.mkv:10", "Anime - 107.mkv:10"), nil, episode(2, 5), -1},
		{"a file in an unrelated folder with a leading number does not match", files("Show/Extras/05 - Bloopers.mkv:10", "Show/Extras/06.mkv:10"), nil, episode(1, 5), -1},

		// specials are S00Eyy only.
		{"a special is S00Eyy", files("Show.S00E01.mkv:10", "Show.S00E02.mkv:10", "Show.S01E02.mkv:900"), nil, episode(0, 2), 1},
		{"a special is not a season folder", files("Show/Season 0/01.mkv:10", "Show/Season 0/02.mkv:10"), nil, episode(0, 2), -1},
		{"a special is not NxNN", files("Show 0x01.mkv:10", "Show 0x02.mkv:10"), nil, episode(0, 2), -1},

		// 5. the largest of what matches.
		{"the largest matching file", files("Show.S01E03.720p.mkv:100", "Show.S01E03.1080p.mkv:900", "Show.S01E04.mkv:9000"), nil, episode(1, 3), 1},
		{"the first of equal largest wins", files("a.mkv:500", "b.mkv:500", "c.mkv:20"), nil, Hints{}, 0},
		{"no hints is the largest video", files("a.mkv:10", "b.mkv:500", "c.mkv:20"), nil, Hints{}, 1},
		{"a film with a season but no episode is the largest", files("a.mkv:10", "b.mkv:500"), nil, Hints{Season: ptr(1)}, 1},
		{"a single video plays whatever the episode", files("Movie.mkv:10", "readme.txt:900"), nil, episode(1, 5), 0},
		{"a single file", files("only.mkv:42"), nil, Hints{}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := chooseFile(c.files, c.fileIdx, c.hints)
			if c.want < 0 {
				if err == nil {
					t.Fatalf("chooseFile = %d, want a failure", got)
				}
				return
			}
			if err != nil || got != c.want {
				t.Fatalf("chooseFile = %d, %v; want %d", got, err, c.want)
			}
		})
	}
}

func TestChooseFileFailsWithASentence(t *testing.T) {
	cases := []struct {
		name  string
		files []torrentFile
		hints Hints
		want  string
	}{
		{"no files", nil, Hints{}, "This torrent holds no video."},
		{"no video at all", files("a.txt:10", "b.nfo:20", "c.iso:30"), Hints{}, "This torrent holds no video."},
		{"no video at all, for an episode", files("a.txt:10"), episode(1, 3), "This torrent holds no video."},
		{"an episode missing among several videos", files("Show.S01E01.mkv:10", "Show.S01E02.mkv:10"), episode(1, 3), "This torrent holds 2 videos and none is S01E03."},
		{"a special missing among several videos", files("Show.S01E01.mkv:10", "Show.S01E02.mkv:10", "x.nfo:1"), episode(0, 4), "This torrent holds 2 videos and none is S00E04."},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := chooseFile(c.files, nil, c.hints)
			if err == nil || err.Error() != c.want {
				t.Fatalf("chooseFile error = %v; want %q", err, c.want)
			}
		})
	}
}
