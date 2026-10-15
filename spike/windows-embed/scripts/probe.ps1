function Probe($label, $path) {
  if ($path -and (Test-Path $path)) { "$label $path" } else { "$label MISSING" }
}

$cargo = (Get-Command cargo.exe -ErrorAction SilentlyContinue).Source
if (-not $cargo) { $u = "$env:USERPROFILE\.cargo\bin\cargo.exe"; if (Test-Path $u) { $cargo = $u } }
Probe 'cargo:' $cargo

$rustup = (Get-Command rustup.exe -ErrorAction SilentlyContinue).Source
if (-not $rustup) { $u = "$env:USERPROFILE\.cargo\bin\rustup.exe"; if (Test-Path $u) { $rustup = $u } }
Probe 'rustup:' $rustup

$roots = @(
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools',
  'C:\Program Files\Microsoft Visual Studio\2022\BuildTools'
)
$found = $false
foreach ($r in $roots) {
  if (Test-Path $r) { "buildtools: $r"; $found = $true }
}
if (-not $found) { 'buildtools: MISSING' }

$link = Get-ChildItem $roots -Filter link.exe -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1 -ExpandProperty FullName
Probe 'link.exe:' $link

'--- winget list'
winget list --id Rustlang.Rustup 2>$null | Select-Object -Last 3
winget list --id Microsoft.VisualStudio.2022.BuildTools 2>$null | Select-Object -Last 3
