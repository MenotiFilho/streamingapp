# Norigin spike — the evidence behind the research note

This folder preserves the throwaway spike described in
[`../norigin-spatial-navigation.md`](../norigin-spatial-navigation.md). It is
evidence, not a package: **there is deliberately no `package.json`, lockfile or
dependency in the repository.** The commands below install into a temporary
directory.

The note's §3.1/§3.2 cite these exact files:

| File | Lines | What it is |
|---|---:|---|
| `spike.tsx` | 399 | React slice: base shell + rail + two row tracks, a pushed Title level, a popover, the player ladder, a dynamic row track, a search field, and the #128 attempts. |
| `spike.test.tsx` | 305 | 14 Vitest tests; all passing on 2026-10-22. |
| `entry-slice.ts` | 10 | Bundle entry for the exports the slice uses. |
| `entry.ts`, `entry-core.ts`, `entry-react.ts`, `entry-baseline.ts` | 6 total | Bundle entries for the whole API surface, core alone, hooks alone, and an empty React baseline. |
| `vitest.config.ts`, `tsconfig.json` | 23 total | The configuration used for the run. |

## Reproduce the tests

```sh
work=$(mktemp -d)
mkdir -p "$work/src"
cp spike.tsx spike.test.tsx "$work/src/"
cp vitest.config.ts tsconfig.json "$work/"
cd "$work"
npm init -y
npm install --no-save \
  react@19.3.1 react-dom@19.3.1 \
  @noriginmedia/norigin-spatial-navigation-core@4.1.2 \
  @noriginmedia/norigin-spatial-navigation-react@3.3.0 \
  @testing-library/react@16.3.3 @testing-library/dom@10.4.2 \
  jsdom@30.1.2 vitest@5.0.4 typescript@5.9.3 \
  @types/react@19.3.0 @types/react-dom@19.3.0 \
  @vitest/coverage-v8@5.0.4 esbuild@0.28.2
npx tsc --noEmit
npx vitest run
```

The single `npm install --no-save` keeps the optional coverage and bundle tools
from pruning the test dependencies: with no `package.json` dependencies, a
second `--no-save` install removes the first one's packages.

Expected: `14 passed (14)` in one file, about 2 seconds. The
`configLoader: 'native'` warning on stderr is Vitest noting the config is ESM
loaded as CommonJS; it does not affect the run.

## Reproduce the coverage figure

```sh
cd "$work"
npx vitest run --coverage
```

Reported on 2026-10-22 for `spike.tsx` only (the test file is excluded):

| Statements | Branches | Functions | Lines |
|---:|---:|---:|---:|
| 94.44% (68/72) | 84.00% (42/50) | 90.90% (30/33) | 96.92% (63/65) |

Uncovered lines are `spike.tsx:326` (the ladder resolver's `return null`) and
`:373` (the `remove-b` button; the tests remove `c` instead).

## Reproduce the bundle figure

```sh
cp entry*.ts "$work/"
cd "$work"
npx esbuild entry-core.ts --bundle --minify --format=esm --external:react --outfile=out/core.js
npx esbuild entry-slice.ts --bundle --minify --format=esm --external:react --outfile=out/slice.js
npx esbuild entry-baseline.ts --bundle --minify --format=esm --external:react --outfile=out/baseline.js
wc -c out/core.js out/slice.js out/baseline.js
gzip -9n -c out/core.js | wc -c
gzip -9n -c out/slice.js | wc -c
```

The note records 53,217 B minified / 17,081 B gzip for core, 55,561 B minified /
17,844 B gzip for core + the hooks the slice imports, and 69 B / 83 B for the
empty baseline. This is an isolated esbuild measurement, not the app's Vite
build (§10 of the note).

## Caveats

- jsdom has no layout. The spike's `LayoutAdapter` reads `data-rect` attributes,
  so every rectangle is the test's own number; this is not a browser layout.
- No production file is imported. The slice reproduces shapes, not the app's
  screens.
- `debug: true` is on so a failed navigation prints the library's candidate
  list; it is noisy but useful when a test moves unexpectedly.
