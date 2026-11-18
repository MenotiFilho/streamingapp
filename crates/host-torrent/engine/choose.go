// SPDX-License-Identifier: GPL-3.0-or-later

package main

// chooseFile is the placeholder file choice: the `fileIdx` when it is in range,
// else the largest file. It takes the files' sizes in torrent order and returns
// the index to play, or false when the torrent holds no files.
//
// The full rule (the filename hint, video extensions, the episode match, and a
// fileIdx trusted only when it points at a video) is a later ticket of spec #311
// and replaces this function; the callers need not change.
func chooseFile(sizes []int64, fileIdx *int) (int, bool) {
	if len(sizes) == 0 {
		return 0, false
	}
	if fileIdx != nil && *fileIdx >= 0 && *fileIdx < len(sizes) {
		return *fileIdx, true
	}
	largest := 0
	for i, n := range sizes {
		if n > sizes[largest] {
			largest = i
		}
	}
	return largest, true
}
