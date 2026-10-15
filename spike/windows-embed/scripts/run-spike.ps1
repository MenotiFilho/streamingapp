$root = 'C:\Users\menot\streamingapp-spike'
$exeDir = Join-Path $root 'win-embed\target\debug'
Remove-Item (Join-Path $root 'spike.log') -ErrorAction SilentlyContinue

$p = Start-Process -FilePath (Join-Path $exeDir 'spike-embed.exe') `
                   -WorkingDirectory $exeDir -PassThru
Start-Sleep -Seconds 14

'--- process'
Get-Process -Id $p.Id -ErrorAction SilentlyContinue |
  Select-Object Id, ProcessName, MainWindowTitle | Format-List

'--- screenshot of the virtual screen'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$vs = [Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object Drawing.Bitmap $vs.Width, $vs.Height
$gfx = [Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($vs.Location, [Drawing.Point]::Empty, $bmp.Size)
$bmp.Save((Join-Path $root 'screenshot.png'), [Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose(); $bmp.Dispose()
'screenshot saved'

Start-Sleep -Seconds 10
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

'--- spike.log'
Get-Content (Join-Path $root 'spike.log') -ErrorAction SilentlyContinue
