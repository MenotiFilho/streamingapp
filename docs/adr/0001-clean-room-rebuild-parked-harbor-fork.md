# Clean-room rebuild; the Harbor fork stays parked

Harbor — a Tauri + React + Rust Stremio client with embedded libmpv — already
solves most of this problem, and we had a fork of it (`MenotiFilho/harbor`,
branch `menoti/slim`). We are not continuing it: this project is a new codebase
in a new repository, and the fork is parked. The fork's player UI lives in a
webview that nothing outside the process can drive, its feature set cannot be
shed without fighting upstream churn, and the thing we want — every control
reachable from a remote client — is a different architecture rather than a
smaller version of that one. Cost: we re-implement browse, metadata and
playback plumbing the fork already had. License is not a factor: Harbor is MIT.
