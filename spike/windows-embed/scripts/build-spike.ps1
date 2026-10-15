$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$ErrorActionPreference = 'Continue'
$root = 'C:\Users\menot\streamingapp-spike\win-embed'
Set-Location $root

'--- cargo build (tauri spike)'
cargo build 2>&1 | Select-Object -Last 45
$rc = $LASTEXITCODE
"--- exit=$rc"
if ($rc -eq 0) {
  $exe = Join-Path $root 'target\debug\spike-embed.exe'
  if (Test-Path $exe) { "exe: $exe"; (Get-Item $exe).Length } else { 'exe MISSING after successful build' }
  Copy-Item 'C:\Users\menot\streamingapp-spike\libmpv-2.dll' (Join-Path $root 'target\debug\') -Force
  'libmpv-2.dll copied next to exe'
}
