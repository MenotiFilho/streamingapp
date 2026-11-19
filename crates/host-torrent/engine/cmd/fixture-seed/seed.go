// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

const (
	packFolderName = "A.Series.From.A.Torrent.S01"
	packFilePrefix = "A.Series.From.A.Torrent."
	verifyTimeout  = 30 * time.Second
)

// Config configures a local walkthrough Seeder.
type Config struct {
	// VideoPath is the fixture video to seed as a single-file film and as a
	// two-file season pack (S01E01 and S01E02).
	VideoPath string
	// WorkDir holds the staged copies/hardlinks for the two torrents. When
	// empty, a temporary directory is created and removed on Close.
	WorkDir string
	// Log receives client warnings. Defaults to io.Discard.
	Log io.Writer
}

// Record is one JSON line fixture-seed prints to stdout once both torrents are
// verified and seeding.
type Record struct {
	Kind     string   `json:"kind"`
	InfoHash string   `json:"infoHash"`
	Tracker  string   `json:"tracker"`
	Files    []string `json:"files"`
}

// Seeder seeds the fixture film and two-file season pack on 127.0.0.1 and
// serves their loopback HTTP tracker.
type Seeder struct {
	client   *torrent.Client
	ln       net.Listener
	srv      *http.Server
	workDir  string
	ownedDir bool
	records  []Record

	closeOnce sync.Once
}

// Start builds the film and season-pack torrents from cfg.VideoPath, verifies
// both on a loopback-only seeder, and starts the built-in HTTP tracker.
func Start(cfg Config) (*Seeder, error) {
	if cfg.VideoPath == "" {
		return nil, errors.New("video path is required")
	}
	stat, err := os.Stat(cfg.VideoPath)
	if err != nil {
		return nil, fmt.Errorf("stat video: %w", err)
	}
	if stat.IsDir() {
		return nil, fmt.Errorf("video path %q is a directory", cfg.VideoPath)
	}
	if cfg.Log == nil {
		cfg.Log = io.Discard
	}

	workDir := cfg.WorkDir
	ownedDir := false
	if workDir == "" {
		workDir, err = os.MkdirTemp("", "streamingapp-fixture-seed-*")
		if err != nil {
			return nil, fmt.Errorf("create work dir: %w", err)
		}
		ownedDir = true
	} else if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, fmt.Errorf("create work dir: %w", err)
	}

	cleanupDir := func() {
		if ownedDir {
			_ = os.RemoveAll(workDir)
		}
	}

	baseName := filepath.Base(cfg.VideoPath)
	ext := filepath.Ext(baseName)
	if ext == "" {
		ext = ".mkv"
	}

	filmPath := filepath.Join(workDir, baseName)
	if err := linkOrCopy(cfg.VideoPath, filmPath); err != nil {
		cleanupDir()
		return nil, fmt.Errorf("stage film: %w", err)
	}

	packDir := filepath.Join(workDir, packFolderName)
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		cleanupDir()
		return nil, fmt.Errorf("create pack dir: %w", err)
	}
	for _, ep := range []string{"S01E01", "S01E02"} {
		dst := filepath.Join(packDir, packFilePrefix+ep+ext)
		if err := linkOrCopy(cfg.VideoPath, dst); err != nil {
			cleanupDir()
			return nil, fmt.Errorf("stage pack %s: %w", ep, err)
		}
	}

	pieceLen := int64(64 << 10)
	if stat.Size() >= 8<<20 {
		pieceLen = 256 << 10
	}

	filmMI, err := buildMetaInfo(filmPath, pieceLen)
	if err != nil {
		cleanupDir()
		return nil, fmt.Errorf("build film metainfo: %w", err)
	}
	packMI, err := buildMetaInfo(packDir, pieceLen)
	if err != nil {
		cleanupDir()
		return nil, fmt.Errorf("build pack metainfo: %w", err)
	}

	cc := torrent.NewDefaultClientConfig()
	cc.Seed = true
	cc.NoDHT = true
	cc.DisableTrackers = true
	cc.NoDefaultPortForwarding = true
	cc.DisableIPv6 = true
	cc.ListenHost = torrent.LoopbackListenHost
	cc.ListenPort = 0
	cc.DefaultStorage = storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   workDir,
		PieceCompletion: storage.NewMapPieceCompletion(),
	})
	cc.Slogger = slog.New(slog.NewTextHandler(cfg.Log, &slog.HandlerOptions{Level: slog.LevelWarn}))

	client, err := torrent.NewClient(cc)
	if err != nil {
		cleanupDir()
		return nil, fmt.Errorf("start seeder client: %w", err)
	}

	filmTor, err := addAndVerify(client, filmMI)
	if err != nil {
		client.Close()
		cleanupDir()
		return nil, fmt.Errorf("seed film: %w", err)
	}
	packTor, err := addAndVerify(client, packMI)
	if err != nil {
		client.Close()
		cleanupDir()
		return nil, fmt.Errorf("seed pack: %w", err)
	}

	tr := newTracker(client.LocalPort)
	tr.Register(filmMI.HashInfoBytes())
	tr.Register(packMI.HashInfoBytes())

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		cleanupDir()
		return nil, fmt.Errorf("listen tracker: %w", err)
	}
	srv := &http.Server{Handler: tr}
	go func() {
		_ = srv.Serve(ln)
	}()

	trackerURL := fmt.Sprintf("http://%s/announce", ln.Addr())
	records := []Record{
		{
			Kind:     "film",
			InfoHash: filmMI.HashInfoBytes().HexString(),
			Tracker:  trackerURL,
			Files:    filePaths(filmTor),
		},
		{
			Kind:     "pack",
			InfoHash: packMI.HashInfoBytes().HexString(),
			Tracker:  trackerURL,
			Files:    filePaths(packTor),
		},
	}

	return &Seeder{
		client:   client,
		ln:       ln,
		srv:      srv,
		workDir:  workDir,
		ownedDir: ownedDir,
		records:  records,
	}, nil
}

// Records returns a copy of the seeded torrents' records.
func (s *Seeder) Records() []Record {
	out := make([]Record, len(s.records))
	copy(out, s.records)
	return out
}

// WriteJSONLines writes one JSON line per seeded torrent to w.
func (s *Seeder) WriteJSONLines(w io.Writer) error {
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	for _, r := range s.records {
		if err := enc.Encode(r); err != nil {
			return err
		}
	}
	return nil
}

// Close shuts down the HTTP tracker, stops seeding, and removes the temporary
// work directory if Start created it. Safe to call more than once.
func (s *Seeder) Close() error {
	var firstErr error
	s.closeOnce.Do(func() {
		if err := s.srv.Close(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			firstErr = err
		}
		s.client.Close()
		if s.ownedDir {
			if err := os.RemoveAll(s.workDir); err != nil && firstErr == nil {
				firstErr = err
			}
		}
	})
	return firstErr
}

func buildMetaInfo(path string, pieceLen int64) (*metainfo.MetaInfo, error) {
	info := metainfo.Info{PieceLength: pieceLen}
	if err := info.BuildFromFilePath(path); err != nil {
		return nil, err
	}
	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		return nil, err
	}
	return &metainfo.MetaInfo{InfoBytes: infoBytes}, nil
}

func addAndVerify(client *torrent.Client, mi *metainfo.MetaInfo) (*torrent.Torrent, error) {
	tor, err := client.AddTorrent(mi)
	if err != nil {
		return nil, err
	}
	select {
	case <-tor.Complete().On():
		return tor, nil
	case <-time.After(verifyTimeout):
		return nil, errors.New("timed out verifying seeded data")
	}
}

func filePaths(tor *torrent.Torrent) []string {
	files := tor.Files()
	paths := make([]string, 0, len(files))
	for _, f := range files {
		paths = append(paths, filepath.ToSlash(f.DisplayPath()))
	}
	return paths
}

func linkOrCopy(src, dst string) error {
	if err := os.Link(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		_ = out.Close()
		return err
	}
	return out.Close()
}
