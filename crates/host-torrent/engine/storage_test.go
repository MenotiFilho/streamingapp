// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/anacrolix/torrent/metainfo"
)

// ── The decisions ───────────────────────────────────────────────────────────

func TestReadaheadIsClampedToThreeQuartersOfTheCache(t *testing.T) {
	for _, c := range []struct {
		name                 string
		readahead, cache, in int64
	}{
		{"within the cache", 16 << 20, 2_000_000_000, 16 << 20},
		{"exactly three quarters", 750, 1000, 750},
		{"above three quarters", 900, 1000, 750},
		{"far above", 1 << 40, 64 << 20, 48 << 20},
		{"no cache set yet clamps nothing", 900, 0, 900},
		{"a negative read-ahead is none", -5, 1000, 0},
	} {
		if got := clampReadahead(c.readahead, c.cache); got != c.in {
			t.Errorf("%s: clampReadahead(%d, %d) = %d, want %d", c.name, c.readahead, c.cache, got, c.in)
		}
	}
}

func pieces(sizes ...int64) []keptPiece {
	out := make([]keptPiece, len(sizes))
	for i, s := range sizes {
		out[i] = keptPiece{index: i, size: s, complete: s > 0}
	}
	return out
}

func TestNothingIsEvictedWhileTheTorrentFits(t *testing.T) {
	if got := evictionPlan(pieces(10, 10, 10), 2, 30); got != nil {
		t.Fatalf("evicted %v from a torrent that fits", got)
	}
	if got := evictionPlan(pieces(10, 10, 10), 2, 0); got != nil {
		t.Fatalf("evicted %v with no ceiling set", got)
	}
}

func TestThePiecesFurthestBehindTheReaderGoFirstAndOnlyAsManyAsNeeded(t *testing.T) {
	// Six pieces of 10 on a ceiling of 35: 25 over would need three... but only
	// 60-35 = 25 is over, so three pieces, from the back of the reader.
	got := evictionPlan(pieces(10, 10, 10, 10, 10, 10), 4, 35)
	if want := []int{0, 1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("evicted %v, want %v", got, want)
	}
}

func TestThePieceTheReaderIsOnIsNeverEvicted(t *testing.T) {
	got := evictionPlan(pieces(10, 10, 10), 2, 5)
	for _, i := range got {
		if i == 2 {
			t.Fatalf("evicted the piece being read: %v", got)
		}
	}
}

func TestAPieceStillBeingWrittenIsNeverEvicted(t *testing.T) {
	ps := pieces(10, 10, 10, 10)
	ps[0].complete = false
	got := evictionPlan(ps, 3, 20)
	if want := []int{1, 2}; !reflect.DeepEqual(got, want) {
		t.Fatalf("evicted %v, want %v: piece 0 is in flight", got, want)
	}
}

func TestWhatIsBehindIsNotEnoughTheFurthestAheadGoesNext(t *testing.T) {
	// Reader on 1: one piece behind, the rest ahead. Ceiling 20 of 50.
	got := evictionPlan(pieces(10, 10, 10, 10, 10), 1, 20)
	if want := []int{0, 4, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("evicted %v, want %v", got, want)
	}
}

func TestADiskFullErrorSaysSoAndAnyOtherSaysTheDirectoryIsUnwritable(t *testing.T) {
	full := &fs.PathError{Op: "write", Path: "x", Err: syscall.ENOSPC}
	if got := storageSentence(fmt.Errorf("writing: %w", full)); got != diskFullSentence {
		t.Fatalf("ENOSPC: %q", got)
	}
	if got := storageSentence(&fs.PathError{Op: "open", Path: "x", Err: syscall.EACCES}); got != unwritableSentence {
		t.Fatalf("EACCES: %q", got)
	}
	if got := storageSentence(errors.New("anything")); got != unwritableSentence {
		t.Fatalf("other: %q", got)
	}
}

// ── The reader set ──────────────────────────────────────────────────────────

type fakeAhead struct {
	mu sync.Mutex
	n  int64
}

func (f *fakeAhead) SetReadahead(n int64) { f.mu.Lock(); f.n = n; f.mu.Unlock() }
func (f *fakeAhead) get() int64           { f.mu.Lock(); defer f.mu.Unlock(); return f.n }

func trackedAt(set *readerSet, ra readahead, pos int64) *trackedReader {
	r := newTrackedReader(bytes.NewReader(make([]byte, 1<<20)), ra, set, 0, 1000, 5)
	if _, err := r.Seek(pos, io.SeekStart); err != nil {
		panic(err)
	}
	return r
}

func TestTheReaderIsOnThePieceItSoughtAndReadsTo(t *testing.T) {
	set := newReaderSet()
	if got := set.piece(); got != -1 {
		t.Fatalf("no reader yet: piece %d", got)
	}
	r := trackedAt(set, &fakeAhead{}, 7_500)
	if got := set.piece(); got != 7 {
		t.Fatalf("after a seek to 7500: piece %d, want 7", got)
	}
	if _, err := r.Read(make([]byte, 1_000)); err != nil {
		t.Fatal(err)
	}
	if got := set.piece(); got != 8 {
		t.Fatalf("after reading 1000 more: piece %d, want 8", got)
	}
}

func TestSeveralReadersCountBehindFromTheLeastOfThem(t *testing.T) {
	set := newReaderSet()
	main := trackedAt(set, &fakeAhead{}, 3_000)
	tail := trackedAt(set, &fakeAhead{}, 900_000) // an index read at the end of the file
	if got := set.piece(); got != 3 {
		t.Fatalf("piece %d, want the main reader's 3", got)
	}
	tail.Close()
	main.Close()
	if got := set.piece(); got != 3 {
		t.Fatalf("with every reader closed the last place stands: piece %d", got)
	}
}

func TestAReadersReadaheadIsSetWhenItOpensAndWhenTheSetIsTold(t *testing.T) {
	set := newReaderSet()
	a, b := &fakeAhead{}, &fakeAhead{}
	trackedAt(set, a, 0)
	trackedAt(set, b, 0)
	if a.get() != 5 {
		t.Fatalf("opened with %d, want 5", a.get())
	}
	set.setReadahead(77)
	if a.get() != 77 || b.get() != 77 {
		t.Fatalf("after setReadahead: %d and %d, want 77", a.get(), b.get())
	}
}

// ── The storage on a disk ───────────────────────────────────────────────────

// A torrent of 10 pieces of 1000 bytes, opened on a directory of its own.
func openDisk(t *testing.T, cache int64, reader *int) (*boundedDisk, metainfo.Info, *[]error) {
	t.Helper()
	var failures []error
	var mu sync.Mutex
	d := newBoundedDisk(
		filepath.Join(t.TempDir(), "torrent"),
		func() int64 { return cache },
		func() int { return *reader },
		func(err error) { mu.Lock(); failures = append(failures, err); mu.Unlock() },
	)
	info := metainfo.Info{Name: "x", PieceLength: 1000, Length: 10_000, Pieces: make([]byte, 20*10)}
	if _, err := d.OpenTorrent(nil, &info, metainfo.Hash{}); err != nil { //nolint:staticcheck // the context is unused
		t.Fatal(err)
	}
	return d, info, &failures
}

func piece(d *boundedDisk, info metainfo.Info, i int) *keptPieceImpl {
	p := info.Piece(i)
	return &keptPieceImpl{d: d, index: i, length: p.Length()}
}

func fill(t *testing.T, p *keptPieceImpl) {
	t.Helper()
	if _, err := p.WriteAt(bytes.Repeat([]byte{byte(p.index)}, int(p.length)), 0); err != nil {
		t.Fatal(err)
	}
	if err := p.MarkComplete(); err != nil {
		t.Fatal(err)
	}
}

func filesIn(t *testing.T, d *boundedDisk) []string {
	t.Helper()
	entries, err := os.ReadDir(d.dir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	return names
}

func TestAPieceWrittenAndMarkedCompleteReadsBack(t *testing.T) {
	reader := 0
	d, info, _ := openDisk(t, 0, &reader)
	p := piece(d, info, 3)
	if c := p.Completion(); !c.Ok || c.Complete {
		t.Fatalf("before: %+v", c)
	}
	fill(t, p)
	if c := p.Completion(); !c.Ok || !c.Complete {
		t.Fatalf("after: %+v", c)
	}
	got := make([]byte, 10)
	if _, err := p.ReadAt(got, 500); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, bytes.Repeat([]byte{3}, 10)) {
		t.Fatalf("read %v", got)
	}
}

func TestTheDiskStaysWithinTheCeilingAsPiecesArriveBehindTheReader(t *testing.T) {
	reader := 0
	d, info, _ := openDisk(t, 3500, &reader) // three pieces and a half
	for i := 0; i < 10; i++ {
		reader = i
		fill(t, piece(d, info, i))
		if held := d.Held(); held > 3500 {
			t.Fatalf("after piece %d the disk holds %d, over 3500", i, held)
		}
	}
	// What is left is the reader's own piece and the two before it.
	if got, want := filesIn(t, d), []string{"7.piece", "8.piece", "9.piece"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("files %v, want %v", got, want)
	}
	if c := piece(d, info, 0).Completion(); c.Complete {
		t.Fatal("an evicted piece still says it is complete")
	}
}

// bytesOnDisk is what a torrent's directory holds, in bytes of piece files.
func bytesOnDisk(t *testing.T, d *boundedDisk) int64 {
	t.Helper()
	return kept(t, d.dir)
}

func TestAPieceIsMadeRoomForBeforeItsFirstBytesAreWritten(t *testing.T) {
	reader := 3
	var d *boundedDisk
	var onDisk []int64
	cache := func() int64 {
		// Asked while the storage decides what to give up: the directory must
		// not already hold more than the ceiling.
		onDisk = append(onDisk, bytesOnDisk(t, d))
		return 3000
	}
	d = newBoundedDisk(filepath.Join(t.TempDir(), "torrent"), cache, func() int { return reader }, func(error) {})
	info := metainfo.Info{Name: "x", PieceLength: 1000, Length: 10_000, Pieces: make([]byte, 20*10)}
	if _, err := d.OpenTorrent(nil, &info, metainfo.Hash{}); err != nil { //nolint:staticcheck // the context is unused
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		fill(t, piece(d, info, i))
	}

	if _, err := piece(d, info, 3).WriteAt(make([]byte, 100), 0); err != nil {
		t.Fatal(err)
	}

	for _, got := range onDisk {
		if got > 3000 {
			t.Fatalf("a piece began while the directory held %d bytes, over the 3000 ceiling: the room was made after the write", got)
		}
	}
	if got := bytesOnDisk(t, d); got > 3000 {
		t.Fatalf("after the write the directory holds %d bytes", got)
	}
}

func TestALowerCeilingTrimsWhatIsKept(t *testing.T) {
	reader := 9
	cache := int64(0)
	d := newBoundedDisk(
		filepath.Join(t.TempDir(), "torrent"),
		func() int64 { return cache },
		func() int { return reader },
		func(error) {},
	)
	info := metainfo.Info{Name: "x", PieceLength: 1000, Length: 10_000, Pieces: make([]byte, 20*10)}
	if _, err := d.OpenTorrent(nil, &info, metainfo.Hash{}); err != nil { //nolint:staticcheck // the context is unused
		t.Fatal(err)
	}
	for i := 0; i < 10; i++ {
		fill(t, piece(d, info, i))
	}
	if held := d.Held(); held != 10_000 {
		t.Fatalf("unbounded, the disk holds %d", held)
	}

	cache = 2000
	d.Trim()

	if held := d.Held(); held > 2000 {
		t.Fatalf("after a ceiling of 2000 the disk holds %d", held)
	}
	if got, want := filesIn(t, d), []string{"8.piece", "9.piece"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("files %v, want %v", got, want)
	}
}

func TestEvictedPiecesAreHandedBackToTheSwarmClientToLookAtAgain(t *testing.T) {
	reader := 0
	d, info, _ := openDisk(t, 2000, &reader)
	var mu sync.Mutex
	var rechecked []int
	d.setRecheck(func(i int) { mu.Lock(); rechecked = append(rechecked, i); mu.Unlock() })
	for i := 0; i < 4; i++ {
		reader = i
		fill(t, piece(d, info, i))
	}
	eventually(t, "the evicted pieces to be looked at again", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(rechecked) == 2
	})
}

func TestAWriteThatFailsIsToldAndReturnsTheError(t *testing.T) {
	reader := 0
	d, info, failures := openDisk(t, 0, &reader)
	// A directory where the piece's file should be: opening it to write fails
	// whoever is running the test, which a read-only mode would not.
	if err := os.Mkdir(filepath.Join(d.dir, "2.piece"), 0o755); err != nil {
		t.Fatal(err)
	}

	_, err := piece(d, info, 2).WriteAt([]byte("x"), 0)

	if err == nil {
		t.Fatal("the write succeeded")
	}
	if len(*failures) != 1 {
		t.Fatalf("the failure was told %d times", len(*failures))
	}
}

func TestOpeningATorrentWhereTheDirectoryCannotBeMadeIsAFailure(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "torrent")
	if err := os.WriteFile(blocker, []byte("a file, not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}
	var told int
	d := newBoundedDisk(blocker, func() int64 { return 0 }, func() int { return -1 }, func(error) { told++ })

	_, err := d.OpenTorrent(nil, &metainfo.Info{Name: "x", PieceLength: 1000, Length: 1000, Pieces: make([]byte, 20)}, metainfo.Hash{}) //nolint:staticcheck // the context is unused

	if err == nil || told != 1 {
		t.Fatalf("err %v, told %d times", err, told)
	}
}

// ── The engine ──────────────────────────────────────────────────────────────

// A film of 40 pieces of 64 KiB: 2.5 MiB, far more than the ceilings below.
func longFilm() map[string][]byte {
	return map[string][]byte{"film.mkv": randomBytes(7, 40*(64<<10))}
}

// kept is what a torrent's directory holds, in bytes of piece files.
func kept(t *testing.T, dir string) int64 {
	t.Helper()
	var total int64
	filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() && strings.HasSuffix(path, ".piece") {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

func TestAWholeFilePlaysThroughACacheSmallerThanItAndStaysWithinIt(t *testing.T) {
	data := longFilm()
	s := seed(t, data)
	r := startEngine(t)
	const cache = 512 << 10
	r.send(map[string]any{"op": "limits", "readahead": 128 << 10, "cache": cache})
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)

	resp, body := get(t, url, nil)

	if resp.StatusCode != 200 || !bytes.Equal(body, data["film.mkv"]) {
		t.Fatalf("status %d, %d bytes: the film did not play through", resp.StatusCode, len(body))
	}
	dir := filepath.Join(r.dir, s.hash)
	if got := kept(t, dir); got > cache {
		t.Fatalf("the torrent's directory holds %d bytes, over the %d ceiling", got, cache)
	}
	if h := r.eng.heldFor(s.hash); h.disk.Held() > cache {
		t.Fatalf("the storage counts %d, over %d", h.disk.Held(), cache)
	}
}

// peakOnDisk watches a torrent's directory while f runs and returns the most it
// ever held. The ceiling is a bound, not a state the torrent comes back to.
func peakOnDisk(t *testing.T, dir string, f func()) int64 {
	t.Helper()
	var peak int64
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for {
			if k := kept(t, dir); k > peak {
				peak = k
			}
			select {
			case <-stop:
				return
			default:
			}
		}
	}()
	f()
	// What fetching had in flight when the reader stopped lands after it.
	time.Sleep(300 * time.Millisecond)
	close(stop)
	<-done
	return peak
}

func TestTheDirectoryNeverHoldsMoreThanTheCeilingNotEvenWhilePiecesArrive(t *testing.T) {
	data := longFilm()
	s := seed(t, data)
	r := startEngine(t)
	const cache = 512 << 10
	r.send(map[string]any{"op": "limits", "readahead": 128 << 10, "cache": cache})
	_, url := r.serve(s.hash, nil, nil)
	dir := filepath.Join(r.dir, s.hash)

	peak := peakOnDisk(t, dir, func() {
		r.connect(s)
		get(t, url, nil)
	})

	if peak > cache {
		t.Fatalf("the torrent's directory held %d bytes at its peak, over the %d ceiling", peak, cache)
	}
}

func TestSeekingBackToWhatWasGivenUpFetchesItAgain(t *testing.T) {
	data := longFilm()
	s := seed(t, data)
	r := startEngine(t)
	const cache = 512 << 10
	r.send(map[string]any{"op": "limits", "readahead": 128 << 10, "cache": cache})
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)
	get(t, url, nil) // to the end: the start is behind the reader and gone

	dir := filepath.Join(r.dir, s.hash)
	if _, err := os.Stat(filepath.Join(dir, "0.piece")); err == nil {
		t.Fatal("the first piece is still on disk after the whole file played")
	}

	resp, body := get(t, url, map[string]string{"Range": "bytes=0-199999"})

	if resp.StatusCode != http.StatusPartialContent || !bytes.Equal(body, data["film.mkv"][:200_000]) {
		t.Fatalf("status %d, %d bytes: the start did not come back right", resp.StatusCode, len(body))
	}
	if got := kept(t, dir); got > cache {
		t.Fatalf("the torrent's directory holds %d bytes, over the %d ceiling", got, cache)
	}
}

func TestALimitsOpTrimsWhatIsKeptAtOnceAndReachesTheOpenReaders(t *testing.T) {
	data := longFilm()
	s := seed(t, data)
	r := startEngine(t)
	r.send(map[string]any{"op": "limits", "readahead": 16 << 20, "cache": 2_000_000_000})
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)
	get(t, url, nil)
	h := r.eng.heldFor(s.hash)
	whole := int64(len(data["film.mkv"]))
	if got := h.disk.Held(); got != whole {
		t.Fatalf("under a ceiling of 2 GB the whole file is kept: %d of %d", got, whole)
	}

	open := &fakeAhead{}
	live := newTrackedReader(bytes.NewReader(nil), open, h.readers, 0, 64<<10, 1)
	defer live.Close()
	r.send(map[string]any{"op": "limits", "readahead": 1 << 30, "cache": 256 << 10})

	eventually(t, "the held torrent to fit the new ceiling", func() bool { return h.disk.Held() <= 256<<10 })
	eventually(t, "the open reader to read ahead by the clamped amount", func() bool {
		return open.get() == 192<<10 // three quarters of 256 KiB
	})
}

func TestAnUnwritableDirectoryIsAStorageFailureWithASentence(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	r.serve(s.hash, nil, nil)
	// The torrent's directory becomes a file before its pieces are known.
	dir := filepath.Join(r.dir, s.hash)
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dir, []byte("not a directory"), 0o644); err != nil {
		t.Fatal(err)
	}

	r.connect(s)

	ev := r.await("a storage failure", ofKind("failed"))
	if ev["kind"] != "storage" || ev["infoHash"] != s.hash {
		t.Fatalf("failed: %v", ev)
	}
	if sentence, _ := ev["sentence"].(string); sentence != unwritableSentence {
		t.Fatalf("sentence %q, want %q", sentence, unwritableSentence)
	}
}

func TestAWriteErrorWhileFetchingIsAStorageFailureToldOnce(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)
	dir := filepath.Join(r.dir, s.hash)
	// Every piece's file is taken by a directory, so the first write fails.
	for i := 0; i < 20; i++ {
		if err := os.MkdirAll(filepath.Join(dir, fmt.Sprintf("%d.piece", i)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	r.connect(s)
	go func() {
		if resp, err := http.Get(url); err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}()

	ev := r.await("a storage failure", ofKind("failed"))
	if ev["kind"] != "storage" {
		t.Fatalf("failed: %v", ev)
	}

	// No second report follows, however many writes fail.
	deadline := time.After(500 * time.Millisecond)
	for {
		select {
		case more := <-r.events:
			if more["ev"] == "failed" {
				t.Fatalf("a second failure: %v", more)
			}
		case <-deadline:
			return
		}
	}
}
