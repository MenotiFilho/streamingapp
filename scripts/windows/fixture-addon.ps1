# A Stremio Addon that answers from this machine, so a walkthrough can walk
# *playback* without a debrid configuration and without depending on what a
# third-party Addon happens to serve today.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File fixture-addon.ps1 `
#       -Video C:\Users\<you>\streamingapp-verify\fixture\verify-720p.mp4
#
# then, in another window, point the walkthrough at it:
#
#   powershell ... verify.ps1 -Tree 'C:\...\streamingapp-verify' `
#       -Addon 'http://127.0.0.1:8099/manifest.json' -AddonName Verify `
#       -AddonId dev.streamingapp.verify -AddonCatalog Verify
#
# It serves a manifest, one catalog of two films, their metadata, a stream answer
# whose candidate is that video file, and the file itself — all over
# 127.0.0.1, which is all a Stream URL has to be (ADR-0013). One of the two films
# answers an `infoHash` instead, which is the case a walkthrough should see fail
# honestly rather than play.
param(
    [Parameter(Mandatory)][string] $Video,
    [int] $Port = 8099
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Video)) { throw "no video at $Video" }
$video = (Resolve-Path $Video).Path
$name = Split-Path $video -Leaf
$root = "http://127.0.0.1:$Port"

# The film the catalog offers, and the film whose candidate cannot be played.
$PLAYABLE = 'tt9999999'
$UNPLAYABLE = 'tt8888888'

function Manifest {
    @{
        id = 'dev.streamingapp.verify'
        name = 'Verify'
        version = '1.0.0'
        description = 'An Addon served from this machine, for the walkthrough.'
        resources = @('catalog', 'meta', 'stream')
        types = @('movie')
        catalogs = @(
            # `skip` is what makes a row pageable: the walkthrough presses More
            # and checks that a question moves no revision.
            @{
                type = 'movie'; id = 'verify'; name = 'Verify'
                extra = @(@{ name = 'skip'; isRequired = $false; options = @() })
            }
        )
    } | ConvertTo-Json -Depth 8
}

function Catalog($path) {
    # One page, then nothing: a row that pages on once and ends. The empty page
    # is built before the object, or PowerShell folds an empty array away and
    # the Host is handed an object where it was promised a list.
    $metas = @()
    if ($path -notmatch 'skip=') {
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
                id = $UNPLAYABLE
                type = 'movie'
                name = 'A Film That Cannot Play'
                poster = "$root/poster.png"
                posterShape = 'poster'
                releaseInfo = '2026'
                description = 'The candidate is an infoHash, which this version lists and marks.'
                genres = @('Verify')
            }
        )
    }

    @{ metas = $metas; cacheMaxAge = 0 } | ConvertTo-Json -Depth 8
}

function Meta($id) {
    $title = if ($id -eq $UNPLAYABLE) { 'A Film That Cannot Play' } else { 'A Film That Plays' }
    @{
        meta = @{
            id = $id
            type = 'movie'
            name = $title
            poster = "$root/poster.png"
            posterShape = 'poster'
            releaseInfo = '2026'
            runtime = '2 min'
            description = 'Served by the Addon fixture on this machine.'
            genres = @('Verify')
            videos = @()
        }
    } | ConvertTo-Json -Depth 8
}

function Streams($id) {
    $candidate = if ($id -eq $UNPLAYABLE) {
        @{
            name = "Verify`n1080p"
            description = 'A torrent, which this Host lists and cannot fetch yet'
            infoHash = '61065ea115b7cc3e8db9fb5ab1f6f327f08bd1c9'
            behaviorHints = @{ filename = "$name" }
        }
    } else {
        @{
            name = "Verify`n720p"
            description = "The fixture's own file, served from this machine"
            url = "$root/video/$name"
            behaviorHints = @{ filename = "$name" }
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
    throw "could not listen on $prefix (another process on that port?): $_"
}

"the Addon fixture is answering on $prefix"
"  manifest:  $root/manifest.json"
"  video:     $root/video/$name"
"  stop it with Ctrl+C"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $path = $request.Url.AbsolutePath
        $body = $null
        $type = 'application/json'

        switch -Regex ($path) {
            '^/manifest\.json$' { $body = [Text.Encoding]::UTF8.GetBytes((Manifest)) }
            '^/catalog/movie/verify' { $body = [Text.Encoding]::UTF8.GetBytes((Catalog $path)) }
            "^/meta/movie/($PLAYABLE|$UNPLAYABLE)\.json$" {
                $body = [Text.Encoding]::UTF8.GetBytes((Meta $Matches[1]))
            }
            "^/stream/movie/($PLAYABLE|$UNPLAYABLE)\.json$" {
                $body = [Text.Encoding]::UTF8.GetBytes((Streams $Matches[1]))
            }
            '^/poster\.png$' { $body = $poster; $type = 'image/png' }
            '^/video/' {
                # mpv asks with a range and re-asks when it seeks; a 206 with the
                # slice it asked for is what keeps seeking instant rather than a
                # re-download of the whole file.
                $bytes = [IO.File]::ReadAllBytes($video)
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
                $type = 'video/mp4'
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
    }
} finally {
    $listener.Stop()
    $listener.Close()
}
