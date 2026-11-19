// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"errors"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// torrentFile is what the file choice needs of one file: where it sits in the
// torrent (folders included) and how large it is.
type torrentFile struct {
	Path string
	Size int64
}

// videoExtensions are the extensions that make a file something to play
// (ADR-0042 §4). Anything else — subtitles, samples' notes, images, disc images
// — is never chosen.
var videoExtensions = map[string]bool{
	".mkv": true, ".mp4": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true,
	".webm": true, ".m4v": true, ".mpg": true, ".mpeg": true, ".ts": true, ".m2ts": true,
}

func isVideo(name string) bool {
	return videoExtensions[strings.ToLower(path.Ext(name))]
}

var errNoVideo = errors.New("This torrent holds no video.")

// chooseFile picks the file a serve plays, once the torrent's metadata is known
// (ADR-0042 §4). In order:
//
//  1. the `fileIdx`, when it is in range and points at a video;
//  2. the exact `filename` hint, when a video has that name;
//  3. among the videos only,
//  4. for an episode, those whose own name carries `SxxEyy`, `sxey`, `NxNN` or
//     `SxxEyyEzz`, or that sit in a season folder and lead with an episode
//     number; a special (season 0) is matched only as `S00Eyy`; absolute
//     numbering is never matched;
//  5. then the largest of what is left, the first of equals.
//
// An episode that matches no file among several videos is a failure, never the
// largest file: that would play the wrong episode and record Watch progress and
// autoplay against it. A single video is played whatever the episode, and a
// torrent without a video fails. The error's text is the sentence the Host shows.
func chooseFile(files []torrentFile, fileIdx *int, hints Hints) (int, error) {
	if fileIdx != nil && *fileIdx >= 0 && *fileIdx < len(files) && isVideo(files[*fileIdx].Path) {
		return *fileIdx, nil
	}
	if hints.Filename != nil {
		for i, f := range files {
			if isVideo(f.Path) && path.Base(f.Path) == *hints.Filename {
				return i, nil
			}
		}
	}

	var videos []int
	for i, f := range files {
		if isVideo(f.Path) {
			videos = append(videos, i)
		}
	}
	if len(videos) == 0 {
		return 0, errNoVideo
	}

	candidates := videos
	if hints.Season != nil && hints.Episode != nil && len(videos) > 1 {
		candidates = candidates[:0:0]
		for _, i := range videos {
			if matchesEpisode(files[i].Path, *hints.Season, *hints.Episode) {
				candidates = append(candidates, i)
			}
		}
		if len(candidates) == 0 {
			return 0, fmt.Errorf("This torrent holds %d videos and none is S%02dE%02d.",
				len(videos), *hints.Season, *hints.Episode)
		}
	}

	largest := candidates[0]
	for _, i := range candidates[1:] {
		if files[i].Size > files[largest].Size {
			largest = i
		}
	}
	return largest, nil
}

// An episode in a file's own name. Each is anchored by a character that is not a
// letter or digit (or the name's edge), so `S01E031` is not episode 3 and
// `1920x1080` is not an episode at all.
var (
	// SxxEyy, sxey, and SxxEyyEzz: every episode a multi-episode file lists.
	sxeyy = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])s(\d{1,2})[ ._-]?e(\d{1,3})((?:[ ._-]?e\d{1,3})*)(?:[^a-z0-9]|$)`)
	extra = regexp.MustCompile(`(?i)e(\d{1,3})`)
	// NxNN: season, then two or three digits of episode.
	nxnn = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])(\d{1,2})x(\d{2,3})(?:[^a-z0-9]|$)`)
	// A folder that names a season: Season N, Series N, SNN.
	seasonFolder = regexp.MustCompile(`(?i)(?:^|[^a-z0-9])(?:season|series|s)[ ._-]?(\d{1,2})(?:[^a-z0-9]|$)`)
	// A file name that leads with its episode: NN, ENN, Episode N.
	leadingEpisode = regexp.MustCompile(`(?i)^(?:episode[ ._-]?|e)?(\d{1,3})(?:[^a-z0-9]|$)`)
)

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// matchesEpisode says whether the file at `filePath` is `season`'s `episode`.
func matchesEpisode(filePath string, season, episode int) bool {
	dir, name := path.Split(filePath)
	name = strings.TrimSuffix(name, path.Ext(name))

	// The file's own name decides when it says a season and episode: a file that
	// says S02E01 is not season 1's because its folder is.
	named := false
	for _, m := range sxeyy.FindAllStringSubmatch(name, -1) {
		named = true
		if atoi(m[1]) != season {
			continue
		}
		if atoi(m[2]) == episode {
			return true
		}
		for _, e := range extra.FindAllStringSubmatch(m[3], -1) {
			if atoi(e[1]) == episode {
				return true
			}
		}
	}
	// A special is an S00Eyy and nothing else, as no other form tells one from
	// the main run.
	if season == 0 {
		return false
	}
	for _, m := range nxnn.FindAllStringSubmatch(name, -1) {
		named = true
		if atoi(m[1]) == season && atoi(m[2]) == episode {
			return true
		}
	}
	if named {
		return false
	}

	// No season and episode in the name: a season folder and a leading episode.
	if m := leadingEpisode.FindStringSubmatch(name); m != nil && atoi(m[1]) == episode {
		for _, folder := range strings.Split(strings.Trim(dir, "/"), "/") {
			if f := seasonFolder.FindStringSubmatch(folder); f != nil && atoi(f[1]) == season {
				return true
			}
		}
	}
	return false
}
