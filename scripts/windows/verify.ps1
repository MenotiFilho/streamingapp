# Walks the Host's manual checklist on the Windows side, where a window can be
# opened, and leaves screenshots, an assertion report and the log tail in
# `evidence\`.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify.ps1 -Tree C:\Users\<you>\streamingapp-verify
#
# The window is read and driven through UI Automation (Chromium's accessibility
# tree), so each step is asserted rather than eyeballed, and screenshotted so a
# person can see it too. This is a by-hand walkthrough, not a test suite: it is
# run deliberately, never in CI.
param(
    [Parameter(Mandatory)][string] $Tree,
    [string] $Evidence
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);

  // The process owns several top-level windows - the single-instance instance
  // window and tao's event target are 16x16 and equally "main" - so wait for the
  // one that is really the Host: Tauri's own window class, or failing that a
  // window too big to be a helper.
  public static IntPtr HostWindow(uint wanted, long minArea) {
    IntPtr byClass = IntPtr.Zero;
    IntPtr big = IntPtr.Zero;
    long best = 0;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != wanted || !IsWindowVisible(h)) { return true; }
      var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
      RECT r; GetWindowRect(h, out r);
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (cls.ToString() == "Tauri Window") { byClass = h; return false; }
      if (area >= minArea && area > best) { best = area; big = h; }
      return true;
    }, IntPtr.Zero);
    return byClass != IntPtr.Zero ? byClass : big;
  }

  // Every top-level window the process owns, for when the Host's is not there.
  public static List<string> All(uint wanted) {
    var found = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == wanted) { found.Add(Describe(h)); }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string Describe(IntPtr h) {
    var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
    RECT r; GetWindowRect(h, out r);
    return String.Format("class='{0}' rect={1},{2}..{3},{4} ({5}x{6})",
      cls.ToString(), r.Left, r.Top, r.Right, r.Bottom, (r.Right - r.Left), (r.Bottom - r.Top));
  }

  public static bool Close(IntPtr h) { return PostMessage(h, 0x0010 /*WM_CLOSE*/, IntPtr.Zero, IntPtr.Zero); }
}
"@

if (-not $Evidence) { $Evidence = Join-Path $Tree 'evidence' }
New-Item -ItemType Directory -Force $Evidence | Out-Null

$exe = Join-Path $Tree 'target\release\streamingapp.exe'
if (-not (Test-Path $exe)) { throw "no executable at $exe - run build.ps1 first" }
$dataDir = Join-Path $env:APPDATA 'dev.streamingapp.host'
$log = Join-Path $dataDir 'host.log'
$failures = New-Object Collections.Generic.List[string]

# A Host left over from an earlier run would hold the single instance, and its
# window would answer for the one this script starts.
Get-Process streamingapp -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

function Check($what, $condition, $detail) {
    if ($condition) { "PASS  $what" }
    else { "FAIL  $what -- $detail"; $script:failures.Add($what) }
}

# Start the Host and wait for its window, returning `@{ Process; Handle }`.
function Start-Host($seconds = 45) {
    $process = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        # 300x300: the helper windows are 16x16, the Host's is its configured size.
        $handle = [W]::HostWindow([uint32]$process.Id, 90000)
        if ($handle -ne [IntPtr]::Zero) {
            Start-Sleep -Seconds 2
            return @{ Process = $process; Handle = $handle }
        }
        Start-Sleep -Milliseconds 500
    }
    'windows the Host owns, if any:'
    [W]::All([uint32]$process.Id) | ForEach-Object { "  $_" }
    throw 'the Host never opened a window'
}

# A window close, so the Host exits the way a person leaves it and its log writer
# flushes; killing the process would skip both.
function Stop-Host($app) {
    [W]::Close($app.Handle) | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
        if (-not [W]::IsWindow($app.Handle)) { return }
        Start-Sleep -Milliseconds 500
    }
    Stop-Process -Id $app.Process.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

function Focus($app) {
    [W]::SetForegroundWindow($app.Handle) | Out-Null
    Start-Sleep -Milliseconds 700
    if ([W]::GetForegroundWindow() -ne $app.Handle) {
        'note: the Host window did not take the foreground; UI Automation reads it anyway'
    }
}

function Shot($app, $name) {
    $r = New-Object W+RECT
    [W]::GetWindowRect($app.Handle, [ref]$r) | Out-Null
    $w = $r.Right - $r.Left
    $h = $r.Bottom - $r.Top
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object Drawing.Size $w, $h))
    $bmp.Save((Join-Path $Evidence $name), [Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    "shot: $name (${w}x${h})"
}

# --- reading and driving the window ------------------------------------------
#
# Chromium exposes the page as a tree of elements whose Name is their text, and it
# builds that tree only once a client asks for it, so every lookup here waits.

function Window-Root($app) {
    [Windows.Automation.AutomationElement]::FromHandle($app.Handle)
}

function Find-Element($root, $name, $controlType, $seconds = 10) {
    $byName = New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::NameProperty, $name)
    $condition = $byName
    if ($controlType) {
        $byType = New-Object Windows.Automation.PropertyCondition(
            [Windows.Automation.AutomationElement]::ControlTypeProperty, $controlType)
        $condition = New-Object Windows.Automation.AndCondition($byName, $byType)
    }
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $found = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
        if ($found) { return $found }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

function Page-Text($app) {
    $root = Window-Root $app
    $all = $root.FindAll([Windows.Automation.TreeScope]::Descendants,
        [Windows.Automation.Condition]::TrueCondition)
    (($all | ForEach-Object { $_.Current.Name }) -join ' | ')
}

# The window is React over Chromium: give it a moment to catch up with the
# Snapshot before deciding it did not.
function Wait-Text($app, $pattern, $seconds = 10) {
    $deadline = (Get-Date).AddSeconds($seconds)
    $text = ''
    while ((Get-Date) -lt $deadline) {
        $text = Page-Text $app
        if ($text -match $pattern) { return $text }
        Start-Sleep -Milliseconds 500
    }
    return $text
}

function Shows($app, $name, $seconds = 8) {
    (Find-Element (Window-Root $app) $name $null $seconds) -ne $null
}

function Set-Language($app, $tag) {
    # 'Prefer a language tag' is both the label and the input's accessible name,
    # so ask for the editable one.
    $edit = Find-Element (Window-Root $app) 'Prefer a language tag' ([Windows.Automation.ControlType]::Edit)
    if (-not $edit) { throw "the window shows no 'Prefer a language tag' field" }
    $pattern = $null
    if ($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $pattern.SetValue($tag)
    } else {
        $edit.SetFocus()
        [Windows.Forms.SendKeys]::SendWait($tag)
    }
    Start-Sleep -Milliseconds 300
    Press $app 'Save'
}

function Press($app, $label) {
    $button = Find-Element (Window-Root $app) $label ([Windows.Automation.ControlType]::Button)
    if (-not $button) { throw "the window shows no $label button" }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 1
}

# --- the checklist ------------------------------------------------------------

Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dataDir 'host.sqlite3*') -ErrorAction SilentlyContinue

'--- 1. launching the Host opens a window'
$app = Start-Host
Focus $app
Start-Sleep -Seconds 2
Shot $app '01-start.png'
$text = Wait-Text $app 'Snapshot revision'
Check 'the window shows a Snapshot revision' ($text -match 'Snapshot revision') "showed: $text"
Check 'the snapshot it shows is revision 0' (
    $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"
Check 'a fresh Host has no subtitle language preference' ($text -match 'none') "showed: $text"

'--- 2. changing the preference goes through the Action surface'
Set-Language $app 'pt-BR'
Shot $app '02-saved.png'
$text = Wait-Text $app 'pt-BR'
Check 'the window shows the new preference' (Shows $app 'pt-BR') "showed: $text"
Check 'the window shows the new revision' (
    $text -match 'Snapshot revision\s*\|\s*1') "showed: $text"

'--- 3. launching again focuses the running Host instead of starting a second one'
$second = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
Start-Sleep -Seconds 8
Check 'the second launch exited' (
    -not (Get-Process -Id $second.Id -ErrorAction SilentlyContinue)) 'a second Host is still running'
Check 'the first Host is still the one running' (
    -not $app.Process.HasExited) 'the first Host died'
Shot $app '03-after-second-launch.png'

'--- 4. the preference survives a restart'
Stop-Host $app
Check 'the Host logged the Snapshot it published' (
    (Test-Path $log) -and (Select-String -Path $log -Pattern 'publishing a Snapshot' -Quiet)) 'no publish line in host.log'
Check 'the Host logged the second launch' (
    (Test-Path $log) -and (Select-String -Path $log -Pattern 'already running' -Quiet)) 'no "already running" line in host.log'

$restarted = Start-Host
Focus $restarted
Start-Sleep -Seconds 2
Shot $restarted '04-restarted.png'
$text = Wait-Text $restarted 'pt-BR'
Check 'the restarted Host still prefers pt-BR' (Shows $restarted 'pt-BR') "showed: $text"
Check 'the restarted Host starts a fresh revision' (
    $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"

'--- 5. a language that is not a tag is refused without touching state'
Set-Language $restarted 'Brazilian Portuguese'
Shot $restarted '05-refused.png'
$text = Wait-Text $restarted 'not a subtitle language tag'
Check 'the window explains the refusal' (
    $text -match 'not a subtitle language tag') "showed: $text"
Check 'the preference is untouched' (Shows $restarted 'pt-BR') "showed: $text"
Check 'the refused Action did not move the revision' (
    $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"

'--- 6. clearing the preference'
Press $restarted 'Clear'
Shot $restarted '06-cleared.png'
$text = Wait-Text $restarted 'none'
Check 'the window shows no preference' ($text -match 'none') "showed: $text"
Check 'clearing it moved the revision on' (
    $text -match 'Snapshot revision\s*\|\s*1') "showed: $text"

Stop-Host $restarted

'--- 7. the data directory'
if (Test-Path $dataDir) {
    Get-ChildItem $dataDir | ForEach-Object { "  $($_.Name)  $($_.Length) bytes" }
} else { Check 'the data directory exists' $false $dataDir }

'--- host.log (last 20 lines)'
if (Test-Path $log) { Get-Content $log -Tail 20 } else { 'no host.log' }

''
if ($failures.Count -eq 0) { 'ALL CHECKS PASSED' }
else {
    "FAILED CHECKS ($($failures.Count)):"
    $failures | ForEach-Object { "  - $_" }
    exit 1
}
