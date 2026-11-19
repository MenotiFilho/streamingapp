// SPDX-License-Identifier: GPL-3.0-or-later

// Command fixture-seed is a Windows walkthrough tool, never bundled into the
// installer (spec #311, issue #347). It builds two torrents from the fixture
// video — one single-file film and one two-file season pack (S01E01, S01E02) —
// seeds both on 127.0.0.1, serves its own loopback HTTP tracker, and prints the
// infoHashes as JSON lines to stdout.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	video := flag.String("video", "", "path to the fixture video file")
	workDir := flag.String("dir", "", "optional staging directory (defaults to a temp dir cleaned up on exit)")
	watchStdin := flag.Bool("watch-stdin", false, "exit cleanly when stdin closes (used by fixture-addon.ps1)")
	flag.Parse()

	if *video == "" {
		fmt.Fprintln(os.Stderr, "fixture-seed: --video is required")
		os.Exit(2)
	}

	seeder, err := Start(Config{
		VideoPath: *video,
		WorkDir:   *workDir,
		Log:       os.Stderr,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "fixture-seed: %v\n", err)
		os.Exit(1)
	}
	defer seeder.Close()

	if err := seeder.WriteJSONLines(os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "fixture-seed: writing infoHashes: %v\n", err)
		os.Exit(1)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	stdinDone := make(chan struct{})
	if *watchStdin {
		go func() {
			_, _ = io.Copy(io.Discard, os.Stdin)
			close(stdinDone)
		}()
	}

	select {
	case <-sigCh:
	case <-stdinDone:
	}
}
