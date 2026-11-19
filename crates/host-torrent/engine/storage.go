// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"syscall"

	g "github.com/anacrolix/generics"
	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// The Torrent cache (ADR-0042 §3). A torrent is kept as one file per piece in
// the directory of its own, and the pieces furthest behind the reader are
// given up first until what is kept fits the ceiling the Host set. Nothing is
// kept for later: the directory is removed when the torrent is let go.

const (
	// diskFullSentence is what an owner reads when the disk has no room.
	diskFullSentence = "The disk is full, so the torrent could not be kept."
	// unwritableSentence is what an owner reads for any other write failure: a
	// directory that cannot be written, a drive that went away.
	unwritableSentence = "The torrent could not be kept: its directory cannot be written to."
)

// clampReadahead is the read-ahead the engine applies: what the Host asked for,
// and never more than three quarters of what the cache can hold, so the pieces
// being read ahead cannot push out the ones about to be read (ADR-0042 §3). A
// cache of zero is a cache the Host has not set yet, and clamps nothing.
func clampReadahead(readahead, cache int64) int64 {
	if readahead < 0 {
		readahead = 0
	}
	if cache <= 0 {
		return readahead
	}
	if most := cache / 4 * 3; readahead > most {
		return most
	}
	return readahead
}

// keptPiece is what the eviction decision knows of one piece.
type keptPiece struct {
	index    int
	size     int64
	complete bool
}

// evictionPlan says which pieces to give up so that `kept` fits `cache`: the
// complete pieces furthest behind the reader first, then, only if that is not
// enough, the ones furthest ahead of it. The piece the reader is on and any
// piece still being written are never given up. A cache of zero or less is no
// ceiling. Pure: the decision is tested without a disk.
func evictionPlan(pieces []keptPiece, reader int, cache int64) []int {
	if cache <= 0 {
		return nil
	}
	var kept int64
	for _, p := range pieces {
		kept += p.size
	}
	over := kept - cache
	if over <= 0 {
		return nil
	}

	var behind, ahead []keptPiece
	for _, p := range pieces {
		switch {
		case !p.complete || p.index == reader:
		case p.index < reader:
			behind = append(behind, p)
		default:
			ahead = append(ahead, p)
		}
	}
	// Furthest behind is the lowest index; furthest ahead is the highest.
	sort.Slice(behind, func(i, j int) bool { return behind[i].index < behind[j].index })
	sort.Slice(ahead, func(i, j int) bool { return ahead[i].index > ahead[j].index })

	var out []int
	for _, p := range append(behind, ahead...) {
		if over <= 0 {
			break
		}
		out = append(out, p.index)
		over -= p.size
	}
	return out
}

// isDiskFull reads an error for "there is no room": the Unix errno, and the two
// Windows codes for the same thing.
func isDiskFull(err error) bool {
	if errors.Is(err, syscall.ENOSPC) {
		return true
	}
	var errno syscall.Errno
	if runtime.GOOS == "windows" && errors.As(err, &errno) {
		const errorHandleDiskFull, errorDiskFull = 39, 112
		return errno == errorHandleDiskFull || errno == errorDiskFull
	}
	return false
}

// storageSentence is what the Host is told about a storage error.
func storageSentence(err error) string {
	if isDiskFull(err) {
		return diskFullSentence
	}
	return unwritableSentence
}

// boundedDisk is a torrent's storage: the client's `ClientImpl`, made for one
// held torrent. The engine reads what it needs of the reader and the ceiling
// through the funcs it is given, so the limits that arrive live apply at once.
type boundedDisk struct {
	dir string
	// cache is the ceiling in bytes; zero or less is none yet.
	cache func() int64
	// reader is the piece the reader is on, or -1 when nobody reads yet.
	reader func() int
	// failed is told once for every storage error, from whatever goroutine hit it.
	failed func(error)

	mu     sync.Mutex
	pieces []keptEntry
	// recheck tells the swarm client a piece it believed complete is gone.
	recheck func(piece int)
}

type keptEntry struct {
	// size is what the piece holds on disk, counted from its first written byte.
	size     int64
	complete bool
}

func newBoundedDisk(dir string, cache func() int64, reader func() int, failed func(error)) *boundedDisk {
	return &boundedDisk{dir: dir, cache: cache, reader: reader, failed: failed}
}

var _ storage.ClientImplCloser = (*boundedDisk)(nil)

func (d *boundedDisk) path(piece int) string {
	return filepath.Join(d.dir, fmt.Sprintf("%d.piece", piece))
}

// OpenTorrent is where the metadata has arrived and the pieces are known.
func (d *boundedDisk) OpenTorrent(_ context.Context, info *metainfo.Info, _ metainfo.Hash) (storage.TorrentImpl, error) {
	if err := os.MkdirAll(d.dir, 0o755); err != nil {
		d.failed(err)
		return storage.TorrentImpl{}, err
	}
	d.mu.Lock()
	d.pieces = make([]keptEntry, info.NumPieces())
	d.mu.Unlock()
	capacity := func() (int64, bool) {
		c := d.cache()
		return c, c > 0
	}
	return storage.TorrentImpl{
		PieceWithHash: func(p metainfo.Piece, _ g.Option[[]byte]) storage.PieceImpl {
			return &keptPieceImpl{d: d, index: p.Index(), length: p.Length()}
		},
		Close:    func() error { return nil },
		Capacity: &capacity,
	}, nil
}

// setRecheck is how the engine gives the storage the swarm client's way of
// looking at a piece again.
func (d *boundedDisk) setRecheck(f func(piece int)) {
	d.mu.Lock()
	d.recheck = f
	d.mu.Unlock()
}

// Close does nothing: the engine removes the directory itself.
func (d *boundedDisk) Close() error { return nil }

// Held is how many bytes the pieces on disk take.
func (d *boundedDisk) Held() int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.heldLocked()
}

func (d *boundedDisk) heldLocked() int64 {
	var total int64
	for _, e := range d.pieces {
		total += e.size
	}
	return total
}

// Trim gives up pieces until what is kept fits the ceiling now in force. It is
// called when a piece completes, when a new one begins and when a `limits` op
// arrives.
func (d *boundedDisk) Trim() {
	d.mu.Lock()
	reader := d.reader()
	pieces := make([]keptPiece, 0, len(d.pieces))
	for i, e := range d.pieces {
		if e.size > 0 {
			pieces = append(pieces, keptPiece{index: i, size: e.size, complete: e.complete})
		}
	}
	victims := evictionPlan(pieces, reader, d.cache())
	for _, i := range victims {
		if err := os.Remove(d.path(i)); err != nil && !errors.Is(err, os.ErrNotExist) {
			// The piece stays counted: what could not be deleted is still there.
			continue
		}
		d.pieces[i] = keptEntry{}
	}
	recheck := d.recheck
	d.mu.Unlock()

	// The swarm client takes its own lock to look again, and asks this storage
	// while it does, so it is never called holding ours.
	if recheck != nil {
		for _, i := range victims {
			go recheck(i)
		}
	}
}

// keptPieceImpl is one piece's file.
type keptPieceImpl struct {
	d      *boundedDisk
	index  int
	length int64
}

func (p *keptPieceImpl) ReadAt(b []byte, off int64) (int, error) {
	f, err := os.Open(p.d.path(p.index))
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.ReadAt(b, off)
}

func (p *keptPieceImpl) WriteAt(b []byte, off int64) (int, error) {
	f, err := os.OpenFile(p.d.path(p.index), os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		p.d.failed(err)
		return 0, err
	}
	n, err := f.WriteAt(b, off)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		p.d.failed(err)
		return n, err
	}

	p.d.mu.Lock()
	begun := p.d.pieces[p.index].size == 0
	if begun {
		p.d.pieces[p.index].size = p.length
	}
	p.d.mu.Unlock()
	if begun {
		p.d.Trim()
	}
	return n, nil
}

func (p *keptPieceImpl) MarkComplete() error {
	p.d.mu.Lock()
	e := &p.d.pieces[p.index]
	e.complete = true
	if e.size == 0 {
		e.size = p.length
	}
	p.d.mu.Unlock()
	p.d.Trim()
	return nil
}

func (p *keptPieceImpl) MarkNotComplete() error {
	p.d.mu.Lock()
	p.d.pieces[p.index].complete = false
	p.d.mu.Unlock()
	return nil
}

func (p *keptPieceImpl) Completion() storage.Completion {
	p.d.mu.Lock()
	defer p.d.mu.Unlock()
	return storage.Completion{Ok: true, Complete: p.d.pieces[p.index].complete}
}

var _ storage.PieceImpl = (*keptPieceImpl)(nil)

// Reader positions: the pieces the open HTTP reads are on. A piece is "behind
// the reader" when it is behind the least of them, so a second reader taking
// the end of a file for its index cannot turn what the first is about to read
// into "behind".
type readerSet struct {
	mu   sync.Mutex
	at   map[*trackedReader]int
	last int
}

func newReaderSet() *readerSet { return &readerSet{at: map[*trackedReader]int{}, last: -1} }

func (s *readerSet) set(r *trackedReader, piece int) {
	s.mu.Lock()
	s.at[r] = piece
	s.mu.Unlock()
}

func (s *readerSet) remove(r *trackedReader) {
	s.mu.Lock()
	// The last reader to close leaves where the cache counts from.
	if piece, ok := s.at[r]; ok && len(s.at) == 1 {
		s.last = piece
	}
	delete(s.at, r)
	s.mu.Unlock()
}

// piece is the piece to count "behind" from: the least of the open readers',
// or where the last one to close was when none is open.
func (s *readerSet) piece() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	least := -1
	for _, p := range s.at {
		if least < 0 || p < least {
			least = p
		}
	}
	if least < 0 {
		return s.last
	}
	return least
}

// readahead is the one thing of a torrent reader the set reaches.
type readahead interface {
	SetReadahead(int64)
}

// setReadahead tells every open reader how far to read ahead: a `limits` op
// reaches the reads already in flight (ADR-0042 §3).
func (s *readerSet) setReadahead(n int64) {
	s.mu.Lock()
	open := make([]*trackedReader, 0, len(s.at))
	for r := range s.at {
		open = append(open, r)
	}
	s.mu.Unlock()
	for _, r := range open {
		r.ahead.SetReadahead(n)
	}
}

// trackedReader is the file reader an HTTP response reads through, telling the
// reader set where it is after every read and seek.
type trackedReader struct {
	io.ReadSeeker
	ahead    readahead
	set      *readerSet
	base     int64 // the file's offset in the torrent
	pieceLen int64
	pos      int64
}

// newTrackedReader registers a reader with the set, read ahead by `ahead` bytes
// from its first byte.
func newTrackedReader(rs io.ReadSeeker, ra readahead, set *readerSet, base, pieceLen, ahead int64) *trackedReader {
	r := &trackedReader{ReadSeeker: rs, ahead: ra, set: set, base: base, pieceLen: pieceLen}
	ra.SetReadahead(ahead)
	r.moved()
	return r
}

func (r *trackedReader) moved() {
	if r.pieceLen > 0 {
		r.set.set(r, int((r.base+r.pos)/r.pieceLen))
	}
}

func (r *trackedReader) Read(b []byte) (int, error) {
	n, err := r.ReadSeeker.Read(b)
	r.pos += int64(n)
	r.moved()
	return n, err
}

func (r *trackedReader) Seek(off int64, whence int) (int64, error) {
	pos, err := r.ReadSeeker.Seek(off, whence)
	if err == nil {
		r.pos = pos
		r.moved()
	}
	return pos, err
}

func (r *trackedReader) Close() { r.set.remove(r) }
