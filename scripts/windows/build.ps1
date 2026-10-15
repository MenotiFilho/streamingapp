# Builds the Host on the Windows side, where a window can actually be opened.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 -Tree C:\Users\<you>\streamingapp-verify
#
# `--features custom-protocol` is load-bearing: without it Tauri takes its dev
# path and the window loads `devUrl` (localhost:1420) instead of the frontend in
# `dist\`, whatever the cargo profile. `tauri build` passes that feature itself;
# a plain `cargo build` does not.
param(
    [Parameter(Mandatory)][string] $Tree
)

$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:CARGO_TERM_COLOR = 'never'

if (-not (Test-Path $Tree)) { throw "no tree at $Tree" }
if (-not (Test-Path (Join-Path $Tree 'dist\index.html'))) {
    throw "no frontend in $Tree\dist - build it in the container with 'pnpm build' and stage it again"
}

# A Host still running from an earlier walkthrough holds its own executable open,
# and cargo then fails to replace it with `failed to remove file ... Access is
# denied` — which reads like a permissions problem and is not one.
$running = Get-Process streamingapp -ErrorAction SilentlyContinue
if ($running) {
    "stopping a Host left running from an earlier run: pid $($running.Id -join ', ')"
    $running | Stop-Process -Force
    Start-Sleep -Seconds 2
}

$buildLog = Join-Path $Tree 'build.log'
Remove-Item $buildLog -ErrorAction SilentlyContinue
Set-Location $Tree
'--- cargo build --release -p streamingapp --features custom-protocol'

# cargo writes its progress to stderr, which PowerShell 5.1 treats as a
# terminating error under 'Stop'; relax it and judge the exit code instead. The
# tee keeps the log readable while the build is still running, in UTF-8 so that a
# reader on the WSL side can read it.
$ErrorActionPreference = 'Continue'
cargo build --release -p streamingapp --features custom-protocol *>&1 |
    ForEach-Object { $_ | Out-File -FilePath $buildLog -Append -Encoding utf8; "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'

if ($code -ne 0) {
    Get-Content $buildLog -Tail 40
    throw "cargo build failed with $code (full log: $buildLog)"
}

$exe = Join-Path $Tree 'target\release\streamingapp.exe'
if (-not (Test-Path $exe)) { throw "built, but no executable at $exe" }
"exe: $exe  ($((Get-Item $exe).Length) bytes)"
Get-Content $buildLog -Tail 3
