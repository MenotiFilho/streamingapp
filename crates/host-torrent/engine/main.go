// SPDX-License-Identifier: GPL-3.0-or-later

// Command streamingapp-torrent is the Host's Torrent engine: a program of our own
// over anacrolix/torrent (MPL-2.0) that joins a torrent's swarm from the owner's
// own address and serves the file the Player asks for over a tokened loopback
// URL. The Host starts it on the first torrent played and talks to it in JSON
// lines over stdio (spec #311, ADR-0042 §1).
//
// # Running it
//
//	streamingapp-torrent --torrents-dir <dir>
//
// --torrents-dir is the directory the engine keeps its torrents in, one plain
// directory per held torrent, named by its infoHash. It is required: the spec
// leaves open how the engine learns it, and the Host's host-torrent crate passes
// it as this argument, as `<local data dir>/torrents`. The Host wipes that
// directory at its own startup; the engine creates it when it is missing.
//
// # The protocol
//
// One JSON object per line. The Host writes `limits`, `serve` and `let_go` to
// stdin; the engine writes `ready`, `served`, `refused`, `status`, `chosen` and
// `failed` to stdout, and its own log to stderr. Unknown lines are logged to
// stderr and ignored. protocol.go is the codec.
//
// # Lifetime
//
// The engine exits when its stdin closes, after dropping every torrent and
// removing every directory it holds. A `let_go` does the same for one torrent.
//
// # Serving
//
// The engine listens on an ephemeral 127.0.0.1 port. A `serve` is answered at
// once, before metadata, with http://127.0.0.1:<port>/<token>/<infoHash>/<serve id>;
// the token is 32 random bytes in hex, made once per run, and a request without
// it gets 403. The handler waits for metadata and the file choice, then serves the
// file over HTTP Range (206).
//
// # Peers
//
// TCP and uTP on an ephemeral wildcard port, with DHT, UPnP/NAT-PMP, the
// Stream's trackers and `dht:` sources. Nothing is seeded and no upload limit
// applies: a torrent uploads while it is held and no longer.
package main

import (
	"flag"
	"fmt"
	"os"
)

func main() {
	dir := flag.String("torrents-dir", "", "directory the engine keeps its torrents in (required)")
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "usage: %s --torrents-dir <dir>\n", os.Args[0])
		flag.PrintDefaults()
	}
	flag.Parse()
	if *dir == "" || flag.NArg() != 0 {
		flag.Usage()
		os.Exit(2)
	}

	eng, err := NewEngine(Config{TorrentsDir: *dir, Log: os.Stderr}, NewEmitter(os.Stdout))
	if err != nil {
		fmt.Fprintf(os.Stderr, "engine: %v\n", err)
		os.Exit(1)
	}
	if err := eng.Run(os.Stdin); err != nil {
		fmt.Fprintf(os.Stderr, "engine: %v\n", err)
		os.Exit(1)
	}
}
