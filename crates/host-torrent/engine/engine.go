// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/storage"
	"github.com/anacrolix/torrent/types/infohash"
)

// Config is what an Engine is made from.
type Config struct {
	// TorrentsDir holds one directory per held torrent, bounded by the Torrent cache, named by its
	// infoHash. The Host owns it: it wipes it at its own startup.
	TorrentsDir string
	// StatusEvery is the gap between one torrent's status events. A second, as
	// the spec says; tests shorten it.
	StatusEvery time.Duration
	// Log receives the engine's own lines and the swarm client's warnings. The
	// Host reads the engine's stderr into its log.
	Log io.Writer
	// Tweak adjusts the swarm client's configuration. Tests use it to keep a
	// torrent on loopback; the real engine leaves it nil.
	Tweak func(*torrent.ClientConfig)
}

// Engine joins swarms and serves what it fetches over a tokened loopback URL.
type Engine struct {
	cfg    Config
	out    *Emitter
	log    *log.Logger
	client *torrent.Client
	ln     net.Listener
	srv    *http.Server
	token  string

	// Stored from the Host's `limits` op and applied live to every held torrent:
	// the cache is the disk ceiling, the read-ahead is clamped by it
	// (effectiveReadahead).
	readahead atomic.Int64
	cache     atomic.Int64

	mu     sync.Mutex
	held   map[string]*held
	closed bool
}

// held is one torrent the engine is fetching and serving.
type held struct {
	hash string
	t    *torrent.Torrent
	dir  string
	disk *boundedDisk
	// readers are the HTTP reads in flight, where the cache counts "behind" from.
	readers *readerSet
	done    chan struct{}
	// failure makes sure a torrent says its storage failed once.
	failure sync.Once

	mu     sync.Mutex
	serves map[int64]*serveEntry
}

// serveEntry is one `serve`: which file of the torrent its URL plays. The file
// is chosen once, after metadata, behind the URL that was already given out.
type serveEntry struct {
	op   ServeOp
	once sync.Once
	file *torrent.File
	err  error
}

// NewEngine opens the swarm client and the loopback listener. It does not read
// stdin; Run does.
func NewEngine(cfg Config, out *Emitter) (*Engine, error) {
	if cfg.TorrentsDir == "" {
		return nil, errors.New("no torrents directory")
	}
	if cfg.StatusEvery <= 0 {
		cfg.StatusEvery = time.Second
	}
	if cfg.Log == nil {
		cfg.Log = io.Discard
	}
	if err := os.MkdirAll(cfg.TorrentsDir, 0o755); err != nil {
		return nil, fmt.Errorf("creating the torrents directory: %w", err)
	}

	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return nil, fmt.Errorf("making the token: %w", err)
	}

	e := &Engine{
		cfg:   cfg,
		out:   out,
		log:   log.New(cfg.Log, "engine: ", 0),
		token: hex.EncodeToString(raw[:]),
		held:  map[string]*held{},
	}

	cc := torrent.NewDefaultClientConfig()
	// Peers: TCP and uTP on an ephemeral wildcard port, with the defaults that
	// bring DHT, PEX, trackers and UPnP/NAT-PMP. Nothing is seeded and there is
	// no upload limit; what a torrent uploads, it uploads while it is held.
	cc.ListenPort = 0
	cc.Seed = false
	// Every torrent brings its own bounded storage (join); this default is only
	// what the client wants to hold, and nothing is ever written through it.
	cc.DefaultStorage = storage.NewFileOpts(storage.NewFileClientOpts{
		ClientBaseDir:   cfg.TorrentsDir,
		PieceCompletion: storage.NewMapPieceCompletion(),
	})
	cc.Slogger = slog.New(slog.NewTextHandler(cfg.Log, &slog.HandlerOptions{Level: slog.LevelWarn}))
	if cfg.Tweak != nil {
		cfg.Tweak(cc)
	}
	client, err := torrent.NewClient(cc)
	if err != nil {
		return nil, fmt.Errorf("starting the swarm client: %w", err)
	}
	e.client = client

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("listening on loopback: %w", err)
	}
	e.ln = ln
	e.srv = &http.Server{Handler: http.HandlerFunc(e.handleHTTP)}
	go func() {
		if err := e.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			e.log.Printf("http: %v", err)
		}
	}()
	return e, nil
}

// Run says `ready`, then handles the Host's lines until stdin closes. Closing
// stdin is how a Host that exits, crashes or is killed tells the engine to go:
// everything is removed and Run returns.
func (e *Engine) Run(in io.Reader) error {
	defer e.Shutdown()
	if err := e.out.Send(ReadyEvent()); err != nil {
		return err
	}
	r := bufio.NewReaderSize(in, 64<<10)
	for {
		line, err := r.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			e.handleLine(line)
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}

func (e *Engine) handleLine(line []byte) {
	op, err := DecodeOp(line)
	if err != nil {
		e.log.Printf("ignoring a line: %v", err)
		return
	}
	switch op := op.(type) {
	case LimitsOp:
		e.SetLimits(op)
	case ServeOp:
		e.Serve(op)
	case LetGoOp:
		e.LetGo(op.InfoHash)
	}
}

// SetLimits stores the Host's limits and applies them to every held torrent at
// once: the open readers read ahead by the new amount and what is on disk is
// trimmed to the new ceiling.
func (e *Engine) SetLimits(op LimitsOp) {
	e.readahead.Store(op.Readahead)
	e.cache.Store(op.Cache)

	e.mu.Lock()
	all := make([]*held, 0, len(e.held))
	for _, h := range e.held {
		all = append(all, h)
	}
	e.mu.Unlock()
	ahead := e.effectiveReadahead()
	for _, h := range all {
		h.readers.setReadahead(ahead)
		h.disk.Trim()
	}
}

// defaultReadahead is how far a torrent is read ahead before the Host has said:
// the least it is ever asked for.
const defaultReadahead = 16 << 20

// effectiveReadahead is the read-ahead in force: the Host's, clamped to three
// quarters of the cache.
func (e *Engine) effectiveReadahead() int64 {
	ahead := e.readahead.Load()
	if ahead <= 0 {
		ahead = defaultReadahead
	}
	return clampReadahead(ahead, e.cache.Load())
}

// Addr is the loopback address the engine serves on.
func (e *Engine) Addr() net.Addr { return e.ln.Addr() }

// Serve joins the torrent and answers with its URL at once, before metadata.
func (e *Engine) Serve(op ServeOp) {
	hash, ok := NormaliseInfoHash(op.InfoHash)
	if !ok {
		e.refuse(op.ID, "That is not a torrent this engine can join.")
		return
	}

	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		e.refuse(op.ID, "The torrent engine is shutting down.")
		return
	}
	h := e.held[hash]
	if h == nil {
		var err error
		if h, err = e.join(hash); err != nil {
			e.mu.Unlock()
			e.log.Printf("joining %s: %v", hash, err)
			e.refuse(op.ID, "The torrent could not be joined: "+err.Error())
			return
		}
		e.held[hash] = h
		go e.reportStatus(h)
	}
	e.mu.Unlock()

	if trackers := TrackersOf(op.Sources); len(trackers) > 0 {
		h.t.AddTrackers([][]string{trackers})
	}
	entry := &serveEntry{op: op}
	h.mu.Lock()
	h.serves[op.ID] = entry
	h.mu.Unlock()

	url := fmt.Sprintf("http://%s/%s/%s/%d", e.ln.Addr(), e.token, hash, op.ID)
	if err := e.out.Send(ServedEvent(op.ID, url)); err != nil {
		e.log.Printf("telling the Host: %v", err)
	}
	go e.chooseOnceReady(h, entry)
}

// chooseOnceReady picks the serve's file as soon as metadata arrives, without
// waiting for an HTTP read, so a caller that only wants metadata (like
// live_check) receives `chosen` or `failed` without fetching any video bytes.
func (e *Engine) chooseOnceReady(h *held, entry *serveEntry) {
	select {
	case <-h.t.GotInfo():
	case <-h.done:
		return
	}
	select {
	case <-h.done:
		return
	default:
	}
	entry.once.Do(func() { e.choose(h, entry) })
}

func (e *Engine) refuse(id int64, sentence string) {
	if err := e.out.Send(RefusedEvent(id, sentence)); err != nil {
		e.log.Printf("telling the Host: %v", err)
	}
}

// join adds a torrent, kept in a bounded directory of its own.
func (e *Engine) join(hash string) (*held, error) {
	dir := filepath.Join(e.cfg.TorrentsDir, hash)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	h := &held{
		hash:    hash,
		dir:     dir,
		readers: newReaderSet(),
		done:    make(chan struct{}),
		serves:  map[int64]*serveEntry{},
	}
	h.disk = newBoundedDisk(dir, e.cache.Load, h.readers.piece, func(err error) { e.storageFailed(h, err) })
	h.t, _ = e.client.AddTorrentOpt(torrent.AddTorrentOpts{
		InfoHash: infohash.FromHexString(hash),
		Storage:  h.disk,
	})
	h.disk.setRecheck(func(piece int) { h.t.Piece(piece).UpdateCompletion() })
	return h, nil
}

// storageFailed says, once for the torrent, that it could not be kept on disk,
// and stops it fetching: a write that failed once will fail again, and the Host
// ends the Stream and lets the torrent go (ADR-0042 §3, §5). It is called from
// inside the swarm client's own calls, so what it does that takes the client's
// lock or the pipe's happens on a goroutine of its own.
func (e *Engine) storageFailed(h *held, err error) {
	h.failure.Do(func() {
		e.log.Printf("storage of %s: %v", h.hash, err)
		go func() {
			h.t.DisallowDataDownload()
			if err := e.out.Send(FailedEvent(h.hash, FailStorage, storageSentence(err))); err != nil {
				e.log.Printf("telling the Host: %v", err)
			}
		}()
	})
}

// LetGo drops a torrent: it stops fetching and uploading, and its directory is
// removed once the storage has closed.
func (e *Engine) LetGo(infoHash string) {
	hash, ok := NormaliseInfoHash(infoHash)
	if !ok {
		e.log.Printf("let_go of %q: not an infoHash", infoHash)
		return
	}
	e.mu.Lock()
	h := e.held[hash]
	delete(e.held, hash)
	e.mu.Unlock()
	if h != nil {
		e.release(h)
	}
}

func (e *Engine) release(h *held) {
	close(h.done)
	h.t.Drop() // waits for the storage to close
	h.disk.Close()
	if err := os.RemoveAll(h.dir); err != nil {
		e.log.Printf("removing %s: %v", h.dir, err)
	}
}

// Shutdown drops everything, removes every directory the engine holds and
// closes the listener and the swarm client. It is safe to call twice.
func (e *Engine) Shutdown() {
	e.mu.Lock()
	if e.closed {
		e.mu.Unlock()
		return
	}
	e.closed = true
	all := make([]*held, 0, len(e.held))
	for _, h := range e.held {
		all = append(all, h)
	}
	e.held = map[string]*held{}
	e.mu.Unlock()

	e.srv.Close()
	for _, h := range all {
		e.release(h)
	}
	e.client.Close()
}

func (e *Engine) heldFor(hash string) *held {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.held[hash]
}

// reportStatus sends the torrent's status, the first one at once and then one
// every StatusEvery, until the torrent is let go. `finding` lasts until
// metadata arrives; `fetching` is the rest of its life.
func (e *Engine) reportStatus(h *held) {
	tick := time.NewTicker(e.cfg.StatusEvery)
	defer tick.Stop()
	last := time.Now()
	lastBytes := usefulBytes(h.t)
	for first := true; ; first = false {
		if !first {
			select {
			case <-h.done:
				return
			case <-tick.C:
			}
		}
		select {
		case <-h.done:
			return
		default:
		}
		stats := h.t.Stats()
		now := time.Now()
		got := usefulBytes(h.t)
		var rate int64
		if elapsed := now.Sub(last).Seconds(); elapsed > 0 {
			rate = int64(float64(got-lastBytes) / elapsed)
		}
		last, lastBytes = now, got

		phase := PhaseFinding
		if h.t.Info() != nil {
			phase = PhaseFetching
		}
		if err := e.out.Send(StatusEvent(h.hash, phase, stats.ActivePeers, rate)); err != nil {
			e.log.Printf("telling the Host: %v", err)
			return
		}
	}
}

// usefulBytes is how many bytes of torrent data have arrived, the sum a rate is
// read from.
func usefulBytes(t *torrent.Torrent) int64 {
	stats := t.Stats()
	return stats.BytesReadUsefulData.Int64()
}
