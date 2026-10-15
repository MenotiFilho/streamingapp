# Step 0 baseline for spike #3. Writes everything to C:\Users\menot\streamingapp-spike\
# Run: powershell -ExecutionPolicy Bypass -File baseline.ps1
$ErrorActionPreference = 'Continue'
$mpv = 'C:\Program Files\MPV Player\mpv.exe'
$dir = 'C:\Users\menot\streamingapp-spike'
$clip = Join-Path $dir '4k60.mp4'

& $mpv --version | Out-File (Join-Path $dir 'mpv-version.txt') -Encoding utf8

# Real configuration: gpu-next + d3d11 + hardware decode + HDR hint.
& $mpv --no-config `
    --vo=gpu-next --gpu-api=d3d11 --gpu-context=d3d11 --d3d11-output-format=auto `
    --hwdec=auto-safe --target-colorspace-hint=yes `
    --no-audio --length=10 --no-terminal `
    --log-file="$dir\mpv-hwdec.log" `
    --dump-stats="$dir\stats-hwdec.csv" `
    $clip
"hwdec run exit=$LASTEXITCODE" | Out-File (Join-Path $dir 'baseline-result.txt') -Encoding utf8

# Same clip, decoding forced to software, for comparison.
& $mpv --no-config `
    --vo=gpu-next --gpu-api=d3d11 --gpu-context=d3d11 `
    --hwdec=no `
    --no-audio --length=10 --no-terminal `
    --log-file="$dir\mpv-swdec.log" `
    --dump-stats="$dir\stats-swdec.csv" `
    $clip
"swdec run exit=$LASTEXITCODE" | Out-File (Join-Path $dir 'baseline-result.txt') -Append -Encoding utf8

'--- done ---' | Out-File (Join-Path $dir 'baseline-result.txt') -Append -Encoding utf8
