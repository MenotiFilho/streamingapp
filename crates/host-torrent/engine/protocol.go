// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
)

// The stdio protocol: one JSON object per line, in both directions (spec #311,
// "The stdio protocol"). This file is the codec and nothing else, so what the
// Host and the engine say to each other is decided, and tested, apart from any
// swarm.

// Hints are what the Host knows about the file wanted: the Addon's own name for
// it, and the Video's season and episode. The file rule reads them (choose.go).
type Hints struct {
	Filename *string `json:"filename"`
	Season   *int    `json:"season"`
	Episode  *int    `json:"episode"`
}

// LimitsOp tells the engine the read-ahead and the disk ceiling, in bytes.
type LimitsOp struct {
	Readahead int64 `json:"readahead"`
	Cache     int64 `json:"cache"`
}

// ServeOp asks for a torrent's file. It is answered at once, before metadata.
type ServeOp struct {
	ID       int64    `json:"id"`
	InfoHash string   `json:"infoHash"`
	FileIdx  *int     `json:"fileIdx"`
	Sources  []string `json:"sources"`
	Hints    Hints    `json:"hints"`
}

// LetGoOp drops a torrent and deletes its directory.
type LetGoOp struct {
	InfoHash string `json:"infoHash"`
}

// DecodeOp reads one line of the Host's into LimitsOp, ServeOp or LetGoOp. An
// error means the line is not one the engine knows; the caller logs it and goes
// on.
func DecodeOp(line []byte) (any, error) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return nil, errors.New("empty line")
	}
	var head struct {
		Op *string `json:"op"`
	}
	if err := json.Unmarshal(line, &head); err != nil {
		return nil, fmt.Errorf("not a JSON object: %w", err)
	}
	if head.Op == nil {
		return nil, errors.New(`no "op"`)
	}
	switch *head.Op {
	case "limits":
		var op LimitsOp
		if err := json.Unmarshal(line, &op); err != nil {
			return nil, fmt.Errorf("limits: %w", err)
		}
		return op, nil
	case "serve":
		var raw struct {
			ID       *int64   `json:"id"`
			InfoHash string   `json:"infoHash"`
			FileIdx  *int     `json:"fileIdx"`
			Sources  []string `json:"sources"`
			Hints    Hints    `json:"hints"`
		}
		if err := json.Unmarshal(line, &raw); err != nil {
			return nil, fmt.Errorf("serve: %w", err)
		}
		if raw.ID == nil {
			return nil, errors.New(`serve: no "id"`)
		}
		return ServeOp{ID: *raw.ID, InfoHash: raw.InfoHash, FileIdx: raw.FileIdx, Sources: raw.Sources, Hints: raw.Hints}, nil
	case "let_go":
		var op LetGoOp
		if err := json.Unmarshal(line, &op); err != nil {
			return nil, fmt.Errorf("let_go: %w", err)
		}
		if op.InfoHash == "" {
			return nil, errors.New(`let_go: no "infoHash"`)
		}
		return op, nil
	default:
		return nil, fmt.Errorf("unknown op %q", *head.Op)
	}
}

// Phase is what a status says the torrent is doing.
type Phase string

const (
	PhaseFinding  Phase = "finding"
	PhaseFetching Phase = "fetching"
)

// FailKind is what a failed event says went wrong.
type FailKind string

const (
	FailNoFile  FailKind = "no_file"
	FailStorage FailKind = "storage"
	FailOther   FailKind = "other"
)

type event struct {
	Ev string `json:"ev"`
}

type readyEvent struct {
	event
}

type servedEvent struct {
	event
	ID  int64  `json:"id"`
	URL string `json:"url"`
}

type refusedEvent struct {
	event
	ID       int64  `json:"id"`
	Sentence string `json:"sentence"`
}

type statusEvent struct {
	event
	InfoHash string `json:"infoHash"`
	Phase    Phase  `json:"phase"`
	Peers    int    `json:"peers"`
	Rate     int64  `json:"rate"`
}

type chosenEvent struct {
	event
	InfoHash string `json:"infoHash"`
	FileIdx  int    `json:"fileIdx"`
	Name     string `json:"name"`
}

type failedEvent struct {
	event
	InfoHash string   `json:"infoHash"`
	Kind     FailKind `json:"kind"`
	Sentence string   `json:"sentence"`
}

// The engine's events. Each is a value `json.Marshal` writes as the spec spells it.

func ReadyEvent() any { return readyEvent{event{"ready"}} }

func ServedEvent(id int64, url string) any { return servedEvent{event{"served"}, id, url} }

func RefusedEvent(id int64, sentence string) any {
	return refusedEvent{event{"refused"}, id, sentence}
}

func StatusEvent(infoHash string, phase Phase, peers int, rate int64) any {
	return statusEvent{event{"status"}, infoHash, phase, peers, rate}
}

func ChosenEvent(infoHash string, fileIdx int, name string) any {
	return chosenEvent{event{"chosen"}, infoHash, fileIdx, name}
}

func FailedEvent(infoHash string, kind FailKind, sentence string) any {
	return failedEvent{event{"failed"}, infoHash, kind, sentence}
}

// Emitter writes events to the Host, one line each. It is safe to call from
// every goroutine: the status loops and the HTTP handlers share one stdout.
type Emitter struct {
	mu sync.Mutex
	w  io.Writer
}

func NewEmitter(w io.Writer) *Emitter { return &Emitter{w: w} }

func (e *Emitter) Send(ev any) error {
	b, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	e.mu.Lock()
	defer e.mu.Unlock()
	_, err = e.w.Write(b)
	return err
}

// NormaliseInfoHash accepts the 40 hex characters the Host sends, in either
// case, and returns them lowercase.
func NormaliseInfoHash(s string) (string, bool) {
	if len(s) != 40 {
		return "", false
	}
	if _, err := hex.DecodeString(s); err != nil {
		return "", false
	}
	return strings.ToLower(s), true
}

// TrackersOf picks the tracker URLs out of a Stream's sources. A source is
// `tracker:<url>`; a bare announce URL is read as one too. `dht:` sources name
// the torrent's own hash, which the client looks up on the DHT regardless, and
// anything else is ignored.
func TrackersOf(sources []string) []string {
	var out []string
	for _, s := range sources {
		var url string
		switch {
		case strings.HasPrefix(s, "tracker:"):
			url = strings.TrimPrefix(s, "tracker:")
		case strings.HasPrefix(s, "udp://"), strings.HasPrefix(s, "http://"), strings.HasPrefix(s, "https://"):
			url = s
		}
		if url != "" {
			out = append(out, url)
		}
	}
	return out
}
