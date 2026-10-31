# Building, embedding, and serving the two-entry Remote

**Ticket:** #189 (wayfinder map #187). **Captured on:**
`research/remote-build-and-serve` @ `fc793a9`. **Read:** 2026-10-31.

This is the build/serve half of the map: the Remote becomes a React client of the
same tree as the window (a second Vite entry, `remote.html`), its built artifact
is committed and compiled into `host-wire`, and the Host serves it from `/next`
until one cutover. The companion inventory is
`docs/research/remote-window-duplication.md` (#188); the core boundary, the kit
and the sequence are #190–#193.

Read with `CONTEXT.md` (*Remote client*, *Cast Remote*, *Device*, *Snapshot*,
*Action*, *Level*), ADR-0017 (the wire and the one page), ADR-0018 (the Remote is
the window's equal), ADR-0030/ADR-0031 (the repertory sheet and Motion),
ADR-0032 (tests assert decisions), `docs/agents/testing.md`,
`docs/agents/ci.md`, and `AGENTS.md`.

**What this note supersedes, explicitly.** ADR-0017 §2 and §9 and ADR-0018 §1
rejected a build step for the served Remote; ADR-0031 §1 made Motion a separate
version-pinned vendor asset. This note recommends the build step the map already
settled on, and replaces the vendor asset with a bundled chunk. The *principle*
those ADRs protect is kept: the page travels with the binary, is served by the
Host, and fetches nothing outside it for its own assets. The explicit ADR
supersession is ADR-0035's; this note records the contradiction so it is not
mistaken for an accident.

## Sources, and what each one is

| Source | URL | What it grounds |
|---|---|---|
| Vite 8 — Building for Production | <https://vite.dev/guide/build.html> | the default `index.html` build entry, multi-page `input`, `base` rewriting, the hashed output example |
| Vite 8 — Build Options | <https://vite.dev/config/build-options.html> | `outDir`, `assetsDir`, `emptyOutDir`, `copyPublicDir`, `manifest`, `license`, `rolldownOptions`, `minify` |
| Vite 8 — Shared Options | <https://vite.dev/config/shared-options.html> | `base`, `publicDir`, top-level `input` |
| Vite 8 — Server Options | <https://vite.dev/config/server-options.html> | `server.proxy` with `ws: true`, `server.host` |
| Vite 8 — Static Asset Handling | <https://vite.dev/guide/assets.html> | public assets as root-absolute URLs; `url()` handling; hashed assets |
| Vite 8 — Configuring Vite | <https://vite.dev/config/> | TS config files and the bundled config loader |
| Rolldown — `output.entryFileNames` | <https://rolldown.rs/reference/OutputOptions.entryFileNames> | `[name]`, `[hash]` is content-based and includes referenced file hashes |
| Tauri 2 — Configuration reference | <https://v2.tauri.app/reference/config/> | `frontendDist` is read recursively and embedded in the binary; the list form; `beforeBuildCommand` |
| Rust std — `include_str!` | <https://doc.rust-lang.org/std/macro.include_str.html> | UTF-8 file as `&'static str`, path relative to the current file |
| Rust std — `include_bytes!` | <https://doc.rust-lang.org/std/macro.include_bytes.html> | file as `&'static [u8; N]`, path relative to the current file |
| `include_dir` crate | <https://docs.rs/include_dir/latest/include_dir/> | `include_dir!`, `$CARGO_MANIFEST_DIR`, `Dir::get_file`, `files`, the nightly `track_path` caveat |
| Cargo — Build Scripts | <https://doc.rust-lang.org/cargo/reference/build-scripts.html> | `cargo::rerun-if-changed`; a directory is scanned for modifications |
| MDN — `Cache-Control` | <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control> | `no-store`, `immutable`, and the cache-busting pattern |
| RFC 9239 — JavaScript media types | <https://www.rfc-editor.org/rfc/rfc9239> | `text/javascript` is the current type; `application/javascript` is obsolete |
| GitHub Actions — Workflow syntax | <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax> | the `if`/`run` shape of the CI step |
| This repo — `crates/host-wire/src/remote.rs` | — | the current compiled-in page, the six splices, the `/fonts` and `/motion-…` routes, the parity tests |
| This repo — `crates/host-wire/src/http.rs` | — | `write_document` (`no-store`), `write_immutable_asset`, `write_asset` (1 h), `write_permanent_redirect` |
| This repo — `crates/host-wire/tests/wire.rs` | — | the root page test and the `/next` → `/` redirect test |
| This repo — `package.json`, `vite.config.ts`, `src-tauri/tauri.conf.json` | — | Vite 8.3.4, port 1420, `frontendDist: ../dist`, `beforeBuildCommand: pnpm build` |
| This repo — `.github/workflows/ci.yml`, `.github/scripts/dev-run.sh`, `docs/agents/ci.md` | — | the `verify` job, the docs-only skip, the container runner |
| This repo — `scripts/build-remote-motion.mjs` | — | the current separate Motion vendor build |
| This repo — `src/shell/repertory/remotePage.test.ts`, `src/shell/remoteFocus.test.ts` | — | the two TypeScript suites that read the hand-written page as text |
| Local probe — Vite 8.3.4 | — | the exact two-entry chunking, `base`/`publicDir` behaviour, and artifact layout in §2 |

## 0. The answer in one paragraph

Build the window and the Remote with **two Vite builds**, not one two-entry
build: `pnpm build` keeps `index.html` → `dist` (what Tauri's `frontendDist`
embeds), and `pnpm build:remote` builds `remote.html` with `base: "/next/"` into
`crates/host-wire/remote-next/`, which is committed and embedded with
`include_dir!` (plus a one-line `build.rs` `rerun-if-changed`, because
`include_dir`'s directory tracking is first-class only on nightly). The Host
serves `/next` (308 to `/next/`), `/next/` (HTML, `no-store`), and
`/next/assets/<hashed>` (`immutable`), while `/fonts/*` stays the existing route
because the Remote build sets `publicDir: false`, which leaves the token sheet's
absolute `url("/fonts/…")` untouched. `cargo test` never runs pnpm: the artifact
is in the tree, so the macro compiles it. CI rebuilds the artifact and fails on
any `git status --porcelain -- crates/host-wire/remote-next` output, so a stale
bundle cannot land. The dev loop is the existing `pnpm dev`, which serves
`/remote.html` beside `/`, with a Vite proxy path `/host` → the Host's
WebSocket; the production page uses `location.host` and `/`. At cutover the
build flips to `base: "/"`, the artifact moves to `crates/host-wire/remote/`,
`/` serves it, `/next` redirects to `/`, and the hand-written page, the six
splices, the separate Motion asset, `remotePage.test.ts` and
`remoteFocus.test.ts` are deleted. The parity assertions that survive are the
build-info JSON (Actions and wire version) read by a Rust test, and the shared
`src/core` modules: one key-intent table, one icon sprite, one token sheet, one
set of JSON lists — drift is prevented by compilation instead of by comparing
two texts.

## 1. Two entries, two builds — and why one build is the wrong shape

Vite 8's build entry defaults to `<root>/index.html`; a second `.html` file is
built only when it is named in the `input` option:

> "By default, it uses `<root>/index.html` as the build entry point…"
> — [Vite, Building for Production](https://vite.dev/guide/build.html)

> "During build, all you need to do is specify multiple `.html` files as entry
> points…"
> — same page

So the window build can stay exactly as it is: `vite.config.ts` has no `input`,
`pnpm build` emits `dist/index.html` plus `dist/assets/*`, and Tauri's
`frontendDist: "../dist"` embeds that tree. The Remote gets its own config:

```ts
// vite.remote.config.ts — build only; `pnpm dev` uses vite.config.ts for both entries
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { ACTION_SPELLINGS } from "./src/core/action-spellings";
import { ACTION_VERSION } from "./src/core/version";

function buildInfo(): Plugin {
  return {
    name: "remote-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source:
          JSON.stringify(
            { format: 1, wireVersion: ACTION_VERSION, actions: ACTION_SPELLINGS },
            null,
            2,
          ) + "\n",
      });
    },
  };
}

export default defineConfig({
  // `pnpm build:remote` is run from the repo root, as `pnpm build` is. Keeping
  // these relative means the config needs no `node:path` and no `@types/node`
  // in the typechecked project.
  root: ".",
  plugins: [react(), buildInfo()],
  base: "/next/",
  // The token sheet's @font-face URLs are root-absolute (`/fonts/…`); the Host
  // serves them. Disabling the public dir leaves those URLs untouched instead
  // of rewriting them to `/next/fonts/…`.
  publicDir: false,
  input: "remote.html",
  build: {
    outDir: "crates/host-wire/remote-next",
    // outDir is outside the project root, so Vite would otherwise warn and not
    // clear stale hashed files.
    emptyOutDir: true,
    // Vite 8 emits the bundled dependencies' licences; Motion's MIT notice is
    // the one the old vendor bundle carried in its banner.
    license: { fileName: "licenses.md" },
    rolldownOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
```

`root: "."` is the repo root because `pnpm build:remote` is run there, the same
assumption `pnpm build` already makes. If the config ever needs to be run from
another directory, add `@types/node` and resolve the three paths from
`import.meta.url`; the relative form is chosen here so the typechecked project
needs no Node types.

Vite 8 builds with Rolldown; `build.rollupOptions` is a deprecated alias, so the
new config uses `build.rolldownOptions` (the Vite 8 build-options page says so:
"`build.rollupOptions` … **Deprecated** … Use `build.rolldownOptions`"). The
`[hash]` placeholder is content-based:

> "`[hash]`: A hash based only on the content of the final generated chunk,
> including transformations in `renderChunk` and any referenced file hashes."
> — [Rolldown, `entryFileNames`](https://rolldown.rs/reference/OutputOptions.entryFileNames)

### 1.1 What a single two-entry build actually does

A local probe with the repo's Vite 8.3.4, two HTML entries sharing one module,
produced:

```
dist-two/assets/main-z7EJz9IO.js
dist-two/assets/remote-Bgwa511L.js
dist-two/assets/remote-CfapT0pI.css
dist-two/assets/shared-B-qsYHnB.js      ← used by both entries
dist-two/index.html
dist-two/remote.html
dist-two/fonts/probe.woff2              ← public/ copied into dist
```

The shared chunk is the point. Rolldown's default code splitting hoists a module
both entries import into one chunk
([Vite's chunking-strategy note](https://vite.dev/guide/build.html#chunking-strategy)
points at Rolldown's `codeSplitting`). If both entries are built into `dist`,
Tauri embeds the whole tree recursively:

> "When a path relative to the configuration file is provided, it is read
> recursively and all files are embedded in the application binary."
> — [Tauri 2, `frontendDist`](https://v2.tauri.app/reference/config/#buildconfig)

So `dist` would contain the Remote's HTML, its entry, its CSS **and** a shared
chunk the window also needs. To keep the Remote out of the Tauri bundle you
would have to delete the Remote's files after the build; deleting the shared
chunk breaks the window, and keeping it means the Remote's code (or part of it)
is in the Tauri binary anyway. The alternative — `frontendDist` as a list of
files — does not help with hashed names:

> "You can also provide a list of paths to be embedded, which allows granular
> control over what files are added to the binary. In this case, all files are
> added to the root and you must reference it that way in your HTML files."
> — same page

The list is static in `tauri.conf.json`; Vite's hashes are not. Two builds make
the boundary explicit and each build has one entry, so there are no cross-entry
shared chunks.

### 1.2 The two products, and what "ships twice" means

- **Window** — `index.html` → `dist`; Tauri embeds `dist` once. The window's
  `public/fonts/*` is copied into `dist` and embedded there.
- **Remote** — `remote.html` → `crates/host-wire/remote-next`; `host-wire`
  compiles that directory once. It is not under `dist`, so Tauri's
  `frontendDist` never sees it. The Remote's own bytes ship **once**.
- **Shared source, not shared bytes** — React, Motion, `tokens.css`, the JSON
  lists and the pure modules are compiled into both bundles. That is two
  clients each carrying their own copy, not the Remote being duplicated inside
  the Tauri bundle. It is unavoidable without a shared runtime chunk, and a
  shared chunk is exactly what makes the Tauri exclusion impossible.
- **Fonts** — the Remote build does not copy `public/`. The four woff2 faces are
  already embedded once in `host-wire` (the existing `FONT_*` constants) and
  served at `/fonts/<name>` for both pages; the Tauri bundle carries its own
  copy for the window. That second copy is the window's, not the Remote's.

If the goal were to minimise the executable, the next step would be to stop
embedding the faces twice (serve them from the Remote's artifact, or hashed
imports), but that changes the window's asset pipeline and is not this ticket.

## 2. The artifact: path, layout, and what is in it

```
crates/host-wire/remote-next/
├── remote.html                 # the built document, asset URLs under /next/
├── build-info.json             # emitted by the plugin: format, wireVersion, actions
├── licenses.md                 # Vite 8 build.license; Motion's MIT notice
└── assets/
    ├── remote-<hash>.js        # entry (and a lazy Motion chunk, if motion is dynamic)
    ├── remote-<hash>.css       # tokens.css + the Remote's sheets
    └── <chunk>-<hash>.js       # only if the screen tree introduces dynamic imports
```

Everything in this directory is generated; `emptyOutDir` deletes anything
hand-written, so a README or a `.gitkeep` does not belong here.

The probe with a stub importing React and Motion (dynamic import not yet
exercised) produced exactly:
```
artifact-full/build-info.json
artifact-full/licenses.md
artifact-full/remote.html
artifact-full/assets/remote-lospuqut.js     68.42 kB │ gzip: 24.66 kB
artifact-full/assets/remote-CfapT0pI.css
```

and `licenses.md` listed `framer-motion 14.7.1 (MIT)`, `motion-dom` and
`motion-utils`. The real screen tree will be larger; the shape is what matters.

The build must be **deterministic**: no build timestamp, git SHA, absolute path,
or locale-dependent text in `build-info.json` or the assets. If any of those
enter the artifact, the CI staleness check is guaranteed to fail on a clean
rebuild. The current Motion script has no timestamp for the same reason.

`build.emptyOutDir` matters because `outDir` is outside the project root:

> "By default, Vite will empty the `outDir` on build if it is inside project
> root. It will emit a warning if `outDir` is outside of root to avoid
> accidentally removing important files. You can explicitly set this option to
> suppress the warning."
> — [Vite, Build Options](https://vite.dev/config/build-options.html#build-emptyoutdir)

`build.license` is a Vite 8 feature:

> "When set to `true`, the build will generate a `.vite/license.md` file that
> includes all bundled dependencies' licenses. If `fileName` is passed, it will
> be used as the license file name relative to the `outDir`."
> — [Vite, Build Options](https://vite.dev/config/build-options.html#build-license)

The probe with `license: { fileName: "licenses.md" }` wrote `licenses.md` at the
artifact root, not under `.vite/`.

`build.manifest` is not needed. The Rust tests can enumerate the embedded
directory with `Dir::files()`; the HTML already names its own hashed entry. A
manifest would add a second generated file with no consumer.

### 2.1 The `/fonts` URL decision

`src/shell/repertory/tokens.css` declares the faces with root-absolute URLs:

```css
@font-face { font-family: "Bodoni Moda"; src: url("/fonts/bodoni-moda-latin-wght-normal.woff2") format("woff2"); }
```

Vite's `base` rewrites asset URLs in CSS, but the public directory is special.
With `base: "/next/"` and the default `publicDir`, the probe's CSS became
`url(/next/fonts/probe.woff2)`; with `publicDir: false` it stayed
`url(/fonts/probe.woff2)` and Vite printed:

```
/fonts/probe.woff2 referenced in /fonts/probe.woff2 didn't resolve at build time,
it will remain unchanged to be resolved at runtime
```

That warning is the desired outcome, not a failure: the Host owns `/fonts`, not
the bundle. A `publicDir: false` build does not copy the faces into the
artifact, so `host-wire` keeps serving the same four `include_bytes!` faces it
serves today, and the Remote and the legacy page share them. The built CSS is
therefore the thing to test: every `@font-face` URL in the built CSS must still
be `/fonts/<name>` and every name must be one `host-wire` serves. If a future
Vite changes the rewriting, that test fails before the artifact is committed.

Rejected alternative: `experimental.renderBuiltUrl` with `type === "public"`
returning `"/" + filename`. A probe shows it works (CSS stayed `/fonts/…`,
hashed assets stayed `/next/…`), but it is an experimental API for a build that
must be reproducible. `publicDir: false` uses documented behaviour and gives the
same result.

Rejected alternative: copying `public/` into the artifact. It removes the
warning but duplicates ~100 KB of woff2 in the binary and rewrites the URLs to
`/next/fonts/…`; the faces would then exist twice in `host-wire` (the old
constants and the artifact) during coexistence. Not worth it.

## 3. Embedding in `host-wire`

### 3.1 Which macro

| Macro | What it takes | What it gives | Why it does or does not fit |
|---|---|---|---|
| `include_str!` | one literal file path | `&'static str` | The HTML is one file and is UTF-8, so it fits the document. It cannot name a hashed `assets/remote-<hash>.js`. |
| `include_bytes!` | one literal file path | `&'static [u8; N]` | Fits a known, fixed file. Hashed names are not known until the build; a new hash would need a source edit. |
| `include_dir!` | one directory path (env vars interpolated) | `Dir`, with `get_file`, `files`, `entries` | Fits a whole artifact whose file names are generated. One macro, no generated Rust. |

The standard macros are compile-time only and resolve paths relative to the
current file (`include_str!`: "The file is located relative to the current file
… The provided path is interpreted in a platform-specific way at compile
time"; `include_bytes!` the same). `include_dir!` is explicitly "an extension to
the `include_str!()` and `include_bytes!()` macro for embedding an entire
directory tree", and recommends `$CARGO_MANIFEST_DIR` because "rustc makes no
guarantees about the current directory when it is running a procedural macro".

Use:

```rust
// crates/host-wire/src/remote_next.rs
use include_dir::{include_dir, Dir};

static NEXT: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/remote-next");

fn next_document() -> &'static str {
    NEXT.get_file("remote.html")
        .and_then(|file| file.contents_utf8())
        .expect("the committed Remote artifact carries remote.html")
}

fn next_file(path: &str) -> Option<&'static [u8]> {
    NEXT.get_file(path).map(|file| file.contents())
}
```

`Dir::get_file` and `File::contents` are the documented API; `Dir::files()`
enumerates for the tests. The HTML is read from the same `Dir` rather than a
second `include_str!` so its bytes are embedded once.

### 3.2 Rebuild tracking

`include_dir`'s crate page says the `nightly` feature "enables nightly APIs like
`track_path` … This gives the compiler more information about what is accessed
by the procedural macro, enabling better caching." Without it, a newly added
file is not in rustc's dep-info until something else causes the macro to
re-expand. The generated HTML changes whenever an asset hash changes, so a
normal rebuild is usually enough — but "usually" is not a guarantee for a
committed artifact. Add the smallest stable guarantee:

```rust
// crates/host-wire/build.rs
fn main() {
    println!("cargo::rerun-if-changed=remote-next");
}
```

Cargo's build-script documentation is exact:

> "If the path points to a directory, it will scan the entire directory for any
> modifications."
> — [Cargo, Build Scripts](https://doc.rust-lang.org/cargo/reference/build-scripts.html#rerun-if-changed)

The build script does **not** run Vite. It only tells Cargo to rerun when the
committed artifact changes, so a new/removed hashed file invalidates the crate
and the macro re-expands. The repository's Rust floor is 1.85
(`Cargo.toml`), so the `cargo::` syntax is available.

`Cargo.toml` additions:

```toml
# [workspace.dependencies]
include_dir = "0.7"

# crates/host-wire/Cargo.toml
[dependencies]
include_dir = { workspace = true }

[dev-dependencies]
serde = { workspace = true }   # the build-info deserialize in the test
```

`Cargo.lock` changes with it. `include_dir` is MIT and adds one small proc-macro
dependency; it compiles the artifact's bytes into the `host-wire` rlib, so the
final executable carries them once.

## 4. Serving from `/next`

### 4.1 Route table

| Request | Answer | Cache-Control |
|---|---|---|
| `GET /next` | `308 Permanent Redirect` → `/next/` | `no-store` |
| `GET /next/` | `remote.html`, `text/html; charset=utf-8`, `no-store` | `no-store` |
| `GET /next/remote.html` | same document (an alias for debugging) | `no-store` |
| `GET /next/assets/<name>` | the embedded file, MIME by extension | `public, max-age=31536000, immutable` |
| `GET /next/build-info.json` | `404` (an internal contract, not a client asset) | — |
| `GET /next/licenses.md` | `404`, or `text/markdown` if the Credits screen links it | `no-store` |
| `GET /next/assets/../remote.html` | `404`; the route accepts one file name | — |
| `GET /next/<anything else>` | `404` | — |

The `/next` → `/next/` redirect is a change from today's `/next` → `/` (the
post-#160 redirect). The staging route is being reused, so the old redirect
target is no longer right. The existing test
`the_staging_route_redirects_permanently_to_the_root`
(`crates/host-wire/tests/wire.rs`) must become a staging-route test during
coexistence: `/next` is now a document, not a redirect. At cutover the redirect
assertion returns (to `/`), and the root-page assertion changes to the React
shell.

The staging is a **route**, not an attribute. The #152 mechanism (`data-ui`,
`?ui`) was removed at #160; the current test
`the_repertory_surface_is_served_at_the_root_without_a_staging_attribute`
pins its absence. `/next` is a second document served beside `/`; the cutover
changes which document `/` serves. Nothing in the React Remote reads a staging
flag, so a reload on `/next` after the cutover follows the redirect to `/`
rather than keeping a half-staged surface.

### 4.2 MIME and cache

The Host already has the three response shapes this needs:

- `http::write_document` — `no-store`, for the HTML and the 404;
- `http::write_immutable_asset` — `public, max-age=31536000, immutable`, for the
  hashed assets;
- `http::write_asset` — `public, max-age=3600`, for the unhashed `/fonts/*`
  faces.

Use the extension to choose the type; do not sniff:

| Extension | Content-Type |
|---|---|
| `.html` | `text/html; charset=utf-8` |
| `.js` | `text/javascript; charset=utf-8` |
| `.css` | `text/css; charset=utf-8` |
| `.svg` | `image/svg+xml` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |
| `.woff2` | `font/woff2` |
| `.json` | `application/json` |
| `.md` | `text/markdown; charset=utf-8` |

`text/javascript` is the current spelling in `remote.rs` and the one RFC 9239
recommends; `application/javascript` is obsolete. An unknown extension is a
`404`, not `application/octet-stream`: every file in a committed artifact
should have a type the Host knows, and a test enumerates them.

The HTML is `no-store` for the same reason the current page is: its asset URLs
are content-hashed, so a new build produces new URLs, but the HTML's own URL
(`/next/`) never changes. If the HTML were cached, a phone could keep an old
HTML pointing at an asset the new artifact no longer contains (Vite's
`emptyOutDir` removes the old hash), and the page would 404. MDN's cache-busting
guidance says exactly this: long `max-age` + `immutable` for the hashed assets,
and a non-cached HTML response
([MDN, `Cache-Control`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control#caching_static_assets_with_cache_busting)).
`immutable` is justified only because the filename is the hash:

> "When you use a cache-busting pattern for resources and apply them to a long
> `max-age`, you can also add `immutable` to avoid revalidation."
> — same page

The `/fonts/*` faces are **not** content-hashed, so they stay at the existing
one-hour cache; do not mark them `immutable`.

### 4.3 The asset-name seam

Do not pass a request path straight into `get_file`. A pure function is the
decision seam and the test target:

```rust
/// The one file name a `/next/assets/` request may name.
fn asset_name(path: &str) -> Option<&str> {
    let name = path.strip_prefix("/next/assets/")?;
    (!name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && name != "."
        && name != ".."
        && !name.contains('%'))
    .then_some(name)
}
```

The artifact is an in-memory tree, so there is no filesystem traversal; the
check is still worth doing because a path like `../remote.html` would otherwise
be answered with HTML under a JavaScript content type. Tests cover `..`, `%2e`,
a trailing slash, an empty name and a name with a backslash.

### 4.4 What the Host serves, before and after the cutover

| Route | Before cutover | After cutover |
|---|---|---|
| `/` | the hand-written page, six splices, `remotePage.test.ts` | the built React Remote, `base: "/"` |
| `/next` | `308` → `/next/` | `308` → `/` |
| `/next/` | the built React Remote | `404` or redirect to `/` |
| `/next/assets/*` | hashed, immutable | `404` (the artifact now lives at `/assets/*`) |
| `/fonts/*` | same four faces, 1 h | same four faces, 1 h |
| `/motion-14.7.1.js` | the old vendor asset | gone; Motion is in the bundle |
| WebSocket upgrade | any path, really `/` | unchanged |
| `/favicon.ico` | 404 | 404 |

The WebSocket is unchanged. The page derives it from `location.host` and the
root path (`ws://host:8090/`), not from `location.pathname`; `/next` is only the
document's address. This is the same code the current page has at
`crates/host-wire/remote/index.html:2746-2749`.

## 5. Keeping `cargo test` free of a frontend build

This is the constraint that decides the artifact's existence:

- A fresh clone contains `crates/host-wire/remote-next/`. `include_dir!` reads it
  at compile time; `cargo test` never invokes `pnpm`, Node or Vite.
- `build.rs` only emits `cargo::rerun-if-changed`; it does not run a build. A
  build script that invoked Vite would make `cargo test` depend on Node, the
  pnpm store and the network, and would violate `AGENTS.md`'s rule and slow
  every Rust run.
- The artifact is inside the `host-wire` package, so `cargo package` includes it
  (the crate is `publish = false`; there is no packaging contract to preserve).
  `cargo test -p host-wire` is the fast loop; `cargo test --workspace` compiles
  the same bytes.
- `src-tauri`'s `frontendDist` is not touched by `cargo test`: in the default
  feature set Tauri uses `devUrl`, and the repo's `AGENTS.md` already states
  that `cargo test` needs no built frontend. The committed Remote artifact is
  unrelated to `dist`; a missing `dist` does not affect `host-wire`.
- The artifact is committed as bytes, not generated in `OUT_DIR`. A build script
  that generated Rust source from the directory would work too, but it is more
  code and another generated file; `include_dir!` + `rerun-if-changed` is the
  smaller mechanism.

## 6. CI staleness detection

The gate is **rebuild + `git status --porcelain`**, not `git diff`:

```yaml
      - name: Build the window
        if: steps.scope.outputs.code == 'true'
        run: .github/scripts/dev-run.sh pnpm build

      - name: Check the Remote artifact
        if: steps.scope.outputs.code == 'true'
        run: |
          set -euo pipefail
          .github/scripts/dev-run.sh pnpm build:remote
          status="$(git status --porcelain -- crates/host-wire/remote-next)"
          if [ -n "$status" ]; then
            printf '%s\n' "$status"
            echo "::error::the Remote artifact is stale; run pnpm build:remote and commit it"
            exit 1
          fi
          # The Remote must not slip into the Tauri frontend by a future input list.
          test ! -e dist/remote.html
```

Why this shape:

- **`git status --porcelain` covers untracked files.** A new hash is a new file;
  `git diff --exit-code` does not see it. The status check sees modified,
  deleted and untracked entries.
- **It runs after `pnpm build`, before `pnpm test` and `cargo test`.** The Rust
  tests then compile the artifact that was just proved current. If the step
  fails, the job stops before testing a stale artifact.
- **It runs on every code PR, not only when `src/remote/**` changes.** The
  artifact also depends on `src/shell/repertory/tokens.css`, the shared JSON
  lists, `src/assets/tmdb-logo.svg`, `src/core/**` and `package.json`/the
  lockfile. A path filter would miss the token sheet, which is the most likely
  source of a stale artifact.
- **The docs-only skip stays.** `docs/agents/ci.md` already short-circuits when
  every changed path is `.md` or under `docs/`; the new step is inside the
  `code == true` branch.
- **`dist` is checked for `remote.html`.** This is the cheap invariant that the
  window build did not accidentally add the second entry; if a future
  `vite.config.ts` grows an `input`, the Tauri bundle would otherwise start
  embedding the Remote and the "ships once" claim would quietly become false.

A local equivalent:

```sh
docker compose exec dev pnpm build:remote
git status --porcelain -- crates/host-wire/remote-next   # must print nothing
```

A small `scripts/check-remote-artifact.mjs` can wrap the `git status` check for
`pnpm check:remote`, but the CI shell above is enough and has no extra file.

What the gate does **not** catch, and why that is acceptable:

- **A source change with a byte-identical artifact.** That is not stale; the
  artifact is the same bytes.
- **A semantic rule that both clients share.** If `src/core/focus.ts` changes,
  both bundles change; the window's `focus.test.ts` and the Remote's component
  tests are the net. The artifact check only ensures the bundle was rebuilt.
- **A hand-edited artifact that still parses.** The build-info and the asset
  references are tested; a visual edit inside the minified JS is not reviewable
  and is why the artifact is generated, never edited. Keep nothing hand-written
  inside `crates/host-wire/remote-next/`: `emptyOutDir` deletes it on the next
  build. The "do not edit" note belongs in `vite.remote.config.ts` or beside the
  crate (`crates/host-wire/README.md`), not in the artifact.

## 7. The dev loop

### 7.1 One Vite server, both entries

`pnpm dev` stays the window's dev server. Vite serves any HTML file under the
root on demand, so `remote.html` is available at `/remote.html` without adding
it to the build `input`. The window is at `/`, the Remote at `/remote.html`.
Both get HMR from the same server and the same plugin list.

`vite.config.ts` gains a proxy for the Host's WebSocket and, for phone testing,
a LAN bind:

```ts
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // `HOST_` is a server-side prefix: loadEnv merges matching .env values with
  // process.env, and the value is never exposed to the page.
  const env = loadEnv(mode, ".", "HOST_");
  const hostWs = env.HOST_WS ?? "ws://127.0.0.1:8090";

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      // `pnpm tauri dev` starts this server; `host: true` lets a phone on the
      // owner's LAN reach /remote.html. Do not run this on an untrusted network.
      host: true,
      proxy: {
        "/host": {
          target: hostWs,
          ws: true,
          rewrite: (path) => path.replace(/^\/host/, ""),
        },
      },
    },
  };
});
```

Vite's proxy documentation supports exactly this: "Any requests whose request
path starts with that key will be proxied to the specified target"; the
WebSocket example uses `ws: true`
([Vite, Server Options](https://vite.dev/config/server-options.html#server-proxy)).
`loadEnv` "load[s] `.env` files within the `envDir` and merge[s] them with the
matching variables already present in `process.env`"
([Vite, JavaScript API](https://vite.dev/guide/api-javascript.html#loadenv)), so
`HOST_WS=ws://127.0.0.1:<port> pnpm dev` works from the shell and
`HOST_WS=…` in `.env.local` works too. The prefix is not `VITE_`, so the page
never sees it; it exists because the Host may bind an OS-chosen port when 8090 is
taken.

The page's transport has one seam that decides the URL:

```ts
// src/core/socket.ts
export function socketUrl(location: Pick<Location, "protocol" | "host">, dev: boolean): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${dev ? "/host" : "/"}`;
}
```

`src/remote/main.tsx` calls `socketUrl(location, import.meta.env.DEV)`. The
window's Tauri transport never calls it. The function is a pure decision and is
tested with both branches; the served page's branch is the one the phone uses,
so a dev-only path cannot leak into production.

### 7.2 Pairing in dev

- Start the Host (`pnpm tauri dev` on Windows; the container has no window) and
  the Vite server. Open `http://localhost:1420/remote.html` in a browser, or
  `http://<dev-machine>:1420/remote.html` on the phone.
- The page shows the pairing form. Read the six-character code from the Host's
  window and type it once. The `pair_device` Action travels through the Vite
  proxy to the Host's socket; the Host answers with the device and token.
- The token is stored in `localStorage` under the dev origin
  (`localhost:1420` or the LAN IP). The production page (`host:8090`) is a
  different origin and pairs separately. That is expected, not a bug: a device
  token is per origin in a browser.
- If the Host chose a port other than 8090, start with
  `HOST_WS=ws://127.0.0.1:<port> pnpm dev`; the proxy target moves, the page's
  `/host` path does not.
- The phone's `http://<host>:8090` origin is not a secure context, so the
  Gamepad API is not meaningfully available there (research #49); the Remote has
  no pad column for the same reason. A desktop browser on `localhost` is a
  secure context, but the served client is the phone, so the column stays out.

### 7.3 The served artifact in dev and release

The Host serves the **artifact compiled into the running Host** at `/next`, not
the Vite source. To see a source change through the Host's route, run
`pnpm build:remote`, restart the Host (the Rust binary must recompile to pick up
the new `include_dir!` bytes), and open `http://<host>:8090/next`. HMR is only on
the Vite URL.

Release:

```sh
docker compose exec dev pnpm build          # window -> dist
docker compose exec dev pnpm build:remote   # Remote -> crates/host-wire/remote-next
git status --porcelain -- crates/host-wire/remote-next   # commit if non-empty
# then the Windows build/verify route in AGENTS.md
```

`pnpm build` must stay window-only, or the Tauri bundle starts carrying the
Remote. The release build uses the committed artifact; the CI gate is what makes
that safe.

## 8. What happens to the serve-time splices, and to the parity tests

The general rule: **a splice exists because the hand-written page cannot import.
A React bundle imports.** At cutover every splice dies; during coexistence the
old page keeps its splices and its tests, and the new page uses imports.

| Today | In the React Remote | At cutover |
|---|---|---|
| `tokens.css` spliced through `/*__SPLICE_REPERTORY_TOKENS__*/` | `import "../shell/repertory/tokens.css"` (or the moved path); Vite bundles it into `assets/remote-<hash>.css` | splice code and marker die; the page-token test dies with the page; the source file stays one palette and `tokens.test.ts` keeps reading it |
| `remote/icons.svg` spliced as a symbol sprite | the kit's `icons.tsx` exports the symbols; the Remote renders the same components | `crates/host-wire/remote/icons.svg` and the page sprite/path parity test die; `icons.test.tsx` stays |
| `src/subtitle-languages.json` spliced | imported by the Remote's language picker | splice dies; the JSON stays the one list; the page-carry test dies with the page (there is no Host bound to compare it to) |
| `src/subtitle-appearance.json` spliced | imported by Settings | splice dies; the page-carry test dies; `the_shared_subtitle_appearance_list_agrees_with_the_hosts_bounds` stays (it reads the source file, not the page) |
| `src/stream-buffer.json` spliced | imported by Settings | splice dies; the page-carry test dies; `the_shared_stream_buffer_list_agrees_with_the_hosts_bounds` stays |
| `src/assets/tmdb-logo.svg` spliced | imported by the Credits component; Vite inlines it or emits `assets/tmdb-<hash>.svg` | splice dies; the page-attribution test dies; the attribution text is a component rule, tested where the words are chosen (ADR-0032 §4) |
| four woff2 faces served at `/fonts/*` | `tokens.css` keeps `url("/fonts/…")`; `publicDir: false` leaves it alone | unchanged; `host-wire` keeps the four `include_bytes!` constants and the 1 h cache |
| `Action::SPELLINGS` mirrored as a JSON block in the page | `src/core/action-spellings.ts` is the runtime list; `build-info.json` is emitted from it | page JSON block and `declared_capabilities(page)` die; the Rust test reads `build-info.json` and compares to `Action::SPELLINGS`; the TS list is typechecked against the `Action` union |
| `KEY_INTENTS` copied into the page and compared by `the_remote_keyboard_intents_are_the_windows` | `src/core/input.ts` is imported by both clients; the Remote's key handler calls `intentFor` | the cross-page text test dies; the core `input.test.ts` stays, and a Remote key test asserts the Action a key sends |
| `motion-14.7.1.js` built by `scripts/build-remote-motion.mjs`, served at `/motion-14.7.1.js` | `import("motion")` in the motion wrapper; Vite emits a hashed chunk or folds it into the entry; `build.license` records MIT | the script, the vendor file, `MOTION_PATH`/`MOTION`, the route and the banner test die; a test asserts `licenses.md` names Motion/MIT |
| `remotePage.test.ts` boots the spliced template in jsdom | the React Remote's component tests render `<RemoteApp transport={fake}>`; the core tests own the decisions | the file dies; its cases move as in §8.1 |
| `remoteFocus.test.ts` extracts `nearest` from the page text and compares it to the window's | both clients import `src/core/focus.ts`; the window's `focus.test.ts` is the net | the file dies; no replacement needed |

The `host-wire` wire suite (pairing, push, revoke, reconnection, version refusal,
rate limiting) is unchanged; it tests the protocol, not the page. The route tests
that assert copy change: `a_browser_is_served_the_remote_page_before_it_has_anything_to_say`
currently asserts `"Pair this device"` in the HTML. At cutover the served HTML is
the React shell (`<div id="root">` plus hashed scripts), so that test must assert
the document and its asset references; the pairing copy moves to the Remote's
component test. That is ADR-0032 applied to the one client that used to have no
seams.

### 8.1 `remotePage.test.ts` case by case

The file is 575 lines and three `describe` blocks. None of it should be ported
as DOM assertions; each case is a decision with a new home:

| Current case | New home |
|---|---|
| boots at `/`, takes a Snapshot, puts the transport on the card | `src/remote/app.test.tsx` smoke: render, welcome, snapshot, the strip and transport exist; pressing play sends `set_paused` |
| a drawer closes on Done even when its animation cannot run | `src/remote/sheet.test.tsx`: a throwing motion animator must not trap the drawer |
| a press on the ink around a drawer closes it | `src/remote/sheet.test.tsx`: backdrop dismiss is a decision, not a class |
| the cast clock moves between Snapshots | `src/core/playback.test.ts`: live position projection with fake time |
| a moving bitrate updates the statistics where they stand | `src/core/selectors.test.ts`: the sheet's redraw signature excludes volatile statistics; plus a component identity test if the drawer remount is the rule |
| a pushed Snapshot moves the transport's own state | `src/core/store.test.ts` (state) and a thin component test for the accessible label |
| a command in flight when the socket closes is refused | `src/core/pending.test.ts`: the in-flight Action rejects with `unreachable`; the copy is tested where the words are chosen |
| a closed socket is replaced and greets the Host | `src/core/connection.test.ts`: reconnect + `hello` |
| returning to the page probes at once | `src/core/connection.test.ts`: visibility + probe timeout |
| an idle socket is greeted again | `src/core/connection.test.ts` |
| a wake after a long sleep asks before reconnecting | `src/core/connection.test.ts` |
| a paired page keeps one history entry | `src/core/history.test.ts`: sentinel and token storage |
| a Back unwinds a surface | `src/core/navigation.test.ts` |
| a Back at rest warns | `src/core/history.test.ts` |
| a Snapshot after the warning is not a navigation | `src/core/history.test.ts` |
| a reconnect Welcome is not a navigation | `src/core/history.test.ts` |
| a Back closes a Level | `src/core/navigation.test.ts` (ADR-0034) |

The `FakeSocket` in the old test is the right shape for the core connection
tests; inject it through the transport seam instead of assigning
`window.WebSocket`. The old test's jsdom `beforeParse` becomes the component
test's setup, not a global.

### 8.2 The capability and key-intent assertions, in detail

**Action surface.** Today `crates/host-wire/src/remote.rs` reads a JSON block
out of the page (`id="action-capabilities"`) and compares it to
`host_core::Action::SPELLINGS`. In React there is no page-level JSON block to
read, so the list moves into a pure TS module and is emitted into the artifact:

```ts
// src/core/action-spellings.ts — no runtime imports; the Vite config imports this in Node
import type { Action } from "./actions";

export const ACTION_SPELLINGS = [
  "set_subtitle_language",
  // … every Action spelling, in declaration order …
] as const satisfies readonly Action["type"][];

// The list cannot omit an Action the union has.
type Missing = Exclude<Action["type"], (typeof ACTION_SPELLINGS)[number]>;
type AssertAllListed<T extends never> = T;
export type _EveryActionIsListed = AssertAllListed<Missing>;
```

The `satisfies` half rejects an extra spelling; `AssertAllListed<Missing>` is the
compile-time check that rejects a missing one: if `Missing` is anything but
`never`, the alias fails to instantiate and `tsc` refuses the build. (A bare
`Missing extends never ? true : never` would only produce `never`; it would not
fail.) `tsc` is the first gate. The Vite plugin writes the same array into
`build-info.json`; the Rust test is the second gate:

```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    format: u32,
    wire_version: u16,
    actions: Vec<String>,
}

#[test]
fn the_remote_build_info_is_the_action_surface() {
    let info: BuildInfo = serde_json::from_str(build_info()).expect("build-info.json is JSON");
    assert_eq!(info.format, 1);    assert_eq!(info.wire_version, host_core::ACTION_VERSION);
    let declared: BTreeSet<&str> = info.actions.iter().map(String::as_str).collect();
    let surface: BTreeSet<&str> = host_core::Action::SPELLINGS.iter().copied().collect();
    assert_eq!(declared, surface, "the built Remote declares the Action surface exactly");
}
```

`host-wire`'s dev-dependencies gain `serde = { workspace = true }` for the
derive (the crate already depends on `serde_json`); the alternative is to parse
`serde_json::Value` and compare its fields, which avoids the extra dependency at
the cost of a less readable test.

The runtime dispatcher also refuses an Action whose spelling is not in
`ACTION_SPELLINGS`, as the hand-written page does; that is the declaration's
load-bearing use, not just a test fixture. The gates close in every direction:

- a spelling added to Rust but not to TS fails the Rust test (the built list is
  missing it);
- a spelling added to TS but not to Rust fails the Rust test once the artifact is
  rebuilt, and fails the CI staleness check if it is not rebuilt;
- a spelling added to both but not rebuilt fails the Rust test (the artifact's
  list is old) *and* the CI staleness check;
- a spelling added to both and rebuilt passes.

There is no path where the served Remote claims a capability the Host does not
have.

**Key intents.** Today the page carries its own `KEY_INTENTS` table and
`the_remote_keyboard_intents_are_the_windows` compares it, as text, to
`src/input.ts`. In React there is one table:

```ts
// src/core/input.ts — imported by the window and the Remote
export const KEY_INTENTS: Readonly<Record<string, Intent>> = { … };
```

The window's `input.test.ts` is the decision test; the Remote's key handler is a
thin `useEffect` that calls `intentFor` and dispatches the mapped Action. A
Remote component test presses one key and asserts the Action that leaves; that is
the parity assertion, expressed as a contract instead of a text comparison. The
old test dies at cutover. The pad column stays window-only (no Gamepad API on the
LAN HTTP origin); the core table never grows a pad entry.

**Motion.** Today `scripts/build-remote-motion.mjs` builds a version-pinned
`motion-14.7.1.js` into `crates/host-wire/remote/`, `remote.rs` serves it at
`/motion-14.7.1.js` immutably, and the page dynamically imports it. In React,
`motion` is a normal dependency; the motion wrapper can keep the lazy behaviour:

```ts
const { animate } = await import("motion");
```

Vite emits a hashed chunk under `assets/`; `host-wire` serves it with the same
immutable header as the entry. `build.license` emits the MIT notices. The old
script, the vendor file, the versioned route and the banner test die at cutover;
a new test asserts `licenses.md` contains `Motion` and `MIT` (not the whole
text, which Vite may format differently). The version pin is the lockfile plus
the content hash, not a hand-written path.

## 9. Trade-offs rejected

- **One two-entry build into `dist`, then delete the Remote's files before
  Tauri.** Rolldown hoists shared modules into a chunk both entries use (probe,
  §1.1); deleting the Remote's entry and CSS is possible, but deleting the
  shared chunk breaks the window, and keeping it leaves Remote code in the Tauri
  binary. A manifest-driven transitive copy is more machinery for the same
  result as two builds.
- **`frontendDist` as a list of files.** The list is static and flattens files
  to the root; Vite's hashed names change per build. It cannot express "this
  build's `assets/` except the Remote's entry".
- **Committing `dist` and reading the Remote from it at runtime.** ADR-0017 §2
  rejected a runtime static directory: a build directory may not be there, and
  the page must travel with the binary. It would also put the Remote in the
  Tauri bundle.
- **Building the Remote in `build.rs` or a test.** `cargo test` would depend on
  Node, pnpm, the network and a writable source tree; `AGENTS.md` explicitly
  keeps `cargo test` free of a frontend build. A build script also makes the
  test suite slow and non-hermetic.
- **`include_str!` + fixed `remote.js`/`remote.css` names (no hashes).** It
  makes `include_bytes!` trivial, but the ticket wants hashed assets and
  `immutable` caching; without hashes the HTML must be revalidated and the
  assets cannot be cached for a year. Vite's default hashing is the point.
- **`include_dir!` without a build script.** The crate's own docs say the
  directory-tracking improvement is nightly-only (`track_path`); a new hashed
  file is not in rustc's dep-info until something forces re-expansion. The
  one-line `rerun-if-changed` is the stable guarantee.
- **`experimental.renderBuiltUrl` to keep `/fonts`.** It works in a probe, but
  it is an experimental API for a build that must be reproducible.
  `publicDir: false` uses documented behaviour; the warning it prints is the
  reminder that the Host owns the faces.
- **Copying `public/` into the artifact.** It duplicates ~100 KB of faces in the
  binary and rewrites the URLs to `/next/fonts/…`; the Host already serves the
  four faces. It also makes the artifact less self-describing: a font file in an
  artifact that the Host also embeds is a second source waiting to drift.
- **A separate Vite dev server/port for the Remote.** It would need a second
  `devUrl`, CORS or a second proxy, and the phone would have two origins to
  remember. One server serves both HTML entries; the `/host` proxy keeps the
  phone on one origin.
- **Serving the React Remote at `/` during development.** It would delete the
  legacy page before the cutover and lose the rollback; `/next` is the staging
  route, and `/` stays the hand-written page until the cutover.
- **A service worker for the served page.** The Host's `no-store` HTML and
  immutable hashed assets are enough; a service worker adds a lifecycle and a
  stale-shell failure mode on a LAN app that is updated by replacing the binary.
- **Compression in `host-wire`.** The entry is tens of kilobytes and the LAN is
  fast; adding gzip/br to a blocking HTTP server is a separate concern. The
  current `write_response` sets `Content-Length`; that stays.
- **A second, independently maintained wire version.** The wire version *is* the
  Action version (ADR-0017 §1); `build-info.json` records `wireVersion` as a copy
  of the one `ACTION_VERSION`, not a second number that could disagree with it.

## 10. The recommended design, in exact files and commands

### 10.1 Files

```
vite.remote.config.ts                       new: the Remote build (§1)
remote.html                                 new: the second entry
src/remote/                                 new: the React Remote's entry/App/screens
src/core/actions.ts (from src/host-client.ts)  the Action union and payloads
src/core/action-spellings.ts                new: the runtime Action list, typechecked against Action
src/core/version.ts                         ACTION_VERSION; no imports, so the Vite config can read it
src/core/input.ts                           move KEY_INTENTS here; both clients import it
src/core/{transport,store,pending,history,navigation,playback,socket}.ts
                                            the core seams the tests in §8.1 need (#190)
crates/host-wire/remote-next/               new: the committed artifact (generated)
crates/host-wire/src/remote_next.rs         new: include_dir!, /next routes, asset/MIME seam
crates/host-wire/build.rs                   new: cargo::rerun-if-changed=remote-next
crates/host-wire/Cargo.toml                 include_dir = { workspace = true }
Cargo.toml                                  include_dir = "0.7" in [workspace.dependencies]
package.json                                build:remote, check:remote
tsconfig.json                               include vite.remote.config.ts
.github/workflows/ci.yml                    the Check the Remote artifact step
.gitattributes                              crates/host-wire/remote-next/** -text
```

`crates/host-wire/src/remote.rs` keeps the legacy page and splices until the
cutover; `remote_next.rs` is the new module. `lib.rs` declares it. The existing
`/fonts/*` route and its four `include_bytes!` constants stay in `remote.rs`
(or move to a shared module) and serve both pages.

### 10.2 Commands

```sh
# One-time dependencies (inside the dev container)
docker compose exec dev pnpm install --frozen-lockfile

# Build the Remote artifact and commit it
docker compose exec dev pnpm build:remote
git add crates/host-wire/remote-next
git commit -m "build: rebuild the served Remote"

# Prove it is current (what CI does)
docker compose exec dev pnpm build:remote
test -z "$(git status --porcelain -- crates/host-wire/remote-next)"

# Window artifact for Tauri (unchanged)
docker compose exec dev pnpm build

# Fast Rust loop: no pnpm, no dist, no Vite
docker compose exec dev cargo test -p host-wire
docker compose exec dev cargo clippy --all-targets -- -D warnings
docker compose exec dev cargo fmt --check

# Window/Remote tests
docker compose exec dev pnpm typecheck
docker compose exec dev pnpm test

# Dev loop: both entries from one Vite server
docker compose exec dev pnpm dev
#   window:  http://localhost:1420/
#   remote:  http://localhost:1420/remote.html
#   phone:   http://<dev-machine>:1420/remote.html   (host: true, owner's LAN only)

# Served artifact (the release shape): run the Host and open
#   http://<host>:8090/next
```

The Windows route is unchanged: `pnpm build` in the container, `stage.sh`, then
`build.ps1`/`verify.ps1`. The Windows build compiles the committed
`remote-next/` through `host-wire`; it does not run pnpm for the Remote.

The dev container runs as root, so `pnpm build:remote` writes the artifact as
root. The repo's top-level directory is owned by the host user, so the host can
read and commit the files; if a host editor cannot overwrite one, `git checkout`
the file or `chown` it, or run the container with the host UID where the
development volumes allow it.

### 10.3 The cutover (a separate ticket, per #192/#193)

1. Rebuild the Remote with `base: "/"`.
2. `git rm -r crates/host-wire/remote` (the hand-written `index.html`,
   `icons.svg`, `motion-14.7.1.js` and the old Motion script's output), then
   `git mv crates/host-wire/remote-next crates/host-wire/remote` (the hashed names
   change with the base anyway).
3. Point `include_dir!` at `remote`; serve the document at `/` and `/index.html`;
   make `/next` a `308` to `/`; drop the `/motion-…` route.
4. Delete `splice()`, the six markers, the legacy constants, and the legacy
   `page()` tests; keep the `/fonts` test and the source-list bounds tests.
5. Delete `src/shell/repertory/remotePage.test.ts` and
   `src/shell/remoteFocus.test.ts`; the core/Remote tests from §8.1 are their
   replacements.
6. Delete `scripts/build-remote-motion.mjs`, `scripts/remote-motion-entry.js`,
   and the `build:remote-motion` script; Motion is in the bundle and its notice
   is in `licenses.md`.
7. Keep the CI staleness step and the `dist/remote.html` guard; the `base`/route
   change makes them more important, not less.

## 11. Could not confirm

- **That `publicDir: false` will keep leaving absolute `/fonts/…` URLs untouched
  in future Vite versions.** The probe on 8.3.4 shows it; the docs describe the
  public directory but not this exact interaction. The built-CSS test is the
  guard, and the fallback is an explicit `renderBuiltUrl` or copying the faces.
- **That `include_dir!`'s directory tracking without `track_path` is reliable on
  every platform.** The crate documents the nightly feature as the better
  tracking mechanism; the `rerun-if-changed` build script is the stable
  workaround, but the exact Cargo/rustc interaction on Windows/MSVC was not
  exercised here.
- **Tauri's `frontendDist` list form's treatment of subdirectories.** The docs
  say files are added to the root; the design does not use the list form, so this
  is a rejected alternative, not a dependency.
- **The owner's phone browser version.** Vite 8's default target is Baseline
  Widely Available as of 2026-01-01 (Chrome 111 / Safari 16.4 per the Vite build
  guide). If the phone is older, `build.target` must be lowered; that was not
  tested on the device.
- **The real bundle size of the React Remote.** The probe's stub with React and
  Motion was 68.4 KB (24.7 KB gzip); the actual Cast Remote screen tree will be
  larger. Measure after the migration, before deciding whether a lazy Motion
  chunk is enough.
- **Whether Vite's `build.license` output is stable across versions.** The probe
  shows `framer-motion`, `motion-dom`, `motion-utils` and MIT; the test should
  assert the presence of Motion and MIT, not the whole text.
- **Whether the `/host` Vite proxy works through every Windows/WSL network
  setup.** The docs support `ws: true`; the Windows-native phone walkthrough is
  the real check, and WSL2's LAN reachability is its own known limitation.
- **Whether a `308` from `/next` to `/next/` is better than serving the document
  at both paths.** The built HTML uses absolute `/next/…` URLs, so both work; the
  redirect is chosen for one canonical URL and to match the existing staging
  convention, not because the document requires it.
