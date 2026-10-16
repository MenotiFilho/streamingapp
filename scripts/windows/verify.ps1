# Walks the Host's manual checklist on the Windows side, where a window can be
# opened, and leaves screenshots, an assertion report and the log tail in
# `evidence\`.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify.ps1 -Tree C:\Users\<you>\streamingapp-verify
#
# The Addon it configures is a parameter, so the walkthrough can be run against
# the Addon the owner actually uses — including one whose manifest URL carries a
# debrid configuration, which is the case the "the URL never leaves the Host"
# checks are for:
#
#   ... -Addon 'https://api.stremboxd.com/manifest.json' -AddonName Stremboxd `
#       -AddonId community.stremboxd -AddonCatalog 'Popular This Week'
#
# The window is read and driven through UI Automation (Chromium's accessibility
# tree), so each step is asserted rather than eyeballed, and screenshotted so a
# person can see it too. This is a by-hand walkthrough, not a test suite: it is
# run deliberately, never in CI.
#
# The window is placed on `-Monitor` (1-based, left to right) and filled to that
# monitor's working area, so the run does not disturb whatever else is on screen
# and the screenshots show the Host rather than whatever has the foreground:
#
#   ... -Monitor 3
param(
    [Parameter(Mandatory)][string] $Tree,
    [string] $Evidence,
    [string] $Addon = 'https://v3-cinemeta.strem.io/manifest.json',
    [string] $AddonName = 'Cinemeta',
    [string] $AddonId = 'com.linvo.cinemeta',
    [string] $AddonCatalog = 'Popular',
    [string] $SearchQuery = 'matrix',
    [int] $Monitor = 1
)

# Non-ASCII inside a string literal would be read through the console's code
# page (this file has no BOM), so the em dash the window's Streams heading uses
# is built from its code point instead of written out.
$dash = [char]0x2014

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
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int ht, bool repaint);

  // Put the window on one monitor and fill its working area, so a run does not
  // sit on top of whatever else the machine is doing.
  public static void Place(IntPtr h, int x, int y, int w, int ht) {
    MoveWindow(h, x, y, w, ht, true);
  }

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

  // The children of a window, in the order Windows keeps them: the topmost
  // first. mpv's picture is one of these, and the interface's webview another,
  // so the order is what says which of the two is on top.
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
  public static List<string> Children(IntPtr h) {
    var found = new List<string>();
    EnumChildWindows(h, delegate(IntPtr child, IntPtr l) {
      var cls = new StringBuilder(256); GetClassNameW(child, cls, 256);
      RECT r; GetWindowRect(child, out r);
      found.Add(String.Format("{0} ({1}x{2})", cls.ToString(), (r.Right - r.Left), (r.Bottom - r.Top)));
      return true;
    }, IntPtr.Zero);
    return found;
  }

  // A real click at a point on the screen, the way a mouse does it. The picture
  // is a window of its own behind the webview, so whether a click reaches the
  // interface is not something an InvokePattern can answer: the pointer has to
  // actually be there. Moves the pointer, which is why the walkthrough fills
  // the leftmost monitor and puts the Host at the front.
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(150);
    mouse_event(0x0002 /*MOUSEEVENTF_LEFTDOWN*/, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004 /*MOUSEEVENTF_LEFTUP*/, 0, 0, 0, IntPtr.Zero);
  }
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
            $area = (Screen-For $Monitor).WorkingArea
            [W]::Place($handle, $area.X, $area.Y, $area.Width, $area.Height)
            Start-Sleep -Seconds 1
            return @{ Process = $process; Handle = $handle }
        }
        Start-Sleep -Milliseconds 500
    }
    'windows the Host owns, if any:'
    [W]::All([uint32]$process.Id) | ForEach-Object { "  $_" }
    throw 'the Host never opened a window'
}

# The monitor the walkthrough runs on, 1-based and numbered left to right, which
# is what a person means by "the third one".
function Screen-For($index) {
    $screens = @([Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X })
    if ($index -lt 1 -or $index -gt $screens.Count) {
        throw "there is no monitor $index; this machine has $($screens.Count)"
    }
    return $screens[$index - 1]
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
    return [W]::GetForegroundWindow() -eq $app.Handle
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

# The window is React over Chromium: give it a moment to *stop* saying something.
function Wait-No-Text($app, $pattern, $seconds = 30) {
    $deadline = (Get-Date).AddSeconds($seconds)
    $text = ''
    while ((Get-Date) -lt $deadline) {
        $text = Page-Text $app
        if ($text -notmatch $pattern) { return $text }
        Start-Sleep -Milliseconds 500
    }
    return $text
}

# A key press on the focused window, for the mouse-less path.
# A key press on the focused window, for the mouse-less path. SendKeys goes to
# whatever has the foreground, so not having it is a failure rather than a note:
# sending the keys elsewhere and then asserting on the Host would be a lie.
function Press-Keys($app, $keys) {
    if (-not (Focus $app)) { throw 'the keyboard steps need the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait($keys)
    Start-Sleep -Milliseconds 600
}

# Put the keyboard focus on a control by its accessible name, so a key press
# starts from a place the script knows rather than wherever focus happened to be.
function Focus-On($app, $name, $controlType) {
    $element = Find-Element (Window-Root $app) $name $controlType 10
    if (-not $element) { throw "the window shows no '$name' to focus" }
    $element.SetFocus()
    Start-Sleep -Milliseconds 400
}

function Set-Language($app, $tag) {
    # 'Prefer a language tag' is both the label and the input's accessible name,
    # so ask for the editable one.
    Type-Into $app 'Prefer a language tag' $tag
    Press $app 'Save'
}

# Fill the TMDB key field. It is a password input, so Chromium exposes it as an
# Edit whose value a client should not set through the value pattern: it is
# focused and typed at, the way a person would.
function Set-TmdbKey($app, $key) {
    Focus-On $app 'TMDB API key or read-access token' ([Windows.Automation.ControlType]::Edit)
    if (-not (Focus $app)) { throw 'the keyboard steps need the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait($key)
    Start-Sleep -Milliseconds 300
}

function Set-Search($app, $query) {
    Type-Into $app 'Search the Addons that offer it' $query
    Press $app 'Search'
}

# Fill a field by its accessible name. Chromium exposes the value pattern, so the
# text is set rather than typed; SendKeys is the fallback for when it does not.
function Type-Into($app, $name, $value) {
    $edit = Find-Element (Window-Root $app) $name ([Windows.Automation.ControlType]::Edit)
    if (-not $edit) { throw "the window shows no '$name' field" }
    $pattern = $null
    if ($edit.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        $pattern.SetValue($value)
    } else {
        $edit.SetFocus()
        [Windows.Forms.SendKeys]::SendWait($value)
    }
    Start-Sleep -Milliseconds 300
}

function Press($app, $label) {
    $button = Find-Element (Window-Root $app) $label ([Windows.Automation.ControlType]::Button)
    if (-not $button) { throw "the window shows no $label button" }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 1
}

# The candidates on the Streams surface. They are the only buttons there whose
# accessible name is the Addon's own words about a Stream — badges, description
# and file name, which is long — where the surface's own controls ("Back to the
# Videos") are two words. An unplayable candidate says so in that same name.
function Candidates($app) {
    $buttons = (Window-Root $app).FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        (New-Object Windows.Automation.PropertyCondition(
            [Windows.Automation.AutomationElement]::ControlTypeProperty,
            [Windows.Automation.ControlType]::Button)))
    @($buttons | Where-Object {
        $_.Current.Name -and $_.Current.Name.Length -gt 40
    })
}

# The children of the Host's window, topmost first.
function Children-Of($app) {
    [W]::Children($app.Handle)
}

# Where playback is, in seconds, read off the OSD's clock: `12:34 / 1:20:00`,
# or `--:--` while a Stream is still opening. -1 when there is no clock to read.
function Clock-Seconds($app) {
    $text = Page-Text $app
    $hours = [regex]::Match($text, '(\d+):(\d\d):(\d\d) / ')
    if ($hours.Success) {
        return ([int]$hours.Groups[1].Value * 3600) + ([int]$hours.Groups[2].Value * 60) +
            [int]$hours.Groups[3].Value
    }
    $minutes = [regex]::Match($text, '(\d+):(\d\d) / ')
    if ($minutes.Success) {
        return ([int]$minutes.Groups[1].Value * 60) + [int]$minutes.Groups[2].Value
    }
    return -1
}

# Choose a candidate and walk what playing it looks like, reporting as it goes.
#
# A candidate the Host can play starts playing when it is pressed; one it cannot
# says so and stays in the list. Whether the Addon answered either is the
# Addon's business, which is why this walks whatever is there and says what it
# found.
function Play-A-Candidate($app) {
    $candidates = Candidates $app
    if (-not $candidates) {
        'the Addon answered no candidates at all, so there is nothing to play:'
        'run with -Addon <an Addon that answers playable Streams> to walk playback'
        return
    }

    $playable = @($candidates | Where-Object { $_.Current.Name -notmatch 'Not playable yet' })
    $chosen = if ($playable) { $playable[0] } else { $candidates[0] }
    $chosen.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 2

    if (-not $playable) {
        # Every candidate is one this version cannot open: the window says so
        # and the video never appears.
        $text = Wait-Text $app 'Not playable yet' 20
        Shot $app '12-stream-unplayable.png'
        Check 'a candidate this Host cannot play says so rather than pretending' (
            $text -match 'Not playable yet') "showed: $text"
        Check 'and nothing is drawn for a Stream that will not play' (
            -not (Shows $app 'Play or pause' 2)) "showed: $text"
        return
    }

    $text = Wait-Text $app 'Playing ' 30
    Shot $app '12b-playing.png'
    Check 'choosing a candidate the Host can play starts playing it' (
        $text -match 'Playing ') "showed: $text"

    '--- 12b. the picture is mpv''s, the interface is drawn above it, and the controls work'

    # The picture is a window of mpv's own, made a child of the Host's window;
    # the interface is the webview, and it has to be above the picture or the
    # video would cover every control.
    $children = Children-Of $app
    $mpvAt = -1
    $webviewAt = -1
    for ($i = 0; $i -lt $children.Count; $i++) {
        if ($mpvAt -lt 0 -and $children[$i] -match '^mpv') { $mpvAt = $i }
        if ($webviewAt -lt 0 -and $children[$i] -match 'Chrome_WidgetWin|WebView') { $webviewAt = $i }
    }
    Check 'the picture is mpv''s own window, inside the Host''s window' (
        $mpvAt -ge 0) "children of the window, topmost first: $($children -join ' | ')"
    Check 'the interface is drawn above the picture' (
        ($webviewAt -ge 0) -and ($webviewAt -lt $mpvAt)) (
        "the webview is at $webviewAt and the picture at $mpvAt: $($children -join ' | ')")

    # A click in the middle of the picture has to reach the interface: the
    # picture's window must not be the one that hears it. Pressing the picture
    # pauses, and the OSD then offers Play where it offered Pause.
    $rect = New-Object W+RECT
    [W]::GetWindowRect($app.Handle, [ref]$rect) | Out-Null
    $atX = [int](($rect.Left + $rect.Right) / 2)
    $atY = [int]($rect.Top + (($rect.Bottom - $rect.Top) * 0.35))
    if (Shows $app 'Pause' 10) {
        [W]::Click($atX, $atY)
        Check 'a click over the video lands on the interface rather than on the picture' (
            (Shows $app 'Play' 15)) (Page-Text $app)
    } else {
        'the Stream is not playing, so the click-over-the-video step is skipped'
    }

    # Play, pause, seek and stop, through the interface the Host's own window
    # draws: the same Actions a remote client takes (ADR-0002).
    Press $app 'Play'
    $text = Wait-Text $app 'Pause' 15
    Check 'the interface plays and pauses' (Shows $app 'Pause' 10) "showed: $text"

    $before = Clock-Seconds $app
    Press $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    $after = Clock-Seconds $app
    Check 'seeking forward moves playback on' (
        ($after -gt $before) -and ($before -ge 0)) "the clock went $before -> $after"

    Press $app 'Back ten seconds'
    Start-Sleep -Seconds 2
    $back = Clock-Seconds $app
    Check 'seeking back moves it back' (
        ($back -lt $after) -and ($back -ge 0)) "the clock went $after -> $back"

    Press $app 'Pause'
    $text = Wait-Text $app 'Play' 15
    Check 'pausing is the same door as playing' (Shows $app 'Play' 10) "showed: $text"

    $revision = ([regex]::Match((Page-Text $app), 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value

    # What mpv is decoding with is in the Host's log, because no Snapshot
    # carries it yet (#28's statistics are where a client reads it): a Stream
    # playing is the only moment it can be read.
    Start-Sleep -Seconds 1
    $decode = Select-String -Path $log -Pattern 'the picture is playing' |
        Select-Object -Last 1
    Check 'the Host logged what mpv is decoding with' (
        $decode -ne $null) 'no "the picture is playing" line in host.log'
    Check 'hardware decode is engaged (not "no")' (
        $decode -and $decode.Line -notmatch 'hwdec="no"') "logged: $($decode.Line)"
    Check 'and the picture is mpv''s own output, not a texture the Host made' (
        $decode -and $decode.Line -match 'pixelformat="(d3d11|dxva|nv12|p010|yuv420p|yuv420p10)"') (
        "logged: $($decode.Line)")

    Press $app 'Stop'
    $text = Wait-Text $app ("Streams $dash") 20
    Shot $app '12c-stopped.png'
    Check 'stopping returns the client to the Stream list it chose from' (
        $text -match ("Streams $dash")) "showed: $text"
    Check 'and playback published Snapshots of its own along the way' (
        $revision -ne '') "showed: $text"
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

'--- 7. configuring an Addon by manifest URL'
$app = Start-Host
Focus $app
Start-Sleep -Seconds 2
Shot $app '07-addons-empty.png'
$text = Wait-Text $app 'No Addons are configured'
Check 'a fresh Host has no Addons' ($text -match 'No Addons are configured') "showed: $text"

Type-Into $app 'Addon manifest URL' $Addon
Press $app 'Add'
$text = Wait-Text $app ([regex]::Escape($AddonId)) 25
Shot $app '08-addon-added.png'
Check 'the Addon is listed by its name' ($text -match [regex]::Escape($AddonName)) "showed: $text"
Check 'the Addon is listed by the id in its manifest' (
    $text -match [regex]::Escape($AddonId)) "showed: $text"
Check 'the resources it offers are listed' (
    ($text -match 'Resources') -and ($text -match 'catalog')) "showed: $text"
Check 'the types it covers are listed' (
    ($text -match 'Types') -and ($text -match 'movie')) "showed: $text"
Check 'its catalogs are listed' (
    $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
Check 'the manifest URL is nowhere in the window' (
    $text -notmatch [regex]::Escape($Addon)) "showed: $text"

'--- 8. a URL that is not an Addon is refused without losing the Addon that works'
Type-Into $app 'Addon manifest URL' 'https://example.com/'
Press $app 'Add'
$text = Wait-Text $app "could not read that Addon's manifest" 25
Shot $app '09-addon-refused.png'
Check 'the refusal is explained' ($text -match "could not read that Addon's manifest") "showed: $text"
Check 'the Addon that was working is still listed' (
    $text -match [regex]::Escape($AddonId)) "showed: $text"

'--- 9. the Addon survives a restart'
Stop-Host $app
$app = Start-Host
Focus $app
Start-Sleep -Seconds 2
Shot $app '10-addon-restarted.png'
$text = Wait-Text $app ([regex]::Escape($AddonId)) 25
Check 'the restarted Host still has the Addon' (
    $text -match [regex]::Escape($AddonId)) "showed: $text"

'--- 10. the home surface draws a row for each catalog the Addon offers'
# A moment, so the window is certainly in its loading state and the wait below is
# waiting for rows rather than for the effect that asks for them to start.
Start-Sleep -Seconds 2
$text = Wait-No-Text $app 'Loading' 45
Shot $app '10-catalog-rows.png'
Check 'the rows stopped loading' (
    -not ($text -match 'Loading')) "showed: $text"
Check 'a row is drawn for the Addon catalog' (
    $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
Check 'the window says how many Addons are configured' (
    $text -match 'Addons? configured') "showed: $text"
Check 'the manifest URL is still nowhere in the window' (
    $text -notmatch [regex]::Escape($Addon)) "showed: $text"
# The posters are images the window loads from the Addon, and UI Automation does
# not expose them, so the screenshot is the evidence a person reads here.
'review 10-catalog-rows.png: each row should show poster images, not empty frames'
$revision = ([regex]::Match($text, 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value

'--- 11. the keyboard reaches a card, and OK opens the Title'
# The Title surface is the way back, the metadata line naming the Addon that
# answered, and — for a series — its seasons and episodes. Nothing above this is
# a Title: which one a client has open is that client's own (ADR-0005), so the
# rows are still what is showing and the revision has not moved.
Check 'no Title is open yet' (
    $text -notmatch 'This Title is one Video') "showed: $text"
# From the search box: down past the Search button, onto the first card. The
# focus is put there first rather than assumed.
Focus-On $app 'Search the Addons that offer it' ([Windows.Automation.ControlType]::Edit)
Press-Keys $app '{DOWN}{DOWN}'
Press-Keys $app '{ENTER}'
$text = Wait-Text $app 'Back to browsing' 15
Shot $app '11-title-opened.png'
Check 'the arrow keys reached a card and OK opened the Title' (
    $text -match 'Back to browsing') "showed: $text"
# The identity line arrives whole — 'com.linvo.cinemeta · movie/tt22084616' — so
# the Addon that answered and the item it answered about are read as one phrase.
# The separator is spelled `\S+` because PowerShell 5.1 reads this file as ANSI
# and a literal middle dot in the pattern would not survive the trip.
Check 'the opened Title names the Addon that answered for it, and the item' (
    $text -match ([regex]::Escape($AddonId) + '\s+\S+\s+[A-Za-z0-9_-]+/[^|\s]+')) "showed: $text"
Check 'opening a Title is a question: the revision stands still' (
    $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"
$film = $text -match 'This Title is one Video'
$series = $text -match 'Season \d+'
$noEpisodes = $text -match 'listed no episodes'
Check 'the opened Title is a film, or a series with its seasons' (
    $film -or $series -or $noEpisodes) "showed: $text"
$kind = 'film'
if ($series) { $kind = 'series' }
if ($noEpisodes) { $kind = 'series with no episodes listed' }
"opened a $kind"
# The unmapped mark says no TMDB record met the Title, and that it stays keyed by
# its Addon. With no key held, an id only TMDB could map cannot have been mapped;
# a key already held — the owner's own, say — legitimately can have been.
if ($text -match '/tmdb:') {
    'the Addon keyed its Title by TMDB itself, so the unmapped mark is not the case here'
} elseif ($text -match 'A TMDB key is held') {
    'a key is already held, so this Title may be mapped rather than unmapped'
} else {
    Check 'a Title no TMDB record met is marked unmapped' (
        $text -match 'Unmapped') "showed: $text"
}
'the series case — seasons, episodes, and choosing one — is step 14.'

'--- 12. pressing a Video asks the Addons for its Streams'
if ($series) {
    # The Title's way back is its first focusable, so one press down lands on the
    # first episode and OK presses play on it: the window asks the Host for that
    # Video's Streams and shows what came back. Whether candidates arrive is the
    # Addon's business — Cinemeta answers no `stream` resource at all — so this
    # checks the surface, and walks the candidates when there are any.
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app ("Streams $dash") 20
    Shot $app '12-episode-streams.png'
    Check 'pressing an episode asks for its Streams, and the list is what came back' (
        $text -match ("Streams $dash")) "showed: $text"
    if ($text -match 'No configured Addon offers Streams') {
        'the configured Addon answers no `stream` resource, so the list is empty:'
        'run with -Addon <a stream Addon> to walk the candidates themselves'
    } else {
        Play-A-Candidate $app
    }
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Season' 15
    Check 'Back leaves the Streams and returns to the episodes' (
        $text -match 'Season \d+') "showed: $text"
} elseif ($noEpisodes) {
    'the Title opened is a series whose Addon listed no episodes, so there is no Video to press play on'
} else {
    # A film is one Video — the film itself — so its Title screen offers Play.
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app ("Streams $dash") 20
    Shot $app '12-film-streams.png'
    Check 'pressing play on a film asks for its Streams, and the list is what came back' (
        $text -match ("Streams $dash")) "showed: $text"
    if ($text -match 'No configured Addon offers Streams') {
        'the configured Addon answers no `stream` resource, so the list is empty:'
        'run with -Addon <a stream Addon> to walk the candidates themselves'
    } else {
        Play-A-Candidate $app
    }
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'one Video: the film itself' 15
    Check 'Back leaves the Streams and returns to the film' (
        $text -match 'one Video: the film itself') "showed: $text"
}

'--- 13. Back leaves the Title, and the same Title opens again'
Press-Keys $app '{ESC}'
$text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
Shot $app '13-title-back.png'
Check 'Back returns to the rows' (
    $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
Check 'and the Title surface is gone' (
    $text -notmatch 'Back to browsing') "showed: $text"

Focus-On $app 'Search the Addons that offer it' ([Windows.Automation.ControlType]::Edit)
Press-Keys $app '{DOWN}{DOWN}'
Press-Keys $app '{ENTER}'
$text = Wait-Text $app 'Back to browsing' 15
Shot $app '13-title-reopened.png'
Check 'the same Title opens again' (
    $text -match 'Back to browsing') "showed: $text"
Check 'and opening it moved nothing either' (
    $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"

# Back out once more, so the steps below are on the rows rather than in a Title.
Press-Keys $app '{ESC}'
$text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
Check 'and Back leaves it again' (
    ($text -match [regex]::Escape($AddonCatalog)) -and
    ($text -notmatch 'Back to browsing')) "showed: $text"

'--- 14. a series'' seasons and episodes, and choosing one'
# A series without the keyboard having to know how many cards the first row
# holds: `More from …` closes a row, so the button after the first one of those
# is the first card of the second row — which, for the Addon this walkthrough
# runs against by default, is its series catalog.
$buttons = (Window-Root $app).FindAll(
    [Windows.Automation.TreeScope]::Descendants,
    (New-Object Windows.Automation.PropertyCondition(
        [Windows.Automation.AutomationElement]::ControlTypeProperty,
        [Windows.Automation.ControlType]::Button)))
$series = $null
for ($i = 0; $i -lt $buttons.Count - 1; $i++) {
    if ($buttons[$i].Current.Name -eq ('More from ' + $AddonCatalog)) {
        $series = $buttons[$i + 1]
        break
    }
}

if ($series) {
    $series.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $text = Wait-Text $app 'Back to browsing' 15
    Shot $app '14-series-opened.png'
    Check 'the second row opens a Title of its own kind' (
        $text -match ([regex]::Escape($AddonId) + '\s+\S+\s+series/')) "showed: $text"
    Check 'a series shows a heading per season' (
        $text -match 'Season \d+') "showed: $text"
    Check 'and an episode for each' (
        $text -match 'S\d+E\d+') "showed: $text"
    # The way back is the Title's first focusable, so one press down lands on the
    # first episode and OK presses play on it: the Streams surface replaces the
    # episodes. Escape is Back, so two presses leave the Streams, then the series.
    Focus-On $app 'Back to browsing' ([Windows.Automation.ControlType]::Button)
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app ("Streams $dash") 20
    Shot $app '14-series-streams.png'
    Check 'pressing an episode opens the Streams surface over the episodes' (
        $text -match ("Streams $dash")) "showed: $text"
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Season' 15
    Check 'Back leaves the Streams and returns to the episodes' (
        $text -match 'Season \d+') "showed: $text"
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
    Check 'and Back leaves the series again' (
        $text -notmatch 'Back to browsing') "showed: $text"
} else {
    'this Addon answered with a single row, so there was no second one to open'
    'by hand: open a series row and check its seasons and episodes'
}

'--- 15. paging a row is not a change: the revision stands still'
$more = Find-Element (Window-Root $app) ('More from ' + $AddonCatalog) ([Windows.Automation.ControlType]::Button) 10
if ($more) {
    $more.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 3
    $text = Wait-No-Text $app 'Loading' 30
    Shot $app '15-paged.png'
    Check 'the row paged on without emptying' (
        $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
    Check 'paging is a question, not a change: the revision stands still' (
        $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"
} else {
    Check 'the Addon catalog offers a way to page on' $false 'no More button'
}

'--- 16. searching asks every Addon that offers it'
Set-Search $app $SearchQuery
$text = Wait-Text $app 'Back to browsing' 30
Shot $app '16-search.png'
Check 'the search surface is showing' (
    $text -match 'Back to browsing') "showed: $text"
Check 'the search did not move the revision either' (
    $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"
'review 16-search.png: the results should be a row of posters, or a clear "no Addon answered"'

'--- 17. Back returns to browsing, from the keyboard'
# Escape is Back, so the whole of "arrows, OK and Back" is walked without the
# mouse at least once (the mouse still works everywhere else in this run).
Press-Keys $app '{ESC}'
$text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
Shot $app '17-back.png'
Check 'Back returns to the rows' (
    $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
Check 'and the search surface is gone' (
    $text -notmatch 'Back to browsing') "showed: $text"

'--- 18. the TMDB key: entered, held, cleared, and where it lives'
# The value the walkthrough enters is its own and it takes it out again before
# the step ends: the point is the round trip, not a credential. A key an earlier
# run left behind — a crash between the save and the clear — is cleared first,
# because the OS keyring is not part of the data-directory wipe at the top.
$testKey = '0123456789abcdef'
Press $app 'Clear key'
$text = Wait-Text $app 'No TMDB key is held' 15
Shot $app '18-tmdb-key-none.png'
Check 'a Host with no key says so' (
    $text -match 'No TMDB key is held') "showed: $text"
Check 'the window says which backend would hold a key' (
    ($text -match 'keyring') -or ($text -match '0600')) "showed: $text"
$before = ([regex]::Match($text, 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value

Set-TmdbKey $app $testKey
Press $app 'Save key'
$text = Wait-Text $app 'A TMDB key is held' 15
Shot $app '18-tmdb-key-saved.png'
Check 'saving a key is a change: the Snapshot says one is held' (
    $text -match 'A TMDB key is held') "showed: $text"
Check 'saving a key moved the revision on' (
    $text -match ('Snapshot revision\s*\|\s*' + ([int]$before + 1))) "showed: $text"
# The value has no place in the window; step 20 reads the log for it.
Check 'the key value is nowhere in the window' (
    $text -notmatch [regex]::Escape($testKey)) "showed: $text"

# TMDB answers with a refusal to a key that is not its own. Opening a Title must
# then degrade to the Addon's metadata rather than blanking: the find fails, and
# an id only TMDB could map cannot have been mapped with it.
Focus-On $app 'Search the Addons that offer it' ([Windows.Automation.ControlType]::Edit)
Press-Keys $app '{DOWN}{DOWN}'
Press-Keys $app '{ENTER}'
$text = Wait-Text $app 'Back to browsing' 40
Shot $app '18-tmdb-key-refused.png'
Check 'a Title still opens when TMDB refuses the key' (
    $text -match [regex]::Escape($AddonId)) "showed: $text"
if ($text -match '/tmdb:') {
    'the Addon keyed this Title by TMDB itself, so no unmapped mark is expected'
} else {
    Check 'and it is marked unmapped rather than blanked' (
        $text -match 'Unmapped') "showed: $text"
}
Press-Keys $app '{ESC}'
$text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25

Press $app 'Clear key'
$text = Wait-Text $app 'No TMDB key is held' 15
Shot $app '18-tmdb-key-cleared.png'
Check 'clearing the key says no key is held' (
    $text -match 'No TMDB key is held') "showed: $text"
Check 'and clearing moved the revision on again' (
    $text -match ('Snapshot revision\s*\|\s*' + ([int]$before + 2))) "showed: $text"

'--- 19. removing the Addon'
Press $app ('Remove ' + $AddonName)
$text = Wait-Text $app 'No Addons are configured' 20
Shot $app '19-addon-removed.png'
Check 'the Addon is gone' ($text -match 'No Addons are configured') "showed: $text"
Check 'and its rows are gone with it' (
    -not ($text -match [regex]::Escape($AddonCatalog))) "showed: $text"

Stop-Host $app

'--- 20. the manifest URL and the TMDB key never reach the log'
# A manifest URL can carry a debrid configuration inside it, so the Host must
# never write one down — and the route that matters is the real one, with the
# Addon the owner actually uses. A TMDB key is a credential the same way.
$urlPath = ([System.Uri]$Addon).AbsolutePath
Check 'the log never holds the manifest URL' (
    (Test-Path $log) -and
    -not (Select-String -Path $log -SimpleMatch $Addon -Quiet)) 'host.log holds the manifest URL'
Check 'the log never holds the manifest path either' (
    (Test-Path $log) -and
    -not (Select-String -Path $log -SimpleMatch $urlPath -Quiet)) 'host.log holds the manifest path'
Check 'the log never holds the TMDB key value' (
    (Test-Path $log) -and
    -not (Select-String -Path $log -SimpleMatch $testKey -Quiet)) 'host.log holds the TMDB key'

'--- 21. the data directory'
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
