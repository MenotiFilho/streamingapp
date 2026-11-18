// SPDX-License-Identifier: GPL-3.0-or-later

package main

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func ptr[T any](v T) *T { return &v }

func TestDecodeOp(t *testing.T) {
	const hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
	cases := []struct {
		name string
		line string
		want any
	}{
		{
			name: "limits",
			line: `{"op":"limits","readahead":16777216,"cache":2000000000}`,
			want: LimitsOp{Readahead: 16777216, Cache: 2000000000},
		},
		{
			name: "serve with every hint",
			line: `{"op":"serve","id":7,"infoHash":"` + hash + `","fileIdx":3,"sources":["tracker:udp://t.example:1337/announce","dht:` + hash + `"],"hints":{"filename":"film.mkv","season":1,"episode":3}}`,
			want: ServeOp{
				ID:       7,
				InfoHash: hash,
				FileIdx:  ptr(3),
				Sources:  []string{"tracker:udp://t.example:1337/announce", "dht:" + hash},
				Hints:    Hints{Filename: ptr("film.mkv"), Season: ptr(1), Episode: ptr(3)},
			},
		},
		{
			name: "serve with every hint null",
			line: `{"op":"serve","id":8,"infoHash":"` + hash + `","fileIdx":null,"sources":[],"hints":{"filename":null,"season":null,"episode":null}}`,
			want: ServeOp{ID: 8, InfoHash: hash, Sources: []string{}},
		},
		{
			name: "serve with the optional parts missing",
			line: `{"op":"serve","id":9,"infoHash":"` + hash + `"}`,
			want: ServeOp{ID: 9, InfoHash: hash},
		},
		{
			name: "let_go",
			line: `{"op":"let_go","infoHash":"` + hash + `"}`,
			want: LetGoOp{InfoHash: hash},
		},
		{
			name: "trailing newline and spaces",
			line: "  {\"op\":\"let_go\",\"infoHash\":\"" + hash + "\"}  \r\n",
			want: LetGoOp{InfoHash: hash},
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := DecodeOp([]byte(c.line))
			if err != nil {
				t.Fatalf("DecodeOp: %v", err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %#v, want %#v", got, c.want)
			}
		})
	}
}

func TestDecodeOpRejectsWhatItDoesNotKnow(t *testing.T) {
	lines := map[string]string{
		"empty":            ``,
		"blank":            `   `,
		"not json":         `hello`,
		"not an object":    `[1,2]`,
		"no op":            `{"infoHash":"x"}`,
		"unknown op":       `{"op":"explode"}`,
		"serve with no id": `{"op":"serve","infoHash":"x"}`,
		"serve bad type":   `{"op":"serve","id":"seven","infoHash":"x"}`,
		"limits bad type":  `{"op":"limits","readahead":"big"}`,
		"let_go no hash":   `{"op":"let_go"}`,
	}
	for name, line := range lines {
		t.Run(name, func(t *testing.T) {
			if got, err := DecodeOp([]byte(line)); err == nil {
				t.Fatalf("DecodeOp(%q) = %#v, want an error", line, got)
			}
		})
	}
}

func TestEventsAreSpelledAsTheSpecSpellsThem(t *testing.T) {
	const hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
	cases := []struct {
		name  string
		event any
		want  string
	}{
		{"ready", ReadyEvent(), `{"ev":"ready"}`},
		{"served", ServedEvent(4, "http://127.0.0.1:5000/tok/"+hash+"/4"), `{"ev":"served","id":4,"url":"http://127.0.0.1:5000/tok/` + hash + `/4"}`},
		{"refused", RefusedEvent(5, "Not a torrent."), `{"ev":"refused","id":5,"sentence":"Not a torrent."}`},
		{"status", StatusEvent(hash, PhaseFinding, 0, 0), `{"ev":"status","infoHash":"` + hash + `","phase":"finding","peers":0,"rate":0}`},
		{"status fetching", StatusEvent(hash, PhaseFetching, 12, 4200000), `{"ev":"status","infoHash":"` + hash + `","phase":"fetching","peers":12,"rate":4200000}`},
		{"chosen", ChosenEvent(hash, 2, "film.mkv"), `{"ev":"chosen","infoHash":"` + hash + `","fileIdx":2,"name":"film.mkv"}`},
		{"failed no_file", FailedEvent(hash, FailNoFile, "This torrent holds no files."), `{"ev":"failed","infoHash":"` + hash + `","kind":"no_file","sentence":"This torrent holds no files."}`},
		{"failed storage", FailedEvent(hash, FailStorage, "Disk full."), `{"ev":"failed","infoHash":"` + hash + `","kind":"storage","sentence":"Disk full."}`},
		{"failed other", FailedEvent(hash, FailOther, "Something."), `{"ev":"failed","infoHash":"` + hash + `","kind":"other","sentence":"Something."}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := json.Marshal(c.event)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != c.want {
				t.Fatalf("got %s, want %s", got, c.want)
			}
		})
	}
}

func TestEmitterWritesOneObjectPerLine(t *testing.T) {
	var buf bytes.Buffer
	e := NewEmitter(&buf)
	if err := e.Send(ReadyEvent()); err != nil {
		t.Fatal(err)
	}
	if err := e.Send(RefusedEvent(1, "Line one\nline two.")); err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(buf.String(), "\n"), "\n")
	if len(lines) != 2 {
		t.Fatalf("want 2 lines, got %d: %q", len(lines), buf.String())
	}
	for _, line := range lines {
		var v map[string]any
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatalf("line %q is not one JSON object: %v", line, err)
		}
	}
}

func TestNormaliseInfoHash(t *testing.T) {
	const lower = "08ada5a7a6183aae1e09d831df6748d566095a10"
	if got, ok := NormaliseInfoHash(strings.ToUpper(lower)); !ok || got != lower {
		t.Fatalf("got %q %v, want %q true", got, ok, lower)
	}
	for _, bad := range []string{"", "xyz", lower[:39], lower + "0", strings.Replace(lower, "0", "g", 1)} {
		if got, ok := NormaliseInfoHash(bad); ok {
			t.Fatalf("NormaliseInfoHash(%q) = %q, want a refusal", bad, got)
		}
	}
}

func TestTrackersOfSources(t *testing.T) {
	const hash = "08ada5a7a6183aae1e09d831df6748d566095a10"
	got := TrackersOf([]string{
		"tracker:udp://a.example:1337/announce",
		"dht:" + hash,
		"tracker:http://b.example/announce",
		"udp://bare.example:6969/announce",
		"tracker:",
		"nonsense",
	})
	want := []string{
		"udp://a.example:1337/announce",
		"http://b.example/announce",
		"udp://bare.example:6969/announce",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
