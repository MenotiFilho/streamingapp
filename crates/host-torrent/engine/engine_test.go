// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

// No real swarm runs here. A torrent is seeded by a second client in the test,
// on loopback, and the engine is pointed at it with AddClientPeer; trackers,
// DHT and port forwarding are off for both.

const wait = 20 * time.Second

func loopbackOnly(cc *torrent.ClientConfig) {
	cc.NoDHT = true
	cc.DisableTrackers = true
	cc.NoDefaultPortForwarding = true
	cc.DisableIPv6 = true
	cc.ListenHost = torrent.LoopbackListenHost
	cc.ListenPort = 0
}

func randomBytes(seed int64, n int) []byte {
	b := make([]byte, n)
	rand.New(rand.NewSource(seed)).Read(b)
	return b
}

type seeded struct {
	client *torrent.Client
	hash   string
	files  map[string][]byte // by name, in the torrent
	order  []string          // the torrent's file order
}

// seed makes a torrent of the given files (a directory named "pack") and seeds
// it from a client of its own.
func seed(t *testing.T, files map[string][]byte) *seeded {
	t.Helper()
	root := t.TempDir()
	packDir := filepath.Join(root, "pack")
	if err := os.MkdirAll(packDir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(packDir, name), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(packDir); err != nil {
		t.Fatal(err)
	}
	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	mi := &metainfo.MetaInfo{InfoBytes: infoBytes}

	cc := torrent.NewDefaultClientConfig()
	loopbackOnly(cc)
	cc.Seed = true
	cc.DataDir = root
	client, err := torrent.NewClient(cc)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	tor, err := client.AddTorrent(mi)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-tor.Complete().On():
	case <-time.After(wait):
		t.Fatal("the seeder never verified its own data")
	}

	s := &seeded{client: client, hash: mi.HashInfoBytes().HexString(), files: files}
	for _, f := range tor.Files() {
		s.order = append(s.order, filepath.Base(f.DisplayPath()))
	}
	return s
}

// lockedBuffer is a bytes.Buffer safe to read while the engine writes it.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// rig is an engine wired to pipes, the way the Host wires the real one.
type rig struct {
	t       *testing.T
	eng     *Engine
	dir     string // the torrents directory
	stdin   *io.PipeWriter
	events  chan map[string]any
	stderr  *lockedBuffer
	runDone chan error
	nextID  int64
}

func startEngine(t *testing.T) *rig {
	t.Helper()
	r := &rig{t: t, dir: filepath.Join(t.TempDir(), "torrents"), stderr: &lockedBuffer{}, events: make(chan map[string]any, 4096), runDone: make(chan error, 1)}
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	r.stdin = inW

	eng, err := NewEngine(Config{
		TorrentsDir: r.dir,
		StatusEvery: 40 * time.Millisecond,
		Log:         r.stderr,
		Tweak:       loopbackOnly,
	}, NewEmitter(outW))
	if err != nil {
		t.Fatal(err)
	}
	r.eng = eng

	go func() {
		sc := bufio.NewScanner(outR)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		for sc.Scan() {
			var ev map[string]any
			if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
				t.Errorf("the engine wrote a line that is not JSON: %q", sc.Text())
				continue
			}
			r.events <- ev
		}
	}()
	go func() {
		r.runDone <- eng.Run(inR)
		outW.Close()
	}()
	t.Cleanup(func() { r.stdin.Close(); <-r.runDone })
	return r
}

func (r *rig) send(v any) {
	r.t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		r.t.Fatal(err)
	}
	r.sendLine(string(b))
}

func (r *rig) sendLine(line string) {
	r.t.Helper()
	if _, err := io.WriteString(r.stdin, line+"\n"); err != nil {
		r.t.Fatal(err)
	}
}

// await reads events until one matches, and returns it.
func (r *rig) await(desc string, match func(map[string]any) bool) map[string]any {
	r.t.Helper()
	timeout := time.After(wait)
	for {
		select {
		case ev := <-r.events:
			if match(ev) {
				return ev
			}
		case <-timeout:
			r.t.Fatalf("no %s within %v; stderr:\n%s", desc, wait, r.stderr.String())
			return nil
		}
	}
}

func ofKind(kind string) func(map[string]any) bool {
	return func(ev map[string]any) bool { return ev["ev"] == kind }
}

func (r *rig) serve(hash string, fileIdx *int, sources []string) (id int64, url string) {
	r.t.Helper()
	r.nextID++
	id = r.nextID
	r.send(map[string]any{
		"op": "serve", "id": id, "infoHash": hash, "fileIdx": fileIdx, "sources": sources,
		"hints": map[string]any{"filename": nil, "season": nil, "episode": nil},
	})
	ev := r.await("served", func(ev map[string]any) bool {
		return ev["ev"] == "served" || ev["ev"] == "refused"
	})
	if ev["ev"] == "refused" {
		r.t.Fatalf("serve was refused: %v", ev["sentence"])
	}
	if int64(ev["id"].(float64)) != id {
		r.t.Fatalf("served answers id %v, want %d", ev["id"], id)
	}
	return id, ev["url"].(string)
}

// connect points the engine's torrent at the seeder.
func (r *rig) connect(s *seeded) {
	r.t.Helper()
	h := r.eng.heldFor(s.hash)
	if h == nil {
		r.t.Fatalf("the engine does not hold %s", s.hash)
	}
	h.t.AddClientPeer(s.client)
}

func get(t *testing.T, url string, header map[string]string) (*http.Response, []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), wait)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range header {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("reading %s: %v", url, err)
	}
	return resp, body
}

func film() map[string][]byte {
	return map[string][]byte{"film.mkv": randomBytes(1, 600<<10)}
}

func TestReadyComesFirst(t *testing.T) {
	r := startEngine(t)
	ev := r.await("ready", func(map[string]any) bool { return true })
	if ev["ev"] != "ready" {
		t.Fatalf("the first event is %v, want ready", ev)
	}
}

func TestTheURLIsTokenedLoopbackAndAnsweredBeforeMetadata(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)

	// Nothing is connected to the seeder yet, so the torrent has no metadata.
	id, url := r.serve(s.hash, nil, nil)
	want := regexp.MustCompile(fmt.Sprintf(`^http://127\.0\.0\.1:\d+/[0-9a-f]{64}/%s/%d$`, s.hash, id))
	if !want.MatchString(url) {
		t.Fatalf("url %q is not http://127.0.0.1:<port>/<token>/<infoHash>/<serve id>", url)
	}
	if r.eng.heldFor(s.hash).t.Info() != nil {
		t.Fatal("the torrent had metadata before any peer was connected")
	}

	// The handler waits, behind the URL, for metadata that has not come.
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
		t.Fatalf("answered %d before there was metadata", resp.StatusCode)
	}

	// Once a peer shares it, the same URL plays.
	r.connect(s)
	resp, body := get(t, url, nil)
	if resp.StatusCode != http.StatusOK || !bytes.Equal(body, s.files["film.mkv"]) {
		t.Fatalf("got %d with %d bytes, want 200 with the whole file", resp.StatusCode, len(body))
	}
}

func TestRangeRequestsAnswer206(t *testing.T) {
	s := seed(t, film())
	data := s.files["film.mkv"]
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)

	resp, body := get(t, url, map[string]string{"Range": "bytes=1000-1999"})
	if resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("status %d, want 206", resp.StatusCode)
	}
	if got, want := resp.Header.Get("Content-Range"), fmt.Sprintf("bytes 1000-1999/%d", len(data)); got != want {
		t.Fatalf("Content-Range %q, want %q", got, want)
	}
	if !bytes.Equal(body, data[1000:2000]) {
		t.Fatal("the range's bytes are not the file's bytes")
	}

	// A suffix range reads from the end, across a different piece.
	resp, body = get(t, url, map[string]string{"Range": "bytes=-500"})
	if resp.StatusCode != http.StatusPartialContent || !bytes.Equal(body, data[len(data)-500:]) {
		t.Fatalf("suffix range: status %d, %d bytes", resp.StatusCode, len(body))
	}
	if resp.Header.Get("Accept-Ranges") != "bytes" {
		t.Fatalf("Accept-Ranges %q, want bytes", resp.Header.Get("Accept-Ranges"))
	}
}

func TestARequestWithoutTheTokenIs403(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	id, url := r.serve(s.hash, nil, nil)
	base := fmt.Sprintf("http://%s", r.eng.Addr())
	r.connect(s)

	cases := map[string]string{
		"no token":    fmt.Sprintf("%s/%s/%d", base, s.hash, id),
		"wrong token": fmt.Sprintf("%s/%s/%s/%d", base, strings.Repeat("0", 64), s.hash, id),
		"root":        base + "/",
		"short token": fmt.Sprintf("%s/abc/%s/%d", base, s.hash, id),
	}
	for name, u := range cases {
		t.Run(name, func(t *testing.T) {
			if resp, _ := get(t, u, nil); resp.StatusCode != http.StatusForbidden {
				t.Fatalf("status %d, want 403", resp.StatusCode)
			}
		})
	}
	if resp, _ := get(t, url, map[string]string{"Range": "bytes=0-9"}); resp.StatusCode != http.StatusPartialContent {
		t.Fatalf("the real URL answered %d, want 206", resp.StatusCode)
	}
}

func TestTheTokenIsMadeOncePerRun(t *testing.T) {
	a, b := seed(t, film()), seed(t, map[string][]byte{"other.mkv": randomBytes(2, 100<<10)})
	r := startEngine(t)
	_, urlA := r.serve(a.hash, nil, nil)
	_, urlB := r.serve(b.hash, nil, nil)
	tokenOf := func(u string) string { return strings.Split(strings.TrimPrefix(u, "http://"), "/")[1] }
	if tokenOf(urlA) != tokenOf(urlB) {
		t.Fatal("two serves in one run carry two tokens")
	}
	if len(tokenOf(urlA)) != 64 {
		t.Fatalf("token %q is not 32 bytes in hex", tokenOf(urlA))
	}
	// Another run makes another one.
	r2 := startEngine(t)
	_, urlC := r2.serve(a.hash, nil, nil)
	if tokenOf(urlC) == tokenOf(urlA) {
		t.Fatal("two runs share a token")
	}
}

func TestAnUnknownTorrentOrServeIs404(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	id, url := r.serve(s.hash, nil, nil)
	token := strings.Split(strings.TrimPrefix(url, "http://"), "/")[1]
	base := fmt.Sprintf("http://%s/%s", r.eng.Addr(), token)
	for name, u := range map[string]string{
		"unknown torrent":   fmt.Sprintf("%s/%s/%d", base, strings.Repeat("a", 40), id),
		"unknown serve id":  fmt.Sprintf("%s/%s/%d", base, s.hash, id+100),
		"a non-numeric id":  fmt.Sprintf("%s/%s/x", base, s.hash),
		"too many segments": fmt.Sprintf("%s/%s/%d/extra", base, s.hash, id),
	} {
		t.Run(name, func(t *testing.T) {
			if resp, _ := get(t, u, nil); resp.StatusCode != http.StatusNotFound {
				t.Fatalf("status %d, want 404", resp.StatusCode)
			}
		})
	}
}

func TestStatusGoesFromFindingToFetching(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)

	finding := r.await("a finding status", func(ev map[string]any) bool {
		return ev["ev"] == "status" && ev["phase"] == "finding"
	})
	if finding["infoHash"] != s.hash || finding["peers"].(float64) != 0 || finding["rate"].(float64) != 0 {
		t.Fatalf("finding status: %v", finding)
	}

	r.connect(s)
	fetching := r.await("a fetching status with a peer", func(ev map[string]any) bool {
		return ev["ev"] == "status" && ev["phase"] == "fetching" && ev["peers"].(float64) >= 1
	})
	if fetching["infoHash"] != s.hash {
		t.Fatalf("fetching status: %v", fetching)
	}

	// Fetching reports a rate once bytes arrive.
	go func() {
		if resp, err := http.Get(url); err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}()
	r.await("a status with a rate", func(ev map[string]any) bool {
		return ev["ev"] == "status" && ev["rate"].(float64) > 0
	})
}

func TestStatusIsNotSentMoreOftenThanItsInterval(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	r.serve(s.hash, nil, nil)
	var stamps []time.Time
	for len(stamps) < 4 {
		r.await("a status", ofKind("status"))
		stamps = append(stamps, time.Now())
	}
	// StatusEvery is 40 ms in the rig; allow scheduling slack, but four statuses
	// cannot arrive in less than three intervals.
	if gap := stamps[3].Sub(stamps[0]); gap < 90*time.Millisecond {
		t.Fatalf("four statuses in %v: faster than one per interval", gap)
	}
}

func TestTheFileIsTheFileIdxWhenInRangeElseTheLargest(t *testing.T) {
	files := map[string][]byte{
		"a-extras.txt": randomBytes(3, 80<<10),
		"b-film.mkv":   randomBytes(4, 300<<10),
		"c-sample.mkv": randomBytes(5, 120<<10),
	}
	s := seed(t, files)
	index := map[string]int{}
	for i, name := range s.order {
		index[name] = i
	}
	r := startEngine(t)

	cases := []struct {
		name    string
		fileIdx *int
		want    string
	}{
		{"no fileIdx plays the largest", nil, "b-film.mkv"},
		{"a fileIdx in range plays that file", ptr(index["c-sample.mkv"]), "c-sample.mkv"},
		{"a fileIdx out of range plays the largest", ptr(99), "b-film.mkv"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, url := r.serve(s.hash, c.fileIdx, nil)
			r.connect(s)
			resp, body := get(t, url, nil)
			if resp.StatusCode != http.StatusOK || !bytes.Equal(body, files[c.want]) {
				t.Fatalf("status %d; the body is not %s", resp.StatusCode, c.want)
			}
			chosen := r.await("chosen", ofKind("chosen"))
			if chosen["name"] != c.want || int(chosen["fileIdx"].(float64)) != index[c.want] || chosen["infoHash"] != s.hash {
				t.Fatalf("chosen %v, want %s at %d", chosen, c.want, index[c.want])
			}
		})
	}
}

func TestChosenIsSaidOncePerServe(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)
	get(t, url, map[string]string{"Range": "bytes=0-99"})
	get(t, url, map[string]string{"Range": "bytes=100-199"})
	r.await("chosen", ofKind("chosen"))
	// A third request, then everything that follows: no second `chosen`.
	get(t, url, map[string]string{"Range": "bytes=200-299"})
	deadline := time.After(150 * time.Millisecond)
	for {
		select {
		case ev := <-r.events:
			if ev["ev"] == "chosen" {
				t.Fatal("chosen was said twice for one serve")
			}
		case <-deadline:
			return
		}
	}
}

func TestPiecesLandInThePerTorrentDirectory(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)
	get(t, url, nil)

	dir := filepath.Join(r.dir, s.hash)
	var found bool
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() && d.Name() == "film.mkv" {
			found = true
		}
		return nil
	})
	if !found {
		t.Fatalf("film.mkv is not under %s", dir)
	}
}

func TestLetGoRemovesTheDirectoryAndStopsServing(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	_, url := r.serve(s.hash, nil, nil)
	r.connect(s)
	get(t, url, nil)
	dir := filepath.Join(r.dir, s.hash)
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("the torrent's directory should exist while it is held: %v", err)
	}

	r.send(map[string]any{"op": "let_go", "infoHash": s.hash})
	eventually(t, "the torrent's directory to be removed", func() bool {
		_, err := os.Stat(dir)
		return os.IsNotExist(err)
	})
	eventually(t, "the torrent to leave the client", func() bool { return r.eng.heldFor(s.hash) == nil })
	if resp, _ := get(t, url, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("a let-go torrent answered %d, want 404", resp.StatusCode)
	}
	for _, tor := range r.eng.client.Torrents() {
		if tor.InfoHash().HexString() == s.hash {
			t.Fatal("the client still holds a torrent that was let go")
		}
	}

	// Letting go what is not held, or a malformed hash, is harmless.
	r.send(map[string]any{"op": "let_go", "infoHash": s.hash})
	r.send(map[string]any{"op": "let_go", "infoHash": "nope"})
	r.serve(s.hash, nil, nil) // the engine still answers
}

func TestClosingStdinRemovesEverythingAndExits(t *testing.T) {
	a, b := seed(t, film()), seed(t, map[string][]byte{"other.mkv": randomBytes(2, 100<<10)})
	r := startEngine(t)
	_, urlA := r.serve(a.hash, nil, nil)
	r.serve(b.hash, nil, nil)
	r.connect(a)
	get(t, urlA, nil)
	dirA, dirB := filepath.Join(r.dir, a.hash), filepath.Join(r.dir, b.hash)
	for _, d := range []string{dirA, dirB} {
		if _, err := os.Stat(d); err != nil {
			t.Fatalf("%s should exist while held: %v", d, err)
		}
	}

	r.stdin.Close()
	select {
	case err := <-r.runDone:
		if err != nil {
			t.Fatalf("Run returned %v after a clean stdin close", err)
		}
		r.runDone <- nil // for the cleanup
	case <-time.After(wait):
		t.Fatal("the engine did not exit when stdin closed")
	}
	for _, d := range []string{dirA, dirB} {
		if _, err := os.Stat(d); !os.IsNotExist(err) {
			t.Fatalf("%s survived the engine (stat error: %v)", d, err)
		}
	}
	select {
	case <-r.eng.client.Closed():
	default:
		t.Fatal("the swarm client is still open after exit")
	}
	if _, err := http.Get(fmt.Sprintf("http://%s/", r.eng.Addr())); err == nil {
		t.Fatal("the loopback listener is still open after exit")
	}
}

func TestUnknownAndMalformedLinesAreLoggedAndIgnored(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	r.sendLine("hello")
	r.sendLine(`{"op":"explode"}`)
	r.sendLine(`{"op":"serve","infoHash":"x"}`)
	r.sendLine(`[1]`)
	r.sendLine("")
	r.serve(s.hash, nil, nil) // still alive, still answering

	log := r.stderr.String()
	for _, want := range []string{"ignoring a line", `unknown op "explode"`} {
		if !strings.Contains(log, want) {
			t.Fatalf("stderr lacks %q:\n%s", want, log)
		}
	}
}

func TestAMalformedInfoHashIsRefused(t *testing.T) {
	r := startEngine(t)
	r.send(map[string]any{"op": "serve", "id": 41, "infoHash": "not-a-hash", "fileIdx": nil, "sources": []string{}, "hints": map[string]any{}})
	ev := r.await("refused", ofKind("refused"))
	if int64(ev["id"].(float64)) != 41 || ev["sentence"] == "" {
		t.Fatalf("refused: %v", ev)
	}
	entries, _ := os.ReadDir(r.dir)
	if len(entries) != 0 {
		t.Fatalf("a refused serve left %d directories behind", len(entries))
	}
}

func TestLimitsAreStoredNotApplied(t *testing.T) {
	s := seed(t, film())
	r := startEngine(t)
	r.send(map[string]any{"op": "limits", "readahead": 16 << 20, "cache": 2_000_000_000})
	r.serve(s.hash, nil, nil) // ops are handled in order, so the limits are in by now
	if got := r.eng.readahead.Load(); got != 16<<20 {
		t.Fatalf("readahead %d, want %d", got, 16<<20)
	}
	if got := r.eng.cache.Load(); got != 2_000_000_000 {
		t.Fatalf("cache %d, want 2000000000", got)
	}
}

func TestTheDirectoryIsCreatedWhenMissing(t *testing.T) {
	r := startEngine(t)
	if info, err := os.Stat(r.dir); err != nil || !info.IsDir() {
		t.Fatalf("the torrents directory was not created: %v", err)
	}
}

func TestTheSwarmClientIsConfiguredForPeers(t *testing.T) {
	// The real configuration, without a tweak: no seeding and no upload limit,
	// and listening on an ephemeral port, both TCP and uTP.
	dir := filepath.Join(t.TempDir(), "torrents")
	var seen *torrent.ClientConfig
	eng, err := NewEngine(Config{TorrentsDir: dir, Tweak: func(cc *torrent.ClientConfig) {
		seen = cc
		// Keep the test off the real network, but not what is being checked.
		cc.NoDHT, cc.DisableTrackers, cc.NoDefaultPortForwarding = true, true, true
	}}, NewEmitter(io.Discard))
	if err != nil {
		t.Fatal(err)
	}
	defer eng.Shutdown()
	if seen.Seed {
		t.Fatal("Seed must be false")
	}
	if seen.ListenPort != 0 {
		t.Fatalf("ListenPort %d, want 0 (ephemeral)", seen.ListenPort)
	}
	if seen.DisableTCP || seen.DisableUTP {
		t.Fatal("TCP and uTP must both be on")
	}
	if got := seen.UploadRateLimiter.Limit(); got < 1e15 { // rate.Inf is MaxFloat64
		t.Fatalf("an upload limit of %v is set; there must be none", got)
	}
	if eng.client.LocalPort() == 0 {
		t.Fatal("the client listens on no port")
	}
	networks := map[string]bool{}
	for _, a := range eng.client.ListenAddrs() {
		networks[a.Network()] = true
	}
	if !networks["tcp"] || !networks["udp"] {
		t.Fatalf("listening on %v; want both a TCP listener and a uTP (udp) socket", eng.client.ListenAddrs())
	}
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}
