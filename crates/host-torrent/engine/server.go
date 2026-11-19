// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"crypto/subtle"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// handleHTTP serves a torrent's file on `/<token>/<infoHash>/<serve id>`.
//
// A request without the token gets 403 before anything else is looked at. A
// valid URL is answered even while the torrent has no metadata: the handler
// waits for it (and for the file choice) behind the URL that was already given
// out, then serves the chosen file through http.ServeContent, which does the
// 206 ranges.
func (e *Engine) handleHTTP(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if len(parts) < 1 || subtle.ConstantTimeCompare([]byte(parts[0]), []byte(e.token)) != 1 {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	if len(parts) != 3 {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.ParseInt(parts[2], 10, 64)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	h := e.heldFor(parts[1])
	if h == nil {
		http.NotFound(w, r)
		return
	}
	h.mu.Lock()
	entry := h.serves[id]
	h.mu.Unlock()
	if entry == nil {
		http.NotFound(w, r)
		return
	}

	select {
	case <-h.t.GotInfo():
	case <-h.done:
		http.Error(w, "The torrent was let go.", http.StatusNotFound)
		return
	case <-r.Context().Done():
		return
	}

	entry.once.Do(func() { e.choose(h, entry) })
	if entry.err != nil {
		// The engine's own sentence rides on the 404, so the Host can tell it
		// from a refusal by the swarm.
		http.Error(w, entry.err.Error(), http.StatusNotFound)
		return
	}

	reader := entry.file.NewReader()
	defer reader.Close()
	reader.SetResponsive()
	reader.SetContext(r.Context())

	name := path.Base(entry.file.DisplayPath())
	// A type is named outright: left to itself ServeContent would sniff the
	// first bytes, and that read would wait on the first piece.
	ctype := mime.TypeByExtension(path.Ext(name))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	http.ServeContent(w, r, name, time.Time{}, reader)
}

// choose picks the file this serve plays and says so, once.
func (e *Engine) choose(h *held, entry *serveEntry) {
	files := h.t.Files()
	listed := make([]torrentFile, len(files))
	for i, f := range files {
		listed[i] = torrentFile{Path: f.DisplayPath(), Size: f.Length()}
	}
	idx, err := chooseFile(listed, entry.op.FileIdx, entry.op.Hints)
	if err != nil {
		entry.err = err
		if err := e.out.Send(FailedEvent(h.hash, FailNoFile, entry.err.Error())); err != nil {
			e.log.Printf("telling the Host: %v", err)
		}
		return
	}
	entry.file = files[idx]
	if err := e.out.Send(ChosenEvent(h.hash, idx, path.Base(files[idx].DisplayPath()))); err != nil {
		e.log.Printf("telling the Host: %v", err)
	}
}
