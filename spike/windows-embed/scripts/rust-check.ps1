$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$ErrorActionPreference = 'Continue'

'--- rustup show'
rustup show

'--- setting default toolchain to stable-msvc'
rustup default stable-msvc 2>&1 | Select-Object -Last 3

'--- versions'
rustup --version
cargo --version
rustc --version

'--- hello world link test'
$hw = Join-Path $env:TEMP 'spike-hello'
if (Test-Path $hw) { Remove-Item -Recurse -Force $hw }
cargo new $hw --quiet 2>&1 | Out-Null
Push-Location $hw
cargo build 2>&1 | Select-Object -Last 5
if ($LASTEXITCODE -eq 0) { 'HELLO-WORLD BUILD OK' } else { "HELLO-WORLD BUILD FAILED rc=$LASTEXITCODE" }
Pop-Location
