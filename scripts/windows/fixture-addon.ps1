# A Stremio Addon that answers from this machine, so a walkthrough can walk
# *playback* and the whole control set without a debrid configuration and without
# depending on what a third-party Addon happens to serve today.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File fixture-addon.ps1 `
#       -Video C:\Users\<you>\streamingapp-verify\fixture\verify-controls.mkv
#
# then, in another window, point the walkthrough at it:
#
#   powershell ... verify.ps1 -Tree 'C:\...\streamingapp-verify' `
#       -Addon 'http://127.0.0.1:8099/manifest.json' -AddonName Verify `
#       -AddonId dev.streamingapp.verify -AddonCatalog Verify
#
# It serves a manifest, a movie catalog and a series catalog, their metadata, a
# stream answer for each Video, and the video file itself over 127.0.0.1
# (ADR-0013). It also starts `fixture-seed.exe` (built into `fixture\` by
# `stage.sh`, never bundled into the installer) to seed the fixture video as a
# single-file film and a two-file season pack on 127.0.0.1 behind a loopback
# HTTP tracker (spec #311, issue #347).
#
# Movie catalog:
#   - A Film That Plays        (tt9999999) - direct HTTP file on 127.0.0.1
#   - A Film From A Torrent    (tt8888888) - local seed infoHash, no fileIdx
#   - A Film From The Swarm    (tt8888889) - Sintel (CC BY 3.0), real swarm
#   - A Film Nobody Shares     (tt8888890) - dead infoHash, for 60 s give-up
#
# Series catalog:
#   - A Series That Plays      (tt7777777) - S1E1 & S1E2, direct HTTP
#   - A Series From A Torrent  (tt7777778) - S1E1, S1E2 & S1E3, two-file pack
#     (S1E1 and S1E2 play from the same infoHash; S1E3 fails with the engine's
#     sentence because the pack holds only two episodes)
param(
    [Parameter(Mandatory)][string] $Video,
    [int] $Port = 8099,
    [string] $Seeder = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Video)) { throw "no video at $Video" }
$video = (Resolve-Path $Video).Path
$file = Split-Path $video -Leaf
$root = "http://127.0.0.1:$Port"

if (-not $Seeder) {
    $Seeder = Join-Path (Split-Path $video) 'fixture-seed.exe'
}
if (-not (Test-Path $Seeder)) {
    throw "no fixture-seed at $Seeder - run scripts/windows/stage.sh (which builds fixture-seed.exe for walkthroughs only) or pass -Seeder <path>"
}
$seederPath = (Resolve-Path $Seeder).Path

# Movie and series IDs offered by this fixture Addon.
$PLAYABLE = 'tt9999999'
$TORRENT_FILM = 'tt8888888'
$SWARM_FILM = 'tt8888889'
$DEAD_FILM = 'tt8888890'

$SINTEL_HASH = '08ada5a7a6183aae1e09d831df6748d566095a10'
$SINTEL_SOURCES = @(
    'tracker:udp://tracker.opentrackr.org:1337/announce',
    'tracker:udp://explodie.org:6969/announce',
    'dht:08ada5a7a6183aae1e09d831df6748d566095a10'
)
$DEAD_HASH = 'e7a3c9f14b2d8605c4e29a71f3b8d6029e4a1c57'

$SERIES = 'tt7777777'
$EPISODES = @(
    @{ id = "${SERIES}:1:1"; season = 1; episode = 1; title = 'Episode One' },
    @{ id = "${SERIES}:1:2"; season = 1; episode = 2; title = 'Episode Two' }
)

$TORRENT_SERIES = 'tt7777778'
$TORRENT_EPISODES = @(
    @{ id = "${TORRENT_SERIES}:1:1"; season = 1; episode = 1; title = 'Pack Episode One' },
    @{ id = "${TORRENT_SERIES}:1:2"; season = 1; episode = 2; title = 'Pack Episode Two' },
    @{ id = "${TORRENT_SERIES}:1:3"; season = 1; episode = 3; title = 'Pack Episode Three (Missing)' }
)

# Start fixture-seed and read its JSON lines (film + two-file pack).
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $seederPath
$psi.Arguments = "--video `"$video`" --watch-stdin"
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$seederProc = New-Object System.Diagnostics.Process
$seederProc.StartInfo = $psi
$seederErr = New-Object Collections.Generic.List[string]
$errEvent = Register-ObjectEvent -InputObject $seederProc -EventName ErrorDataReceived -Action {
    if ($EventArgs.Data) { $Event.MessageData.Add($EventArgs.Data) }
} -MessageData $seederErr

if (-not $seederProc.Start()) {
    throw "could not start $seederPath"
}
$seederProc.BeginErrorReadLine()

$filmHash = ''
$packHash = ''
$trackerUrl = ''

try {
    while (-not ($filmHash -and $packHash)) {
        $line = $seederProc.StandardOutput.ReadLine()
        if ($null -eq $line) {
            $errText = ($seederErr -join "`n")
            throw "fixture-seed exited before printing film and pack infoHashes: $errText"
        }
        $line = $line.Trim()
        if (-not $line) { continue }
        $rec = $line | ConvertFrom-Json
        if ($rec.kind -eq 'film') {
            $filmHash = [string]$rec.infoHash
            $trackerUrl = [string]$rec.tracker
        } elseif ($rec.kind -eq 'pack') {
            $packHash = [string]$rec.infoHash
            if (-not $trackerUrl) { $trackerUrl = [string]$rec.tracker }
        }
    }
} catch {
    try { $seederProc.Kill() } catch { }
    Unregister-Event -SubscriptionId $errEvent.Id -ErrorAction SilentlyContinue
    throw
}

if (-not $trackerUrl) {
    try { $seederProc.Kill() } catch { }
    Unregister-Event -SubscriptionId $errEvent.Id -ErrorAction SilentlyContinue
    throw 'fixture-seed printed no tracker URL'
}

function Manifest {
    @{
        id = 'dev.streamingapp.verify'
        name = 'Verify'
        version = '1.0.0'
        description = 'An Addon served from this machine, for the walkthrough.'
        # `meta` is what `Next episode` asks for the Title it is on; `catalog` the
        # rows; `stream` the candidates. The manifest promises only these.
        resources = @('catalog', 'meta', 'stream')
        types = @('movie', 'series')
        catalogs = @(
            # `skip` is what makes a row pageable: the walkthrough presses More
            # and checks that a question moves no revision.
            @{
                type = 'movie'; id = 'verify'; name = 'Verify'
                extra = @(@{ name = 'skip'; isRequired = $false; options = @() })
            },
            # A series row second, which is where the walkthrough looks for one to
            # open - and where Cinemeta, the default Addon, puts its own series
            # catalog, so the two runs browse the same way.
            @{
                type = 'series'; id = 'verify-series'; name = 'Verify Series'
                extra = @(@{ name = 'skip'; isRequired = $false; options = @() })
            }
        )
    } | ConvertTo-Json -Depth 8
}

function Catalog($type, $path) {
    # One page, then nothing: a row that pages on once and ends. The empty page
    # is built before the object, or PowerShell folds an empty array away and
    # the Host is handed an object where it was promised a list.
    $metas = @()
    if ($path -notmatch 'skip=') {
        if ($type -eq 'series') {
            $metas = @(
                @{
                    id = $SERIES
                    type = 'series'
                    name = 'A Series That Plays'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2026'
                    description = 'Two episodes of the video file this Addon serves.'
                    genres = @('Verify')
                },
                @{
                    id = $TORRENT_SERIES
                    type = 'series'
                    name = 'A Series From A Torrent'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2026'
                    description = 'Two-episode season pack seeded on this machine (plus a missing S1E3).'
                    genres = @('Verify')
                }
            )
        } else {
            $metas = @(
                @{
                    id = $PLAYABLE
                    type = 'movie'
                    name = 'A Film That Plays'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2026'
                    description = 'The candidate is the video file this Addon serves.'
                    genres = @('Verify')
                },
                @{
                    id = $TORRENT_FILM
                    type = 'movie'
                    name = 'A Film From A Torrent'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2026'
                    description = 'The candidate is the fixture video seeded on this machine over 127.0.0.1.'
                    genres = @('Verify')
                },
                @{
                    id = $SWARM_FILM
                    type = 'movie'
                    name = 'A Film From The Swarm'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2010'
                    description = 'Sintel (Blender Foundation, CC BY 3.0) from the public swarm.'
                    genres = @('Verify')
                },
                @{
                    id = $DEAD_FILM
                    type = 'movie'
                    name = 'A Film Nobody Shares'
                    poster = "$root/poster.png"
                    posterShape = 'poster'
                    releaseInfo = '2026'
                    description = 'An infoHash nobody seeds, for the 60 s give-up check.'
                    genres = @('Verify')
                }
            )
        }
    }

    @{ metas = $metas; cacheMaxAge = 0 } | ConvertTo-Json -Depth 8
}

function Meta($type, $id) {
    if ($type -eq 'series') {
        $isTorrent = ($id -eq $TORRENT_SERIES)
        $list = if ($isTorrent) { $TORRENT_EPISODES } else { $EPISODES }
        $name = if ($isTorrent) { 'A Series From A Torrent' } else { 'A Series That Plays' }
        $desc = if ($isTorrent) {
            'Two-episode season pack seeded on this machine, with S1E3 listed but absent from the pack.'
        } else {
            'Served by the Addon fixture on this machine.'
        }
        # The Title's Videos are what `Next episode` reads: it finds the Video
        # playing in this list and takes the next one in the Addon's own order.
        $videos = @()
        foreach ($episode in $list) {
            $videos += @{
                id = $episode.id
                title = $episode.title
                season = $episode.season
                episode = $episode.episode
                released = '2026-01-01T00:00:00.000Z'
            }
        }
        @{
            meta = @{
                id = $id
                type = 'series'
                name = $name
                poster = "$root/poster.png"
                posterShape = 'poster'
                releaseInfo = '2026'
                description = $desc
                genres = @('Verify')
                videos = $videos
            }
        } | ConvertTo-Json -Depth 8
        return
    }

    $title = switch ($id) {
        $TORRENT_FILM { 'A Film From A Torrent' }
        $SWARM_FILM   { 'A Film From The Swarm' }
        $DEAD_FILM    { 'A Film Nobody Shares' }
        default       { 'A Film That Plays' }
    }
    $runtime = if ($id -eq $SWARM_FILM) { '15 min' } else { '5 min' }
    @{
        meta = @{
            id = $id
            type = 'movie'
            name = $title
            poster = "$root/poster.png"
            posterShape = 'poster'
            releaseInfo = if ($id -eq $SWARM_FILM) { '2010' } else { '2026' }
            runtime = $runtime
            description = 'Served by the Addon fixture on this machine.'
            genres = @('Verify')
            videos = @()
        }
    } | ConvertTo-Json -Depth 8
}

function Streams($type, $id) {
    if ($type -eq 'series') {
        $parts = $id -split ':'
        $seriesId = $parts[0]
        $episode = [int]($parts[-1])
        if ($seriesId -eq $TORRENT_SERIES) {
            # Two-file season pack with no fileIdx and no filename hint, so the
            # engine's episode-matching rule picks S01E01 / S01E02 and fails on
            # S1E3. Same bingeGroup keeps Next episode on the same infoHash.
            $candidate = @{
                name = "Verify`nS1E$episode Pack 720p"
                description = 'Two-episode season pack, seeded on this machine'
                infoHash = $packHash
                sources = @("tracker:$trackerUrl")
                behaviorHints = @{ bingeGroup = 'verify-pack' }
            }
            @{ streams = @($candidate) } | ConvertTo-Json -Depth 8
            return
        }

        # Each episode's candidate names its episode, so the now-playing line
        # changes when `Next episode` moves on. The same `bingeGroup` on both is
        # what keeps the next episode on this release (ADR-0014).
        $candidate = @{
            name = "Verify`nS1E$episode 720p"
            description = "The fixture's own file, served from this machine"
            url = "$root/video/$file"
            behaviorHints = @{ filename = "$file"; bingeGroup = 'verify' }
        }
        @{ streams = @($candidate) } | ConvertTo-Json -Depth 8
        return
    }

    $candidate = switch ($id) {
        $TORRENT_FILM {
            @{
                name = "Verify`n1080p"
                description = 'The fixture video, seeded on this machine'
                infoHash = $filmHash
                sources = @("tracker:$trackerUrl")
            }
        }
        $SWARM_FILM {
            @{
                name = "Verify`nSintel CC BY 3.0"
                description = 'Sintel (Blender Foundation, CC BY 3.0) from the public swarm'
                infoHash = $SINTEL_HASH
                sources = $SINTEL_SOURCES
            }
        }
        $DEAD_FILM {
            @{
                name = "Verify`nDead torrent"
                description = 'An infoHash nobody is sharing, for the 60 s give-up check'
                infoHash = $DEAD_HASH
                sources = @("tracker:$trackerUrl")
            }
        }
        default {
            @{
                name = "Verify`n720p"
                description = "The fixture's own file, served from this machine"
                url = "$root/video/$file"
                behaviorHints = @{ filename = "$file" }
            }
        }
    }

    @{ streams = @($candidate) } | ConvertTo-Json -Depth 8
}

# A one-pixel poster, so the window's card has an image to draw.
$poster = [Convert]::FromBase64String(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
)

$listener = New-Object Net.HttpListener
$prefix = "http://127.0.0.1:$Port/"
$listener.Prefixes.Add($prefix)
try {
    $listener.Start()
} catch {
    try { $seederProc.StandardInput.Close() } catch { }
    try { if (-not $seederProc.WaitForExit(2000)) { $seederProc.Kill() } } catch { }
    Unregister-Event -SubscriptionId $errEvent.Id -ErrorAction SilentlyContinue
    throw "could not listen on $prefix (another process on that port?): $_"
}

"the Addon fixture is answering on $prefix"
"  manifest:  $root/manifest.json"
"  video:     $root/video/$file"
"  tracker:   $trackerUrl"
"  film hash: $filmHash"
"  pack hash: $packHash"
"  stop it with Ctrl+C"

# Read once: every request for a range would otherwise read the whole file again.
$videoBytes = [IO.File]::ReadAllBytes($video)

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()

        # A client that abandons a range - which mpv does whenever it seeks, and
        # whenever it has read enough - closes the socket under a `Write`, and
        # HttpListener raises that as an exception. It is how a player normally
        # talks to a server, so it must not end the server: the request is
        # dropped and the next one is served. (This is what took the fixture down
        # during the first walkthrough run.)
        try {
        $request = $context.Request
        $path = $request.Url.AbsolutePath
        $body = $null
        $type = 'application/json'

        switch -Regex ($path) {
            '^/manifest\.json$' { $body = [Text.Encoding]::UTF8.GetBytes((Manifest)) }
            '^/catalog/(movie|series)/(verify|verify-series)' {
                $body = [Text.Encoding]::UTF8.GetBytes((Catalog $Matches[1] $path))
            }
            '^/meta/(movie|series)/([^/]+)\.json$' {
                $body = [Text.Encoding]::UTF8.GetBytes((Meta $Matches[1] $Matches[2]))
            }
            '^/stream/(movie|series)/([^/]+)\.json$' {
                $body = [Text.Encoding]::UTF8.GetBytes((Streams $Matches[1] $Matches[2]))
            }
            '^/poster\.png$' { $body = $poster; $type = 'image/png' }
            '^/video/' {
                # mpv asks with a range and re-asks when it seeks; a 206 with the
                # slice it asked for is what keeps seeking instant rather than a
                # re-download of the whole file.
                $bytes = $videoBytes
                $from = 0
                $to = $bytes.Length - 1
                $range = $request.Headers['Range']
                if ($range -and $range -match 'bytes=(\d*)-(\d*)') {
                    if ($Matches[1]) { $from = [int]$Matches[1] }
                    if ($Matches[2]) { $to = [Math]::Min([int]$Matches[2], $bytes.Length - 1) }
                    $length = $to - $from + 1
                    $body = New-Object byte[] $length
                    [Array]::Copy($bytes, $from, $body, 0, $length)
                    $context.Response.StatusCode = 206
                    $context.Response.AddHeader('Content-Range', "bytes $from-$to/$($bytes.Length)")
                } else {
                    $body = $bytes
                }
                $type = 'video/x-matroska'
            }
            default { $context.Response.StatusCode = 404 }
        }

        "  $($request.HttpMethod) $path$(if ($body) { " -> $($body.Length) bytes" } else { ' -> 404' })"

        if ($body) {
            $context.Response.ContentType = $type
            $context.Response.ContentLength64 = $body.Length
            $context.Response.OutputStream.Write($body, 0, $body.Length)
        }
        $context.Response.Close()
        } catch {
            "  $($context.Request.HttpMethod) $($context.Request.Url.AbsolutePath) -> the client went away: $($_.Exception.Message)"
            try { $context.Response.Abort() } catch { }
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    try { $seederProc.StandardInput.Close() } catch { }
    try {
        if (-not $seederProc.WaitForExit(3000)) {
            $seederProc.Kill()
        }
    } catch { }
    $seederProc.Dispose()
    Unregister-Event -SubscriptionId $errEvent.Id -ErrorAction SilentlyContinue
}
