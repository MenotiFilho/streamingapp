// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"encoding/binary"
	"net/http"
	"sync"

	"github.com/anacrolix/torrent/bencode"
)

// tracker is the loopback HTTP tracker fixture-seed serves alongside its
// seeder, so the Host's Torrent engine can find the local seed through the
// ordinary `sources: ["tracker:http://127.0.0.1:<port>/announce"]` path
// without reaching the public internet.
type tracker struct {
	seederPort func() int

	mu    sync.RWMutex
	known map[[20]byte]struct{}
}

func newTracker(seederPort func() int) *tracker {
	return &tracker{
		seederPort: seederPort,
		known:      map[[20]byte]struct{}{},
	}
}

func (t *tracker) Register(hash [20]byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.known[hash] = struct{}{}
}

func (t *tracker) has(hash [20]byte) bool {
	t.mu.RLock()
	defer t.mu.RUnlock()
	_, ok := t.known[hash]
	return ok
}

func (t *tracker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/announce" {
		http.NotFound(w, r)
		return
	}
	rawHash := r.URL.Query().Get("info_hash")
	if len(rawHash) != 20 {
		http.Error(w, "invalid info_hash", http.StatusBadRequest)
		return
	}
	var hash [20]byte
	copy(hash[:], rawHash)

	compact := r.URL.Query().Get("compact") != "0"
	known := t.has(hash)

	complete := 0
	if known {
		complete = 1
	}

	var payload any
	if compact {
		peers := ""
		if known {
			var entry [6]byte
			entry[0], entry[1], entry[2], entry[3] = 127, 0, 0, 1
			binary.BigEndian.PutUint16(entry[4:6], uint16(t.seederPort()))
			peers = string(entry[:])
		}
		payload = map[string]any{
			"interval":   60,
			"complete":   complete,
			"incomplete": 0,
			"peers":      peers,
		}
	} else {
		peers := []map[string]any{}
		if known {
			peers = append(peers, map[string]any{
				"ip":   "127.0.0.1",
				"port": t.seederPort(),
			})
		}
		payload = map[string]any{
			"interval":   60,
			"complete":   complete,
			"incomplete": 0,
			"peers":      peers,
		}
	}

	body, err := bencode.Marshal(payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/plain")
	_, _ = w.Write(body)
}
