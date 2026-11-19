# Builds the Host on the Windows side, where a window can actually be opened,
# or bundles it into the NSIS Windows installer (`-Bundle`) for a release.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 -Tree C:\Users\<you>\streamingapp-verify
#   powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1 -Tree C:\...\stage -CacheDir C:\...\cache -Bundle -Version 0.1.142
#
# `--features custom-protocol` is load-bearing: without it Tauri takes its dev
# path and the window loads `devUrl` (localhost:1420) instead of the frontend in
# `dist\`, whatever the cargo profile. `tauri build` passes that feature itself;
# a plain `cargo build` does not.
#
# libmpv is fetched and made linkable first: `host-mpv` links `mpv`, Windows
# wants an MSVC import library, and the dev bundle ships a MinGW one. See
# "the libmpv half" below, and scripts/windows/README.md.
#
# The Torrent engine is Go and built in the container (`crates/host-torrent/build.sh`),
# then staged with the tree: `streamingapp-torrent.exe` goes beside
# `streamingapp.exe`, which is where the Host looks for it, and `-Bundle` puts it
# in the installer with its licence notice, `THIRD-PARTY.md`.
#
# `-LibmpvBundle` overrides which dev bundle is fetched; by default it is the
# newest `mpv-dev-x86_64-v3` release of shinchiro/mpv-winbuild-cmake.
# `-CacheDir` moves `libmpv`, `tauri-cli` and Cargo's `target` out of `-Tree` so
# a clean staging tree that is wiped after the build still reuses them.
param(
    [Parameter(Mandatory)][string] $Tree,
    [string] $LibmpvBundle = '',
    [switch] $Bundle,
    [string] $Version = '',
    [string] $CacheDir = ''
)

$ErrorActionPreference = 'Stop'
$env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
$env:CARGO_TERM_COLOR = 'never'

# PowerShell 5.1 still defaults to TLS 1.0 with .NET Framework defaults, which
# GitHub does not speak.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if (-not (Test-Path $Tree)) { throw "no tree at $Tree" }
if (-not (Test-Path (Join-Path $Tree 'dist\index.html'))) {
    throw "no frontend in $Tree\dist - build it in the container with 'pnpm build' and stage it again"
}

$torrentEngine = Join-Path $Tree 'crates\host-torrent\out\streamingapp-torrent.exe'
$torrentNotices = Join-Path $Tree 'crates\host-torrent\engine\THIRD-PARTY.md'
if (-not (Test-Path $torrentEngine)) {
    throw "no Torrent engine at $torrentEngine - build it in the container with 'crates/host-torrent/build.sh' and stage again"
}
if (-not (Test-Path $torrentNotices)) {
    throw "no licence notice at $torrentNotices - stage the tree again"
}

if ($CacheDir) {
    New-Item -ItemType Directory -Force $CacheDir | Out-Null
    $CacheDir = (Resolve-Path $CacheDir).Path
}

# A Host still running from an earlier walkthrough holds its own executable open,
# and cargo then fails to replace it with `failed to remove file ... Access is
# denied` — which reads like a permissions problem and is not one. A `-Bundle`
# build compiles into its own cache and never launches or overwrites a running
# Host, so it leaves any open window alone.
if (-not $Bundle -and -not $CacheDir) {
    $running = Get-Process streamingapp -ErrorAction SilentlyContinue
    if ($running) {
        "stopping a Host left running from an earlier run: pid $($running.Id -join ', ')"
        $running | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}

# --- the libmpv half ----------------------------------------------------------
#
# `host-mpv` links libmpv the way each platform links libraries. On Linux that is
# the system `libmpv.so` through the linker's own paths; on Windows it is an
# `mpv.lib` import library beside `libmpv-2.dll`, because MSVC's `link.exe` reads
# MSVC import libraries and the dev bundle ships only a MinGW `libmpv.dll.a`.
#
# So, once per tree (or cache): fetch the nightly dev bundle, generate `mpv.lib`
# from the DLL's own exports (`dumpbin` → `.def` → `lib`), and leave
# `libmpv-2.dll` where the built executable or bundler can find it. A directory
# that already has `mpv.lib` is left alone, so a rebuild does not touch the
# network.

function Vc-Tools {
    # `dumpbin.exe` and `lib.exe` are not on `PATH`; they live under the Visual
    # Studio installation, and `vswhere` is the supported way to find that.
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw "no vswhere.exe at $vswhere - a Visual Studio Build Tools install is needed to make mpv.lib"
    }
    $root = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $root) { throw 'vswhere found no Visual C++ build tools' }

    $versions = Get-ChildItem (Join-Path $root 'VC\Tools\MSVC') -Directory |
        Sort-Object { [version]$_.Name } -Descending
    if ($versions.Count -eq 0) { throw "no MSVC toolset under $root\VC\Tools\MSVC" }

    return (Join-Path $versions[0].FullName 'bin\Hostx64\x64')
}

$storeRoot = if ($CacheDir) { $CacheDir } else { $Tree }
$libmpv = Join-Path $storeRoot 'libmpv'
$dll = Join-Path $libmpv 'libmpv-2.dll'
$lib = Join-Path $libmpv 'mpv.lib'

if (-not (Test-Path $lib)) {
    New-Item -ItemType Directory -Force $libmpv | Out-Null

    if (-not $LibmpvBundle) {
        '--- finding the newest libmpv dev bundle'
        $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'streamingapp-build' } `
            'https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/latest'
        $asset = $release.assets | Where-Object { $_.name -like 'mpv-dev-x86_64-v3-*' } |
            Select-Object -First 1
        if (-not $asset) { throw "the release $($release.tag_name) carries no mpv-dev-x86_64-v3 asset" }
        $LibmpvBundle = $asset.browser_download_url
    }
    "--- fetching $LibmpvBundle"
    $archive = Join-Path $libmpv 'mpv-dev.7z'
    Invoke-WebRequest -Uri $LibmpvBundle -OutFile $archive

    # The bundles are 7z, which PowerShell has no cmdlet for — but Windows' own
    # `tar.exe` is bsdtar, and libarchive reads 7z.
    tar.exe -xf $archive -C $libmpv
    if ($LASTEXITCODE -ne 0) { throw "tar could not extract $archive" }
    Remove-Item $archive

    $found = Get-ChildItem -Path $libmpv -Recurse -Filter 'libmpv-2.dll' | Select-Object -First 1
    if (-not $found) {
        Get-ChildItem -Path $libmpv | ForEach-Object { "  $($_.Name)" }
        throw "the bundle carries no libmpv-2.dll"
    }
    if ($found.DirectoryName -ne $libmpv) { Move-Item $found.FullName $dll -Force }

    '--- generating mpv.lib from the DLL exports'
    $tools = Vc-Tools
    $def = Join-Path $libmpv 'mpv.def'

    # The bundle often ships a .def beside the DLL; when it does, that one is
    # the source of truth. Where it does not, `dumpbin /exports` prints a table
    # whose last column is the name, under a header of its own.
    $shipped = Get-ChildItem -Path $libmpv -Recurse -Filter '*.def' | Select-Object -First 1
    if ($shipped) {
        "using the .def the bundle ships: $($shipped.FullName)"
        Copy-Item $shipped.FullName $def -Force
    } else {
        $exports = & (Join-Path $tools 'dumpbin.exe') /nologo /exports $dll
        if ($LASTEXITCODE -ne 0) { throw 'dumpbin could not read the DLL export table' }
        $names = $exports |
            Where-Object { $_ -match '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)\s*$' } |
            ForEach-Object { $Matches[1] } |
            Sort-Object -Unique
        if ($names.Count -eq 0) { throw 'dumpbin listed no exports to make an import library from' }
        @('LIBRARY libmpv-2.dll', 'EXPORTS') + $names | Out-File -Encoding ascii $def
    }

    & (Join-Path $tools 'lib.exe') /nologo /def:$def /machine:x64 /out:$lib
    if ($LASTEXITCODE -ne 0) { throw "lib.exe could not build $lib" }
    "mpv.lib: $lib  ($((Get-Item $lib).Length) bytes)"
}

# The linker is told where the import library is through the environment it
# inherited, which is how a crate that only says `link-lib=mpv` finds it.
$env:LIB = "$libmpv;$env:LIB"

$targetDir = if ($CacheDir) { Join-Path $CacheDir 'target' } else { Join-Path $Tree 'target' }
if ($CacheDir) {
    $env:CARGO_TARGET_DIR = $targetDir
}

$buildLog = Join-Path $Tree 'build.log'
Remove-Item $buildLog -ErrorAction SilentlyContinue
Set-Location $Tree

if ($Bundle) {
    # --- the NSIS installer half ----------------------------------------------
    #
    # `cargo-tauri.exe` (v2) drives the release build and the NSIS bundler,
    # fetching NSIS itself into `%LOCALAPPDATA%\tauri\NSIS` on first run. We
    # fetch the prebuilt `cargo-tauri` binary once into the store directory so
    # Windows does not spend minutes compiling `tauri-cli` from source.
    $tauriCliDir = Join-Path $storeRoot 'tauri-cli'
    $cargoTauri = Join-Path $tauriCliDir 'cargo-tauri.exe'
    if (-not (Test-Path $cargoTauri)) {
        New-Item -ItemType Directory -Force $tauriCliDir | Out-Null
        '--- finding the newest cargo-tauri v2 binary'
        $releases = Invoke-RestMethod -Headers @{ 'User-Agent' = 'streamingapp-build' } `
            'https://api.github.com/repos/tauri-apps/tauri/releases?per_page=30'
        $cliRelease = $releases | Where-Object { $_.tag_name -like 'tauri-cli-v2.*' } |
            Select-Object -First 1
        if (-not $cliRelease) { throw 'no tauri-cli-v2.* release found on tauri-apps/tauri' }
        $cliAsset = $cliRelease.assets |
            Where-Object { $_.name -eq 'cargo-tauri-x86_64-pc-windows-msvc.zip' } |
            Select-Object -First 1
        if (-not $cliAsset) {
            throw "the release $($cliRelease.tag_name) carries no cargo-tauri-x86_64-pc-windows-msvc.zip"
        }
        "--- fetching $($cliAsset.browser_download_url)"
        $cliZip = Join-Path $tauriCliDir 'cargo-tauri.zip'
        Invoke-WebRequest -Uri $cliAsset.browser_download_url -OutFile $cliZip
        tar.exe -xf $cliZip -C $tauriCliDir
        if ($LASTEXITCODE -ne 0) { throw "tar could not extract $cliZip" }
        Remove-Item $cliZip
        if (-not (Test-Path $cargoTauri)) { throw "extracted archive carries no $cargoTauri" }
    }

    # Override config passed by file path so PowerShell 5.1 does not strip quotes
    # from inline JSON arguments:
    # - `beforeBuildCommand` is cleared because `dist\` was already built in the
    #   Linux dev container and staged (Windows has no `pnpm`).
    # - `libmpv-2.dll` is bundled alongside `streamingapp.exe` so the installed
    #   Host has a working Player.
    # - `streamingapp-torrent.exe` is bundled there too, where the Host looks for
    #   its Torrent engine, with `THIRD-PARTY.md`, the licences of the Go modules
    #   it is built from.
    # - `version` is overridden when `-Version` is given so every release tag gets
    #   its own installer version without a version-bump commit in git.
    $overridePath = Join-Path $Tree 'src-tauri\tauri.bundle.conf.json'
    $override = @{
        build = @{
            beforeBuildCommand = ''
        }
        bundle = @{
            resources = @{
                $dll = 'libmpv-2.dll'
                $torrentEngine = 'streamingapp-torrent.exe'
                $torrentNotices = 'THIRD-PARTY.md'
            }
        }
    }
    if ($Version) {
        $override['version'] = $Version
    }
    $overrideJson = $override | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($overridePath, $overrideJson, (New-Object System.Text.UTF8Encoding($false)))

    '--- cargo-tauri tauri build --bundles nsis'
    $ErrorActionPreference = 'Continue'
    & $cargoTauri tauri build --bundles nsis --config $overridePath *>&1 |
        ForEach-Object { $_ | Out-File -FilePath $buildLog -Append -Encoding utf8; "$_" }
    $code = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Remove-Item $overridePath -ErrorAction SilentlyContinue

    if ($code -ne 0) {
        Get-Content $buildLog -Tail 40
        throw "cargo-tauri build failed with $code (full log: $buildLog)"
    }

    $nsisDir = Join-Path $targetDir 'release\bundle\nsis'
    $pattern = if ($Version) { "streamingapp_${Version}_*-setup.exe" } else { 'streamingapp_*-setup.exe' }
    $installer = Get-ChildItem -Path $nsisDir -Filter $pattern -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $installer) {
        throw "bundled, but no NSIS installer matching $pattern under $nsisDir"
    }
    "installer: $($installer.FullName)  ($($installer.Length) bytes)"
    Get-Content $buildLog -Tail 5
    exit 0
}

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

$exe = Join-Path $targetDir 'release\streamingapp.exe'
if (-not (Test-Path $exe)) { throw "built, but no executable at $exe" }

# libmpv is loaded from beside the executable, so it goes there every build: a
# build that replaced the exe but not the DLL is a Host that cannot play.
Copy-Item $dll (Split-Path $exe) -Force

$beside = Join-Path (Split-Path $exe) 'libmpv-2.dll'
# And so is the Torrent engine, which the Host starts from beside itself.
Copy-Item $torrentEngine (Split-Path $exe) -Force
$engineBeside = Join-Path (Split-Path $exe) 'streamingapp-torrent.exe'
"exe: $exe  ($((Get-Item $exe).Length) bytes)"
"dll: $beside  ($((Get-Item $beside).Length) bytes)"
"torrent engine: $engineBeside  ($((Get-Item $engineBeside).Length) bytes)"
Get-Content $buildLog -Tail 3
