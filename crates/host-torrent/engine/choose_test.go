// SPDX-License-Identifier: GPL-3.0-or-later

package main

import "testing"

func TestChooseFilePlaceholder(t *testing.T) {
	cases := []struct {
		name    string
		sizes   []int64
		fileIdx *int
		want    int
		ok      bool
	}{
		{"a fileIdx in range", []int64{10, 500, 20}, ptr(2), 2, true},
		{"a fileIdx at the first file", []int64{10, 500, 20}, ptr(0), 0, true},
		{"a fileIdx past the end falls back to the largest", []int64{10, 500, 20}, ptr(3), 1, true},
		{"a negative fileIdx falls back to the largest", []int64{10, 500, 20}, ptr(-1), 1, true},
		{"no fileIdx is the largest", []int64{10, 500, 20}, nil, 1, true},
		{"the first of equal largest wins", []int64{500, 500, 20}, nil, 0, true},
		{"one file", []int64{42}, nil, 0, true},
		{"no files", nil, nil, 0, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, ok := chooseFile(c.sizes, c.fileIdx)
			if ok != c.ok || (ok && got != c.want) {
				t.Fatalf("chooseFile(%v, %v) = %d, %v; want %d, %v", c.sizes, c.fileIdx, got, ok, c.want, c.ok)
			}
		})
	}
}
