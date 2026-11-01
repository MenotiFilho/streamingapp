//! The staged Remote's artifact is a compiled-in directory, so Cargo has to know
//! when it changed: a rebuild of `remote-next/` is a rebuild of this crate, and
//! a `cargo test` never runs pnpm to find out (ADR-0035 §3).

fn main() {
    println!("cargo:rerun-if-changed=remote-next");
}
