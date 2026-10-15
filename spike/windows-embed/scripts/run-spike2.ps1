Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
}
"@

function Shot($path, $rect) {
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  $bmp = New-Object Drawing.Bitmap $w, $h
  $g = [Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object Drawing.Size $w, $h))
  $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "shot: $path  (${w}x${h})"
}

$root = 'C:\Users\menot\streamingapp-spike'
$exeDir = Join-Path $root 'win-embed\target\debug'
Remove-Item (Join-Path $root 'spike.log') -ErrorAction SilentlyContinue

$p = Start-Process -FilePath (Join-Path $exeDir 'spike-embed.exe') -WorkingDirectory $exeDir -PassThru
Start-Sleep -Seconds 4

$proc = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
$hwnd = $proc.MainWindowHandle
[W]::SetForegroundWindow($hwnd) | Out-Null
$rect = New-Object W+RECT
[W]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
"window rect: $($rect.Left),$($rect.Top) .. $($rect.Right),$($rect.Bottom)"

Start-Sleep -Seconds 3
Shot (Join-Path $root 'win-before.png') $rect          # before the auto-crop fires

# Synthesized click in the middle of the video area: if the webview logs it,
# input reaches the webview where mpv is rendering underneath.
$cx = [int](($rect.Left + $rect.Right) / 2)
$cy = [int](($rect.Top + $rect.Bottom) / 2) - 60
[W]::SetCursorPos($cx, $cy) | Out-Null
Start-Sleep -Milliseconds 300
[W]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # LEFTDOWN
Start-Sleep -Milliseconds 80
[W]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # LEFTUP
"synthesized click at $cx,$cy"

Start-Sleep -Seconds 3
Shot (Join-Path $root 'win-cropped.png') $rect         # auto-crop should be visible

Start-Sleep -Seconds 6
Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

'--- evidence lines'
Get-Content (Join-Path $root 'spike.log') -ErrorAction SilentlyContinue |
  Where-Object { $_ -match 'COMMAND|WEBVIEW GOT CLICK|mpv child|repositioned|video-crop' }
