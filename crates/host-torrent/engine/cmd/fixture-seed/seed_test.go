// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/storage"
	"github.com/anacrolix/torrent/types/infohash"
)

func TestTrackerAnnounceReturnsCompactPeerForKnownInfoHash(t *testing.T) {
	tr := newTracker(func() int { return 51413 })
	var known [20]byte
	for i := range known {
		known[i] = byte(i + 1)
	}
	tr.Register(known)

	req := httptest.NewRequest(http.MethodGet, "/announce?info_hash="+url.QueryEscape(string(known[:]))+"&compact=1", nil)
	rec := httptest.NewRecorder()
	tr.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%q", rec.Code, rec.Body.String())
	}
	var resp struct {
		Interval   int    `bencode:"interval"`
		Complete   int    `bencode:"complete"`
		Incomplete int    `bencode:"incomplete"`
		Peers      string `bencode:"peers"`
	}
	if err := bencode.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bencode unmarshal: %v", err)
	}
	if resp.Interval <= 0 {
		t.Fatalf("interval = %d, want > 0", resp.Interval)
	}
	if resp.Complete != 1 {
		t.Fatalf("complete = %d, want 1", resp.Complete)
	}
	if len(resp.Peers) != 6 {
		t.Fatalf("compact peers len = %d, want 6", len(resp.Peers))
	}
	ip := []byte(resp.Peers[:4])
	if ip[0] != 127 || ip[1] != 0 || ip[2] != 0 || ip[3] != 1 {
		t.Fatalf("peer ip = %v, want [127 0 0 1]", ip)
	}
	port := binary.BigEndian.Uint16([]byte(resp.Peers[4:6]))
	if port != 51413 {
		t.Fatalf("peer port = %d, want 51413", port)
	}
}

func TestTrackerAnnounceReturnsEmptyPeersForUnknownInfoHash(t *testing.T) {
	tr := newTracker(func() int { return 51413 })
	var unknown [20]byte
	unknown[0] = 0xab

	req := httptest.NewRequest(http.MethodGet, "/announce?info_hash="+url.QueryEscape(string(unknown[:]))+"&compact=1", nil)
	rec := httptest.NewRecorder()
	tr.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Complete int    `bencode:"complete"`
		Peers    string `bencode:"peers"`
	}
	if err := bencode.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bencode unmarshal: %v", err)
	}
	if resp.Complete != 0 || resp.Peers != "" {
		t.Fatalf("got complete=%d peers=%q, want 0 and empty", resp.Complete, resp.Peers)
	}
}

func TestTrackerAnnounceSupportsNonCompactPeersAndRejectsBadHash(t *testing.T) {
	tr := newTracker(func() int { return 42424 })
	var known [20]byte
	known[19] = 0x7f
	tr.Register(known)

	req := httptest.NewRequest(http.MethodGet, "/announce?info_hash="+url.QueryEscape(string(known[:]))+"&compact=0", nil)
	rec := httptest.NewRecorder()
	tr.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var resp struct {
		Peers []struct {
			IP   string `bencode:"ip"`
			Port int    `bencode:"port"`
		} `bencode:"peers"`
	}
	if err := bencode.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bencode unmarshal: %v", err)
	}
	if len(resp.Peers) != 1 || resp.Peers[0].IP != "127.0.0.1" || resp.Peers[0].Port != 42424 {
		t.Fatalf("peers = %+v, want [{127.0.0.1 42424}]", resp.Peers)
	}

	bad := httptest.NewRequest(http.MethodGet, "/announce?info_hash=short", nil)
	badRec := httptest.NewRecorder()
	tr.ServeHTTP(badRec, bad)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad info_hash status = %d, want 400", badRec.Code)
	}
}

func writeFixtureVideo(t *testing.T, name string, size int) (string, []byte) {
	t.Helper()
	data := make([]byte, size)
	rand.New(rand.NewSource(347)).Read(data)
	videoPath := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(videoPath, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return videoPath, data
}

func TestSeederPrintsTwoDistinctJSONLinesWithLoopbackTracker(t *testing.T) {
	videoPath, _ := writeFixtureVideo(t, "verify-controls.mkv", 192<<10)

	seeder, err := Start(Config{VideoPath: videoPath, Log: io.Discard})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer seeder.Close()

	var buf bytes.Buffer
	if err := seeder.WriteJSONLines(&buf); err != nil {
		t.Fatalf("WriteJSONLines: %v", err)
	}

	hexHash := regexp.MustCompile(`^[0-9a-f]{40}$`)
	trackerRe := regexp.MustCompile(`^http://127\.0\.0\.1:\d+/announce$`)

	var records []Record
	sc := bufio.NewScanner(&buf)
	for sc.Scan() {
		var rec Record
		if err := json.Unmarshal(sc.Bytes(), &rec); err != nil {
			t.Fatalf("line is not JSON: %q: %v", sc.Text(), err)
		}
		records = append(records, rec)
	}
	if len(records) != 2 {
		t.Fatalf("got %d JSON lines, want 2: %s", len(records), buf.String())
	}

	byKind := map[string]Record{}
	for _, r := range records {
		if !hexHash.MatchString(r.InfoHash) {
			t.Fatalf("record %s infoHash %q is not 40-char lowercase hex", r.Kind, r.InfoHash)
		}
		if !trackerRe.MatchString(r.Tracker) {
			t.Fatalf("record %s tracker %q is not a loopback /announce URL", r.Kind, r.Tracker)
		}
		byKind[r.Kind] = r
	}
	film, okFilm := byKind["film"]
	pack, okPack := byKind["pack"]
	if !okFilm || !okPack {
		t.Fatalf("expected kinds film and pack, got %+v", records)
	}
	if film.InfoHash == pack.InfoHash {
		t.Fatalf("film and pack must have distinct infoHashes, both were %s", film.InfoHash)
	}
	if film.Tracker != pack.Tracker {
		t.Fatalf("film tracker %q != pack tracker %q", film.Tracker, pack.Tracker)
	}
	if len(film.Files) != 1 || !strings.HasSuffix(film.Files[0], ".mkv") {
		t.Fatalf("film files = %v, want 1 .mkv file", film.Files)
	}
	if len(pack.Files) != 2 {
		t.Fatalf("pack files = %v, want 2 files", pack.Files)
	}
	joined := strings.Join(pack.Files, "\n")
	if !strings.Contains(joined, "S01E01") || !strings.Contains(joined, "S01E02") {
		t.Fatalf("pack files %v do not name S01E01 and S01E02", pack.Files)
	}
}

func TestPeerDiscoversAndDownloadsFilmAndSeasonPackThroughTracker(t *testing.T) {
	videoPath, wantBytes := writeFixtureVideo(t, "verify-controls.mkv", 192<<10)

	seeder, err := Start(Config{VideoPath: videoPath, Log: io.Discard})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	defer seeder.Close()

	var film, pack Record
	for _, r := range seeder.Records() {
		switch r.Kind {
		case "film":
			film = r
		case "pack":
			pack = r
		}
	}

	// A separate client with trackers enabled and NO AddClientPeer shortcut:
	// it can only find the seeder through fixture-seed's HTTP tracker.
	cc := torrent.NewDefaultClientConfig()
	cc.NoDHT = true
	cc.NoDefaultPortForwarding = true
	cc.DisableIPv6 = true
	cc.ListenHost = torrent.LoopbackListenHost
	cc.ListenPort = 0
	cc.Seed = false
	cc.DefaultStorage = storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   t.TempDir(),
		PieceCompletion: storage.NewMapPieceCompletion(),
	})
	leecher, err := torrent.NewClient(cc)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	defer leecher.Close()

	downloadAll := func(rec Record, wantFiles int) map[string][]byte {
		tor, _ := leecher.AddTorrentOpt(torrent.AddTorrentOpts{
			InfoHash: infohash.FromHexString(rec.InfoHash),
		})
		defer tor.Drop()
		tor.AddTrackers([][]string{{rec.Tracker}})

		select {
		case <-tor.GotInfo():
		case <-time.After(15 * time.Second):
			t.Fatalf("%s (%s): never got metadata from tracker %s", rec.Kind, rec.InfoHash, rec.Tracker)
		}
		files := tor.Files()
		if len(files) != wantFiles {
			t.Fatalf("%s: got %d files, want %d", rec.Kind, len(files), wantFiles)
		}
		got := map[string][]byte{}
		for _, f := range files {
			rd := f.NewReader()
			b, err := io.ReadAll(rd)
			_ = rd.Close()
			if err != nil {
				t.Fatalf("%s (%s): read: %v", rec.Kind, f.DisplayPath(), err)
			}
			got[f.DisplayPath()] = b
		}
		return got
	}

	filmFiles := downloadAll(film, 1)
	for name, b := range filmFiles {
		if !bytes.Equal(b, wantBytes) {
			t.Fatalf("film file %s bytes mismatch (%d vs %d)", name, len(b), len(wantBytes))
		}
	}

	packFiles := downloadAll(pack, 2)
	var sawE1, sawE2 bool
	for name, b := range packFiles {
		if !bytes.Equal(b, wantBytes) {
			t.Fatalf("pack file %s bytes mismatch (%d vs %d)", name, len(b), len(wantBytes))
		}
		if strings.Contains(name, "S01E01") {
			sawE1 = true
		}
		if strings.Contains(name, "S01E02") {
			sawE2 = true
		}
	}
	if !sawE1 || !sawE2 {
		t.Fatalf("pack files missing S01E01 or S01E02: %v", packFiles)
	}
}

func TestSeederRejectsMissingVideoFile(t *testing.T) {
	_, err := Start(Config{VideoPath: filepath.Join(t.TempDir(), "missing.mkv"), Log: io.Discard})
	if err == nil {
		t.Fatal("expected an error for a missing video file")
	}
}

func TestSeederCloseCleansUpTempDirAndIsIdempotent(t *testing.T) {
	videoPath, _ := writeFixtureVideo(t, "verify-controls.mkv", 64<<10)
	seeder, err := Start(Config{VideoPath: videoPath, Log: io.Discard})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	dir := seeder.workDir
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("workDir %q should exist while running: %v", dir, err)
	}
	if err := seeder.Close(); err != nil {
		t.Fatalf("first Close: %v", err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("workDir %q should be removed after Close, stat err = %v", dir, err)
	}
	if err := seeder.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}
