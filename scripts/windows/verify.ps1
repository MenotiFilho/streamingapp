# Walks the Host's manual checklist on the Windows side, where a window can be
# opened, and leaves screenshots, an assertion report and the log tail in
# `evidence\`.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify.ps1 -Tree C:\Users\<you>\streamingapp-verify
#
# This is the checklist of the ten-foot shell (#87): the rail and the six
# destinations, Settings' sub-screens, Home's Featured hero and rows, the Title,
# the Streams list, and the player OSD. The Addon it configures is a parameter,
# so the walkthrough can be run against the Addon the owner actually uses.
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
#   ... -Monitor 1
#
# Any subset of the checklist can be walked on its own instead of all of it. A
# step that needs the Host or the fixture Addon has that built for it first, and
# two steps that need the same ground share the one Host; a step that reads what
# an earlier step left behind and cannot be rebuilt refuses loudly rather than
# checking the wrong state:
#
#   ... -List           the checklist and what each step needs, without a Host
#   ... -Only 13        just the OSD, over one Host and the fixture Addon
#   ... -Only 13,15     those two steps
#   ... -From 13        step 13 and every later one
param(
    # -Tree is checked below rather than made Mandatory, so -List can print the
    # checklist without a staged tree.
    [string] $Tree,
    [string] $Evidence,
    [string] $Addon = 'https://v3-cinemeta.strem.io/manifest.json',
    [string] $AddonName = 'Cinemeta',
    [string] $AddonId = 'com.linvo.cinemeta',
    [string] $AddonCatalog = 'Popular',
    [string] $SearchQuery = 'matrix',
    [int] $Monitor = 1,
    # Which steps to walk, instead of all of them: -Only 13,15 walks those two and
    # -From 13 walks that one and every later one. -List prints the checklist and
    # exits without starting a Host, which is also the cheap syntax check.
    [string[]] $Only,
    [int] $From,
    [switch] $List
)

# Non-ASCII inside a string literal would be read through the console's code
# page (this file has no BOM), so the middle dot the Settings choices use and
# the multiplication sign the speed choices use are built from their code
# points instead of written out.
$dot = [char]0x00B7
$times = [char]0x00D7
$tmdbNotice = 'This product uses the TMDB API but is not endorsed or certified by TMDB'

# The checklist, in the order a full run walks it. `-List` prints this and exits;
# the dispatcher uses it to decide what to run and what to refuse.
#
# `Ground` is what the runner has to establish before the step:
#   'fresh' - the empty data directory the run begins with, and one Host running
#   'addon' - that Host with the fixture Addon configured, its first Catalog
#             featured, and Home showing its hero
#   'rows'  - the same, waiting for the Home rows (kept so a step can say it
#             stands at the rows rather than at a pushed level)
#   'data'  - only that the data directory exists (step 22 lists it)
# `After` is the earlier steps whose leftovers this step reads and that must have
# run in the same invocation; `Need` is the words `-List` prints for both.
$Steps = @(
    [pscustomobject]@{ Id = 1;  Title = 'launching the Host opens the ten-foot window'; Ground = ''; After = @(); Need = 'nothing: it starts its own Host from the empty data directory' }
    [pscustomobject]@{ Id = 2;  Title = 'Settings > Preferences: choosing a subtitle language goes through the Action surface'; Ground = 'fresh'; After = @(); Need = 'a fresh Host (empty data directory, one Host, no Addon)' }
    [pscustomobject]@{ Id = 3;  Title = 'launching again focuses the running Host instead of starting a second one'; Ground = 'fresh'; After = @(); Need = 'a fresh Host (empty data directory, one Host, no Addon)' }
    [pscustomobject]@{ Id = 4;  Title = 'the preference survives a restart'; Ground = ''; After = @(2, 3); Need = 'steps 2 and 3: the English preference, and the second launch step 3 logged' }
    [pscustomobject]@{ Id = 5;  Title = 'choosing another language moves the choice and publishes one Snapshot'; Ground = ''; After = @(4); Need = 'step 4: its restarted Host, in Preferences' }
    [pscustomobject]@{ Id = 6;  Title = 'clearing the preference: Host picks per Video, and no featured Catalog'; Ground = ''; After = @(4); Need = 'step 4: its restarted Host, in Preferences' }
    [pscustomobject]@{ Id = 7;  Title = 'configuring an Addon by manifest URL'; Ground = ''; After = @(); Need = 'nothing: it starts its own Host from the empty data directory' }
    [pscustomobject]@{ Id = 8;  Title = 'a URL that is not an Addon is refused without losing the Addon that works'; Ground = 'addon'; After = @(); Need = 'the fixture Addon configured (one Host, the Addon added by manifest URL)' }
    [pscustomobject]@{ Id = 9;  Title = 'the Addon survives a restart'; Ground = 'addon'; After = @(); Need = 'the fixture Addon configured (one Host, the Addon added by manifest URL)' }
    [pscustomobject]@{ Id = 10; Title = 'Home draws the Featured hero and a row for each Catalog'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, its first Catalog featured, at Home' }
    [pscustomobject]@{ Id = 11; Title = 'the keyboard reaches a card, and OK opens the Title'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at Home, with its hero and rows' }
    [pscustomobject]@{ Id = 12; Title = 'pressing a Video asks the Addons for its Streams'; Ground = ''; After = @(11); Need = 'step 11: the Title it opened, and whether it is a film or a series' }
    [pscustomobject]@{ Id = 13; Title = 'the OSD: per-icon popovers, auto-hide, and the episode steps'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home (it plays an episode)' }
    [pscustomobject]@{ Id = 14; Title = 'Back leaves the Title, and the same Title opens again'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home' }
    [pscustomobject]@{ Id = 15; Title = 'a series'' seasons and episodes, and choosing one'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at Home' }
    [pscustomobject]@{ Id = 16; Title = 'paging a row is not a change: no Snapshot goes out'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at Home, with a pageable row' }
    [pscustomobject]@{ Id = 17; Title = 'Search: the query bar and the answer its arm gives'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at Home' }
    [pscustomobject]@{ Id = 18; Title = 'Back returns to Home, from the keyboard'; Ground = ''; After = @(17); Need = 'step 17: the Search screen it left showing' }
    [pscustomobject]@{ Id = 19; Title = 'Settings > Credentials: the TMDB key entered, held, and cleared'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at Home (it opens a Title)' }
    [pscustomobject]@{ Id = 20; Title = 'removing the Addon'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at Home (it removes it)' }
    [pscustomobject]@{ Id = 21; Title = 'the manifest URL and the TMDB key never reach the log'; Ground = ''; After = @(19, 20); Need = 'steps 19 and 20: the log they wrote, the TMDB key and the removed Addon' }
    [pscustomobject]@{ Id = 22; Title = 'the data directory'; Ground = 'data'; After = @(); Need = 'the data directory (made if a Host has not)' }
    [pscustomobject]@{ Id = 23; Title = 'Watch progress outlives a Host that was killed, and the row resumes it'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home (it plays an episode, kills the Host, starts it again, and resumes)' }
    [pscustomobject]@{ Id = 24; Title = 'Settings > Credentials: signing in to Stremio, and out again'; Ground = 'addon'; After = @(); Need = 'a real Stremio account: it waits while you sign in by hand in the window, then checks and signs out again' }
    [pscustomobject]@{ Id = 25; Title = 'Settings > Remote devices: pairing a phone browser and revoking it'; Ground = 'addon'; After = @(); Need = 'a second device on the same network: it waits while you pair by hand in a browser, then revokes' }
    [pscustomobject]@{ Id = 26; Title = 'the full remote: browse, play and control from another device'; Ground = 'addon'; After = @(); Need = 'a playable Stream and a second device: it waits while you browse, play, pause and seek from a browser on that device' }
    [pscustomobject]@{ Id = 27; Title = 'the rail and the D-pad: edges stop, and a short row does not leak'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home (a Continue watching row makes the short-row check walkable; without one it is skipped)' }
    [pscustomobject]@{ Id = 28; Title = 'the hero: rotation while unfocused, and its text fallback'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home, with at least two hero slides' }
    [pscustomobject]@{ Id = 29; Title = 'Library: the sign-in gate, and no collection it does not have'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home' }
    [pscustomobject]@{ Id = 30; Title = 'Discover: the no-key state, and the keyed feed'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home (it enters and clears a test TMDB key)' }
    [pscustomobject]@{ Id = 31; Title = 'the previous episode: a wall at S1E1, and a step back from S1E2'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home (it plays an episode)' }
    [pscustomobject]@{ Id = 32; Title = 'TMDB attribution on Discover and in About/Credits'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at Home' }
    [pscustomobject]@{ Id = 33; Title = 'Settings > Preferences: the subtitle appearance goes through the Action surface, and survives a restart'; Ground = 'fresh'; After = @(); Need = 'a Host (the appearance needs no Addon)' }
    [pscustomobject]@{ Id = 34; Title = 'subtitles on a real picture: colour on the SRT, the authored colour on the ASS, and the size from the OSD'; Ground = 'addon'; After = @(); Need = 'the fixture Addon with the fixture video (one SRT and one ASS track); it chooses the colour, plays, steps the size in the OSD, and checks Settings and the next Stream' }
)

# The discovery path and the cheap syntax check: print the checklist and what
# each step needs, then leave without adding the interop types, wiping anything,
# or opening a window.
if ($List) {
    foreach ($step in $Steps) {
        '{0,2}  {1}' -f $step.Id, $step.Title
        '      needs: ' + $step.Need
    }
    exit 0
}

# --- what to run --------------------------------------------------------------
#
# Which steps this invocation walks, and what a selection that leaves an earlier
# step out is refused for: checked here, before anything is touched, so a refusal
# costs nothing and starts no Host.
$knownIds = @($Steps | ForEach-Object { $_.Id })
$byId = @{}
foreach ($s in $Steps) { $byId[$s.Id] = $s }

$selected = @()
if ($PSBoundParameters.ContainsKey('Only') -and $PSBoundParameters.ContainsKey('From')) {
    'give -Only or -From, not both'
    exit 2
} elseif ($PSBoundParameters.ContainsKey('Only')) {
    foreach ($item in $Only) {
        foreach ($part in ($item -split '[,\s]+')) {
            if ($part -eq '') { continue }
            $id = 0
            if (-not [int]::TryParse($part, [ref]$id) -or -not $byId.ContainsKey($id)) {
                "there is no step '$part'"
                exit 2
            }
            $selected += $id
        }
    }
} elseif ($PSBoundParameters.ContainsKey('From')) {
    if (-not $byId.ContainsKey($From)) {
        "there is no step $From"
        exit 2
    }
    $selected = @($knownIds | Where-Object { $_ -ge $From })
} else {
    $selected = $knownIds
}
$selected = @($selected | Sort-Object -Unique)

# What a step reads from an earlier one cannot be rebuilt from a ground, so a
# selection that leaves that step out is refused rather than walked against the
# wrong state.
$refused = $false
foreach ($id in $selected) {
    $step = $byId[$id]
    $missing = @($step.After | Where-Object { $_ -notin $selected })
    if ($missing.Count -gt 0) {
        ''
        "step $($step.Id) ($($step.Title)) needs step $($missing -join ', ') first."
        "  needs: $($step.Need)"
        $with = @(($missing + $step.Id) | Sort-Object -Unique)
        "run -Only $($with -join ',') or -From $(($missing | Measure-Object -Minimum).Minimum)."
        $refused = $true
    }
}
if ($refused) { exit 2 }

if (-not $Tree) { throw "give -Tree <the staged tree>, or -List to print the checklist without a Host" }

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
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int x, int y, int w, int ht, bool repaint);

  // A background script is not allowed to steal the foreground with a bare
  // SetForegroundWindow. Attaching to the current foreground thread makes this
  // thread the one Windows trusts for the call, so an unattended run can still
  // put the Host in front of whatever console started it.
  public static bool ForceForeground(IntPtr h) {
    IntPtr foreground = GetForegroundWindow();
    uint ignored;
    uint held = GetWindowThreadProcessId(foreground, out ignored);
    uint mine = GetCurrentThreadId();
    if (held != mine) { AttachThreadInput(held, mine, true); }
    bool taken = SetForegroundWindow(h);
    if (held != mine) { AttachThreadInput(held, mine, false); }
    return taken;
  }

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

  // Move the pointer without pressing. The OSD wakes on pointer movement, and a
  // pointer move is also what tells it the person is watching with a mouse, so
  // an idle window really puts the surface away.
  public static void Move(int x, int y) {
    SetCursorPos(x, y);
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
# The checks a step could not walk at all, because the Stream or the surface it
# needed was not there. A skipped check is not a passed one: a run that skipped
# anything must not print "ALL CHECKS PASSED" and leave a person thinking the
# checklist was walked.
$skipped = New-Object Collections.Generic.List[string]

# A Host left over from an earlier run would hold the single instance, and its
# window would answer for the one this script starts.
Get-Process streamingapp -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

function Check($what, $condition, $detail) {
    if ($condition) { "PASS  $what" }
    else { "FAIL  $what -- $detail"; $script:failures.Add($what) }
}

# A check that could not be made at all - the surface or the Stream it needed was
# not there. Recorded, so the run cannot end claiming to have passed.
function Skip($what, $why) {
    "SKIP  $what -- $why"
    $script:skipped.Add("$what ($why)")
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
    if ([W]::GetForegroundWindow() -eq $app.Handle) { return $true }
    [W]::ForceForeground($app.Handle) | Out-Null
    Start-Sleep -Milliseconds 500
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

# Wait for a control by its exact name: the transport flips between Play and
# Pause, and the OSD may be away when the wait starts.
function Wait-Shows($app, $name, $seconds = 30) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (Shows $app $name 2) { return $true }
    }
    return $false
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

# Waking the OSD is a pointer move: it listens on `pointermove`, and a move does
# not type into a field, change focus, or need the keyboard. The two positions
# guarantee a real move even when the pointer starts on one of them.
function Wake-Osd($app) {
    $r = New-Object W+RECT
    [W]::GetWindowRect($app.Handle, [ref]$r) | Out-Null
    [W]::Move($r.Left + 120, $r.Top + 120)
    Start-Sleep -Milliseconds 120
    [W]::Move($r.Left + 140, $r.Top + 120)
    Start-Sleep -Milliseconds 300
}

# Fill the TMDB key field. It is a password input, so Chromium exposes it as an
# Edit whose value a client should not set through the value pattern: it is
# focused and typed at, the way a person would.
function Set-TmdbKey($app, $key) {
    Focus-On $app 'TMDB API key or read-access token' ([Windows.Automation.ControlType]::Edit)
    if (-not (Focus $app)) { throw 'the keyboard steps need the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait((Escape-SendKeys $key))
    Start-Sleep -Milliseconds 300
}

# SendKeys reads a handful of characters as commands rather than text - `+`, `^`,
# `%`, `~`, the parentheses and brackets, and the braces themselves. A password
# may hold any of them (a `*` or a `#$` does not, but `p@ss+w0rd` does), so each
# is wrapped in braces, which is how SendKeys is told to type it literally.
function Escape-SendKeys($value) {
    $escaped = ''
    foreach ($ch in $value.ToCharArray()) {
        if ('+^%~()[]{}'.IndexOf($ch) -ge 0) { $escaped += '{' + $ch + '}' }
        else { $escaped += $ch }
    }
    return $escaped
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

# Type into a field with real key events. The value pattern sets the DOM value
# without React's change event in some Chromium builds, which leaves a submit
# button disabled; typing is what a person does and what the form listens for.
function Type-With-Keys($app, $name, $value) {
    Focus-On $app $name ([Windows.Automation.ControlType]::Edit)
    if (-not (Focus $app)) { throw 'the keyboard steps need the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait((Escape-SendKeys $value))
    Start-Sleep -Milliseconds 500
}

# Wait for a named button to stop being disabled, and hand it back.
function Wait-Enabled($app, $label, $seconds = 10) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $button = Button-Named $app $label 2
        if ($button -and -not (Is-Disabled $button)) { return $button }
    }
    return $null
}

function Press($app, $label) {
    $button = Find-Element (Window-Root $app) $label ([Windows.Automation.ControlType]::Button)
    if (-not $button) { throw "the window shows no $label button" }
    $button.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    Start-Sleep -Seconds 1
}

# Press the last button named this. A confirmation repeats the control that
# opened it ("Remove", "Clear key", "Sign out"): the row's control is first in
# the tree, the dialog's confirm control last. A real click is used because the
# dialog's Cancel has the focus and the shell's focus pass owns the level.
function Press-Last($app, $label) {
    $found = @(Buttons-Named $app $label)
    if ($found.Count -eq 0) { throw "the window shows no $label button" }
    Click-Element $app $found[$found.Count - 1]
}

# The candidates on the Streams surface. They are the only buttons there whose
# accessible name is the Addon's own words about a Stream - badges, description
# and file name, which is long - where the surface's own controls ("Back",
# "Streams - ...") are short. An unplayable candidate says so in that same name.
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

# A candidate's own words, cut to the length a report line can hold.
function Short($text) {
    if ($text.Length -le 90) { return $text }
    return $text.Substring(0, 90) + '...'
}

# Press a control the way a person does: focus it, then the key that presses a
# button. A choice carries `aria-pressed`, which Chromium exposes as a *toggle*,
# so the pattern a plain button answers is not always there - and the keyboard is
# one path that works for both.
function Press-Element($app, $element) {
    $element.SetFocus()
    Start-Sleep -Milliseconds 400
    if (-not (Focus $app)) { throw 'pressing a control needs the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Seconds 2
}

# Press a button the keyboard way, by its accessible name. An OSD icon carries
# `aria-expanded` or `aria-pressed`, which Chromium exposes as its own pattern
# rather than Invoke, so the focus-and-Enter path is the one that works for both
# a menu icon and a plain transport button.
function Press-Button($app, $label, $seconds = 10) {
    $button = Button-Named $app $label $seconds
    if (-not $button) { throw "the window shows no $label button" }
    Press-Element $app $button
}

# Click a control where it is on the screen. A choice inside an OSD popover is
# inside a pushed level whose focus belongs to the popover itself, so a UIA
# SetFocus can be undone by the shell's next focus pass; a real click is what a
# person does, and it does not depend on the focus engine at all.
function Click-Element($app, $element) {
    if (-not $element) { throw 'there is no control to click' }
    # A menu panel is taller than the window when it carries every group, so the
    # last choice can start below the panel's visible area. Scroll it into view;
    # a click on coordinates outside the window would land on the desktop (and
    # take the foreground away) instead of the control.
    $scroll = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.ScrollItemPattern]::Pattern, [ref]$scroll)) {
        try { $scroll.ScrollIntoView() } catch { }
        Start-Sleep -Milliseconds 600
    }
    $rect = $element.Current.BoundingRectangle
    if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) {
        throw 'the control has no rectangle to click'
    }
    [W]::Click([int]($rect.Left + ($rect.Width / 2)), [int]($rect.Top + ($rect.Height / 2)))
    Start-Sleep -Seconds 2
}

# Click somewhere along a horizontal range input, the way a person moves its
# thumb: a click is what makes the control fire its change and pointer-up.
function Click-Fraction($app, $element, [double] $fraction) {
    if (-not $element) { throw 'there is no slider to move' }
    $rect = $element.Current.BoundingRectangle
    if ($rect.IsEmpty -or $rect.Width -le 0 -or $rect.Height -le 0) {
        throw 'the slider has no rectangle to click'
    }
    $x = [int]($rect.Left + ($rect.Width * $fraction))
    $y = [int]($rect.Top + ($rect.Height / 2))
    [W]::Click($x, $y)
    Start-Sleep -Seconds 2
}

# Every button the window shows, in the order the tree lists them - which is the
# order they are drawn, and so the order the rows appear in.
function Buttons($app) {
    @((Window-Root $app).FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        (New-Object Windows.Automation.PropertyCondition(
            [Windows.Automation.AutomationElement]::ControlTypeProperty,
            [Windows.Automation.ControlType]::Button))))
}

# The buttons whose accessible name contains this word. A control's name is the
# words on it - a track's label and its marks, a card's title and its note - so a
# fragment is what finds one without spelling the whole line.
function Buttons-Matching($app, $fragment) {
    @(Buttons $app | Where-Object { $_.Current.Name -like ('*' + $fragment + '*') })
}

# The buttons whose accessible name is exactly this word for word.
function Buttons-Named($app, $name) {
    @(Buttons $app | Where-Object { $_.Current.Name -eq $name })
}

# One such button, waiting for the window to draw it.
function Button-Named($app, $name, $seconds = 8) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $found = Buttons-Named $app $name
        if ($found.Count -gt 0) { return $found[0] }
        Start-Sleep -Milliseconds 400
    }
    return $null
}

# The Continue watching cards: the buttons whose note ends in `left` and that
# are not a row's scroll arrow (`Scroll <row> left`).
function Continue-Cards($app) {
    @(Buttons $app | Where-Object {
        ($_.Current.Name -notlike 'Scroll *') -and ($_.Current.Name -like '* left')
    })
}

# Whether a choice is the one on. Chromium exposes `aria-pressed` on a button
# through the Toggle pattern, so which choice of a group is selected is read off
# the control itself rather than inferred from the words around it.
function Toggled($element) {
    if (-not $element) { return $false }
    $pattern = $null
    if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
        return $pattern.Current.ToggleState -eq [Windows.Automation.ToggleState]::On
    }
    return $false
}

# A readout a screen draws - the `<p>` or `<span>` a value is shown in - as
# opposed to a button that carries the same words. Chromium gives static text a
# control type of its own, which is what tells "the readout now says +0.1 s"
# apart from "there is a +0.1 s button".
function Readout($app, $name, $seconds = 8) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $element = Find-Element (Window-Root $app) $name $null 1
        if ($element -and $element.Current.ControlType -eq [Windows.Automation.ControlType]::Text) {
            return $element
        }
        Start-Sleep -Milliseconds 300
    }
    return $null
}

# The series card in the Home rows: the first card of the first row that is
# neither Continue watching nor the movie Catalog the walkthrough names. A row's
# cards sit between its two edge buttons, so its left arrow names the row and
# the next button after it is the row's first card. Home fills its rows one
# answer at a time, so this waits for the row to arrive.
function Series-Card($app, $seconds = 25) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $buttons = Buttons $app
        for ($i = 0; $i -lt $buttons.Count; $i++) {
            $name = $buttons[$i].Current.Name
            if ($name -notlike 'Scroll * left') { continue }
            $row = $name.Substring(7)
            $row = $row.Substring(0, $row.Length - 5)
            if ($row -eq 'Continue watching') { continue }
            if ($row -eq $AddonCatalog) { continue }
            for ($j = $i + 1; $j -lt $buttons.Count; $j++) {
                $next = $buttons[$j].Current.Name
                if ($next -like 'Scroll *') { continue }
                if ($next -eq 'More') { break }
                return $buttons[$j]
            }
        }
        Start-Sleep -Milliseconds 500
    }
    return $null
}

# Whether a control the Host greyed out is disabled, the way a person reads it.
# An absent control is not disabled; the caller has to have found it first.
function Is-Disabled($element) {
    if (-not $element) { return $false }
    return -not $element.Current.IsEnabled
}

# The control the window's focus is on, by its accessible name.
function Focused-Name {
    $focused = [Windows.Automation.AutomationElement]::FocusedElement
    if ($focused) { return $focused.Current.Name }
    return ''
}

# Where playback is, in seconds, read from the OSD's position slider. The slider
# covers the timeline while the Host would take a seek, and its value is the
# position the Snapshot published. -1 when there is no slider to read.
function Position-Seconds($app) {
    $slider = Find-Element (Window-Root $app) 'Position' ([Windows.Automation.ControlType]::Slider) 3
    if (-not $slider) { return -1 }
    $pattern = $null
    if ($slider.TryGetCurrentPattern([Windows.Automation.RangeValuePattern]::Pattern, [ref]$pattern)) {
        return [int][math]::Round($pattern.Current.Value)
    }
    return -1
}

# The Featured hero's current slide name, read from its own label.
function Hero-Title($app) {
    $match = [regex]::Match((Page-Text $app), 'Featured Title: (.*?)\. Open Title')
    if ($match.Success) { return $match.Groups[1].Value }
    return ''
}

# The episode number the OSD is on, from the now-playing line, or -1.
function Episode-Number($app) {
    $match = [regex]::Match((Page-Text $app), 'S\d+E(\d+)')
    if ($match.Success) { return [int]$match.Groups[1].Value }
    return -1
}

# Wait for the OSD's episode to move off `$from`; the Host asks the Addon for
# the next Video's metadata, so it is not instant. Waking the OSD also keeps its
# controls visible while the episode changes.
function Wait-Episode-Change($app, $from, $seconds = 30) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        Wake-Osd $app
        $now = Episode-Number $app
        if (($now -ge 0) -and ($now -ne $from)) { return $now }
    }
    return (Episode-Number $app)
}

# How many Snapshots the Host has published, read from its own log.
#
# The log is the Host's record of a change reaching every client, and unlike the
# window's revision line it cannot be scrolled off the screen. It is written by an
# asynchronous writer, so callers wait rather than reading once.
function Published-Snapshots {
    @(Select-String -Path $log -SimpleMatch 'publishing a Snapshot' -ErrorAction SilentlyContinue).Count
}

# Wait for more published Snapshots than `$before`, and hand back the count it saw.
function Wait-Published($before, $seconds = 20) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ($true) {
        $now = Published-Snapshots
        if ($now -gt $before) { return $now }
        if ((Get-Date) -ge $deadline) { return $before }
        Start-Sleep -Milliseconds 250
    }
}

# Let the log writer catch up, then take the count a question is measured from.
function Snapshot-Baseline {
    Start-Sleep -Seconds 1
    return (Published-Snapshots)
}

# --- moving around the shell --------------------------------------------------
#
# The rail is the one control that changes the base screen, and a pushed level
# keeps the rail inert until it is popped. Back (Escape) is the same door for
# every level, so a helper that wants to start from a destination presses Escape
# a few times first; on Home with nothing pushed it is a wall.

# Pop whatever levels are open, then choose a destination. Back (Escape) is the
# same door for every level and clears a confirmation's Cancel; on a base screen
# with nothing pushed it is a wall. The keyboard needs the Host in front, which
# Focus arranges.
function Open-Destination($app, $name) {
    for ($i = 0; $i -lt 4; $i++) {
        Press-Keys $app '{ESC}'
        Start-Sleep -Milliseconds 300
    }
    Press $app $name
    Start-Sleep -Seconds 1
}

function Open-Home($app) {
    Open-Destination $app 'Home'
}

function Open-Settings($app) {
    Open-Destination $app 'Settings'
    Wait-Text $app 'Preferences' 20 | Out-Null
}

function Open-Settings-Category($app, $name, $marker) {
    Open-Settings $app
    Press $app $name
    Wait-Text $app $marker 20 | Out-Null
}

# The TMDB key lives in the OS keyring, which the data-directory wipe at the top
# does not touch. A leftover key would remap the fixture's `tt` Titles to TMDB
# records the fixture cannot answer for, so the first ground of a run clears it.
# Step 19 and step 30 still enter and clear their own key later.
$script:keyChecked = $false
function Clear-LeftoverKey($app) {
    if ($script:keyChecked) { return }
    $script:keyChecked = $true
    Open-Settings-Category $app 'Credentials' 'TMDB key'
    Wait-Text $app 'TMDB key' 20 | Out-Null
    Clear-TmdbKey $app
    Press $app 'Back'
    Start-Sleep -Milliseconds 500
}

# The TMDB key lives in the OS keyring, which the data-directory wipe at the top
# does not touch. A step that needs "no key is held" clears whatever a crashed
# earlier run left behind through the same confirmation a person uses.
function Clear-TmdbKey($app) {
    $clear = Button-Named $app 'Clear key' 3
    if (-not $clear) { return }
    if (Is-Disabled $clear) { return }
    Press-Element $app $clear
    Wait-Text $app 'Clear the TMDB key' 10 | Out-Null
    Press-Last $app 'Clear key'
    Wait-Text $app 'No TMDB key is held' 20 | Out-Null
}

# What the Remote devices screen reads out: the address a browser opens and the
# code it redeems once.
function Read-Pairing($app) {
    $text = Wait-Text $app 'Pairing code' 20
    $address = ([regex]::Match($text, 'Address[^0-9]*([0-9][0-9.]*:[0-9]+)')).Groups[1].Value
    $code = ([regex]::Match($text, 'Pairing code[^A-Z0-9]{0,6}([A-HJ-NP-Z2-9]{6})')).Groups[1].Value
    return @{ Text = $text; Address = $address; Code = $code }
}

# --- the fixtures the later steps stand on ------------------------------------
#
# A step run on its own must not stand on the leftovers of a previous run: the
# runner builds the ground the step declares first, and reuses it, so -Only 13
# means one Host, from the empty data directory, with the fixture Addon
# configured, its first Catalog featured, and Home showing its hero.

function Ensure-FreshHost($ctx) {
    if ($ctx.App -and -not $ctx.App.Process.HasExited) { return }
    Start-Sleep -Milliseconds 500
    $ctx.App = Start-Host
    $ctx.Series = $false
    $ctx.NoEpisodes = $false
}

# The Host's preference for the one Catalog Home's hero is drawn from is a
# Snapshot the run's first Home needs. A step run on its own sets it here, and a
# step that already has it leaves it alone.
function Ensure-Featured($app) {
    Open-Settings $app
    Press $app 'Preferences'
    Wait-Text $app 'Subtitle language' 20 | Out-Null
    $label = $AddonCatalog + ' ' + $dot + ' ' + $AddonName
    $chip = @(Buttons-Matching $app $label)[0]
    if (-not $chip) {
        'the Featured catalog choice was not on the Preferences screen:'
        '  expected a choice named like: ' + $label
        return
    }
    if (-not (Toggled $chip)) {
        Press-Element $app $chip
        Start-Sleep -Seconds 1
    }
    Press $app 'Back'
    Start-Sleep -Milliseconds 500
}

# One Host, the fixture Addon configured by its manifest URL, its first Catalog
# featured, and Home showing the hero. Idempotent: it is the ground every later
# step declares.
function Ensure-AddonHost($ctx) {
    Ensure-FreshHost $ctx
    $app = $ctx.App
    Clear-LeftoverKey $app
    Open-Destination $app 'Addons'
    Start-Sleep -Seconds 1
    $text = Page-Text $app
    if ($text -match 'No Addons are configured') {
        Type-Into $app 'Addon manifest URL' $Addon
        Press $app 'Add'
        Wait-Text $app ([regex]::Escape($AddonName)) 30 | Out-Null
    }
    Ensure-Featured $app
    Open-Home $app
    Start-Sleep -Seconds 2
    Wait-Text $app 'Featured Title:' 45 | Out-Null
}

# Open the first Title Home offers: the hero's slide when there is one, else the
# first row's first card, reached from the rail with the D-pad.
function Open-First-Title($app) {
    Open-Home $app
    Start-Sleep -Seconds 2
    $hero = @(Buttons-Matching $app 'Featured Title:')[0]
    if ($hero) {
        Press-Element $app $hero
    } else {
        Focus-On $app 'Home' ([Windows.Automation.ControlType]::Button)
        Press-Keys $app '{RIGHT}'
        Press-Keys $app '{ENTER}'
    }
    Start-Sleep -Seconds 1
}

# Open the series Title, where the configured Addon draws a row that is neither
# Continue watching nor the movie Catalog named by -AddonCatalog.
function Open-Series($app) {
    Open-Home $app
    Start-Sleep -Seconds 2
    $card = Series-Card $app
    if (-not $card) { return $false }
    Press-Element $app $card
    $text = Wait-Text $app 'Season \d+' 20
    return $text -match 'Season \d+'
}

# Press one Video on the Title and leave the Streams level showing. The answer
# arrives after the heading does, so wait for a candidate (or for the note that
# says there is none) rather than for the transient "Looking for" line.
function Open-Streams($app, $label) {
    $video = @(Buttons-Matching $app $label)[0]
    if (-not $video) { return $false }
    # A real click on the Video row: the Title's focus belongs to the shell's
    # focus pass, and a UIA SetFocus can be undone before Enter lands.
    Click-Element $app $video
    Wait-Text $app 'Streams ' 25 | Out-Null
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        $text = Page-Text $app
        if ($text -match 'No configured Addon offers Streams') { return $true }
        if (@(Candidates $app).Count -gt 0) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

# Choose the first candidate this Host can play, or the first one at all when it
# can play none of them. Returns whether the chosen candidate is playable.
function Choose-Candidate($app) {
    $candidates = Candidates $app
    if (-not $candidates) { return $null }
    foreach ($candidate in $candidates) {
        Write-Host "candidate: $(Short $candidate.Current.Name)"
    }
    $playable = @($candidates | Where-Object { $_.Current.Name -notmatch 'Not playable yet' })
    $chosen = if ($playable) { $playable[0] } else { $candidates[0] }
    Write-Host "chose: $(Short $chosen.Current.Name)"
    Press-Element $app $chosen
    if ($playable) { return 'playable' }
    return 'unplayable'
}

# Open the first Title Home offers, press its Video, choose a playable candidate,
# and say whether it started playing. The appearance step uses it twice: once to
# look at the SRT and ASS tracks, and once to see the size it set on a new Stream.
function Play-The-First-Stream($app) {
    Open-First-Title $app
    $text = Wait-Text $app 'This Title is one Video|Season \d+' 25
    if ($text -match 'Season \d+') {
        if (-not (Open-Streams $app 'S1E1')) { return $false }
    } elseif ($text -match 'This Title is one Video') {
        if (-not (Open-Streams $app 'Play')) { return $false }
    } else {
        return $false
    }
    $kind = Choose-Candidate $app
    if ($kind -ne 'playable') { return $false }
    return (Wait-Shows $app 'Pause' 45)
}

# Choose a candidate and walk what playing it looks like, reporting as it goes.
#
# A candidate the Host can play starts playing when it is pressed; one it cannot
# says so and stays in the list. Whether the Addon answered either is the
# Addon's business, which is why this walks whatever is there and says what it
# found.
function Play-A-Candidate($app) {
    $before = Snapshot-Baseline
    $kind = Choose-Candidate $app
    if ($kind -eq $null) {
        Skip 'playback over a real Stream' (
            'the Addon answered no candidates at all: run with -Addon <an Addon that answers playable Streams>')
        return
    }

    if ($kind -eq 'unplayable') {
        # Every candidate is one this version cannot open: the window says so
        # and the video never appears.
        $text = Wait-Text $app 'Not playable yet' 20
        Shot $app '12-stream-unplayable.png'
        Check 'a candidate this Host cannot play says so rather than pretending' (
            $text -match 'Not playable yet') "showed: $text"
        Check 'and nothing is drawn for a Stream that will not play' (
            -not (Shows $app 'Pause' 2)) "showed: $text"
        return
    }

    $playing = Wait-Shows $app 'Pause' 30
    Shot $app '12b-playing.png'
    Check 'choosing a candidate the Host can play starts playing it' $playing (
        "showed: $(Page-Text $app)")

    '--- 12b. the picture is mpv''s, the interface is drawn above it, and the controls work'

    # The OSD offers the transport only once the picture is up: an open in
    # flight says so and offers Stop alone, so wait for the control that means
    # playback. mpv's child window does not exist until there is a picture to
    # draw, so the window checks belong after this and not before it. The wait
    # outlasts a slow open; a Stream that never starts is a skip, not a pass.
    if (-not $playing) { $playing = Wait-Shows $app 'Pause' 15 }
    Start-Sleep -Seconds 2
    Shot $app '12b-playing-controls.png'
    Check 'the picture is playing, and the OSD is over it with the controls' $playing (
        "the window shows neither Pause nor the transport: $(Page-Text $app)")
    if (-not $playing) {
        Skip 'the playback controls over a real Stream' (
            'the Stream never started playing, so there was no picture to control')
        return
    }

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
        "the webview is at ${webviewAt} and the picture at ${mpvAt}: $($children -join ' | ')")

    # A click in the middle of the picture has to reach the interface: the
    # picture's window must not be the one that hears it. Pressing the picture
    # pauses, and the OSD then offers Play where it offered Pause.
    $rect = New-Object W+RECT
    [W]::GetWindowRect($app.Handle, [ref]$rect) | Out-Null
    $atX = [int](($rect.Left + $rect.Right) / 2)
    $atY = [int]($rect.Top + (($rect.Bottom - $rect.Top) * 0.35))
    [W]::Click($atX, $atY)
    Check 'a click over the video lands on the interface rather than on the picture' (
        (Shows $app 'Play' 15)) (Page-Text $app)

    # Play, pause, seek and stop, through the interface the Host's own window
    # draws: the same Actions a remote client takes (ADR-0002).
    Press-Button $app 'Play'
    $resumed = Wait-Shows $app 'Pause' 15
    Check 'the interface plays and pauses' $resumed "showed: $(Page-Text $app)"

    $beforeAt = Position-Seconds $app
    Press-Button $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    $afterAt = Position-Seconds $app
    Check 'seeking forward moves playback on' (
        ($afterAt -gt $beforeAt) -and ($beforeAt -ge 0)) "the position went $beforeAt -> $afterAt"

    Press-Button $app 'Back ten seconds'
    Start-Sleep -Seconds 2
    $backAt = Position-Seconds $app
    Check 'seeking back moves it back' (
        ($backAt -lt $afterAt) -and ($backAt -ge 0)) "the position went $afterAt -> $backAt"

    Press-Button $app 'Pause'
    $paused = Wait-Shows $app 'Play' 15
    Check 'pausing is the same door as playing' $paused "showed: $(Page-Text $app)"

    # What mpv is decoding with is in the Host's log: the OSD's statistics are
    # where a client reads it, and a Stream playing is the only moment it can be
    # read at all.
    Start-Sleep -Seconds 1
    $decode = Select-String -Path $log -Pattern '"message":"the picture is playing"' |
        Select-Object -Last 1
    Check 'the Host logged what mpv is decoding with' (
        $decode -ne $null) 'no "the picture is playing" line in host.log'
    # The line is written when the picture comes up *and* whenever what mpv
    # decodes with changes - hardware decode engages a moment after the picture
    # appears - so the first line may honestly say `no`, and the one that says
    # `d3d11va` is the one to read.
    $engaged = Select-String -Path $log -Pattern '"message":"the picture is playing","hwdec":"(?!no")' |
        Select-Object -Last 1
    Check 'hardware decode is engaged (a line says so, not "no")' (
        $engaged -ne $null) "logged: $($decode.Line)"

    Press-Button $app 'Stop'
    $text = Wait-Text $app 'Streams ' 20
    Shot $app '12c-stopped.png'
    Check 'stopping returns the client to the Stream list it chose from' (
        $text -match 'Streams ') "showed: $text"
    $after = Wait-Published $before 30
    Check 'and playback published Snapshots of its own along the way' (
        $after -gt $before) ("the log still shows $before published Snapshot(s)")
}

# Walk the whole OSD over the Stream that is playing: each icon's popover
# asserted present, each choice asserted through the control's own state, the
# episode steps, and the surface putting itself away.
#
# The fixture file is what makes it possible - two audio tracks, two embedded
# subtitle tracks, two chapters and black bars, so every control has something
# to move. Whether what is playing is a film or an episode changes only whether
# the episode steps mean anything, which is the last thing checked.
function Walk-Controls($app) {
    Wake-Osd $app
    '--- 13a. Picture: aspect, crop, statistics'
    Wake-Osd $app
    Press-Button $app 'Picture'
    $text = Wait-Text $app 'Aspect, crop & statistics' 10
    Shot $app '13-picture.png'
    Check 'the Picture icon opens its own menu' (
        $text -match 'Aspect, crop & statistics') "showed: $text"
    Check 'the menu carries Aspect, Crop and Statistics' (
        ($text -match 'Aspect') -and ($text -match 'Crop') -and ($text -match 'Statistics')) (
        "showed: $text")

    $aspects = Buttons-Named $app '4:3'
    Check 'the Aspect group lists the source and the ratios' (
        ((Button-Named $app 'Source') -ne $null) -and
        ((Button-Named $app '16:9') -ne $null) -and
        ($aspects.Count -ge 2)) "showed: $text"
    Click-Element $app $aspects[0]
    Check 'setting an aspect takes: that ratio is pressed and the source is not' (
        (Toggled (Buttons-Named $app '4:3')[0]) -and
        -not (Toggled (Button-Named $app 'Source'))) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app 'Source')
    Check 'returning to the source takes: the source is pressed again' (
        Toggled (Button-Named $app 'Source')) "showed: $(Page-Text $app)"

    # The fixture is 1280x540 of picture in a 1280x720 frame. Autocrop is off
    # until asked (#119), so the bars are still there and the whole frame is the
    # choice in force on the first look at this menu.
    Check 'the Crop group offers the whole frame and the ratios' (
        ((Button-Named $app 'Full frame') -ne $null) -and ($aspects.Count -ge 2)) (
        "showed: $text")
    Check 'no crop is in force until Autocrop is asked' (
        Toggled (Button-Named $app 'Full frame')) "showed: $(Page-Text $app)"
    Shot $app '13-crop-uncropped.png'
    'review 13-crop-uncropped.png: the black bars should still be there'

    # The button is the script's own toggle: the first press detects, and the
    # Host publishes the crop once the Player reports it, which is when the label
    # becomes the way back.
    Click-Element $app (Button-Named $app 'Autocrop')
    $restore = Button-Named $app 'Restore full frame' 15
    Check 'Autocrop detects the bars: the whole frame is no longer the crop in force' (
        ($restore -ne $null) -and
        -not (Toggled (Button-Named $app 'Full frame'))) "showed: $(Page-Text $app)"
    Shot $app '13-crop-autocrop.png'
    'review 13-crop-autocrop.png: the black bars should be gone'
    Click-Element $app $restore
    Check 'pressing again restores the full frame' (
        ((Button-Named $app 'Autocrop' 15) -ne $null) -and
        (Toggled (Button-Named $app 'Full frame'))) "showed: $(Page-Text $app)"

    Click-Element $app (Buttons-Named $app '4:3')[1]
    Check 'applying a crop takes: that ratio becomes the choice pressed' (
        Toggled (Buttons-Named $app '4:3')[1]) "showed: $(Page-Text $app)"
    Shot $app '13-crop-applied.png'
    Click-Element $app (Button-Named $app 'Full frame')
    Check 'clearing the crop takes: the whole frame is the choice pressed' (
        Toggled (Button-Named $app 'Full frame')) "showed: $(Page-Text $app)"

    Click-Element $app (Button-Named $app 'Show statistics')
    $text = Wait-Text $app 'Hardware decode' 10
    Shot $app '13-statistics.png'
    Check 'showing statistics draws a readout' (
        $text -match 'Hardware decode') "showed: $text"
    $decode = [regex]::Match($text, 'Hardware decode\s*\|\s*([^|]+)')
    $mode = if ($decode.Success) { $decode.Groups[1].Value.Trim() } else { '' }
    Check 'and it names a hardware decode mode, not "no" (a GPU that does the decode)' (
        ($mode -ne '') -and ($mode -ne 'no')) "the readout says Hardware decode | $mode"
    Press-Keys $app '{ESC}'
    Start-Sleep -Milliseconds 500

    '--- 13b. Subtitles: tracks, off, and the delay'
    Wake-Osd $app
    Press-Button $app 'Subtitles'
    $text = Wait-Text $app 'Subtitles off' 10
    Shot $app '13-subtitles.png'
    Check 'the Subtitles icon opens its own menu' (
        $text -match 'Subtitles off') "showed: $text"
    $subtitles = Buttons-Matching $app 'subrip'
    Check 'the file carries two embedded subtitle tracks, and both are listed' (
        ($subtitles.Count -ge 2) -and
        ($subtitles[0].Current.Name -match 'embedded') -and
        ($subtitles[1].Current.Name -match 'embedded')) "showed: $text"
    Check 'the file''s default subtitle track is the one in force before a choice' (
        (Toggled $subtitles[0]) -and
        -not (Toggled (Button-Named $app 'Subtitles off'))) "showed: $text"
    Click-Element $app $subtitles[1]
    Check 'choosing another subtitle track turns it on, and takes the default off' (
        (Toggled (Buttons-Matching $app 'subrip')[1]) -and
        -not (Toggled (Buttons-Matching $app 'subrip')[0]) -and
        -not (Toggled (Button-Named $app 'Subtitles off'))) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app 'Subtitles off')
    Check 'Subtitles off turns every subtitle track off' (
        (Toggled (Button-Named $app 'Subtitles off')) -and
        (-not (Toggled (Buttons-Matching $app 'subrip')[0])) -and
        (-not (Toggled (Buttons-Matching $app 'subrip')[1]))) "showed: $(Page-Text $app)"

    Check 'the delay readout starts at zero' (
        (Readout $app '0.0 s') -ne $null) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app '+0.1 s')
    Check 'stepping the delay moves the readout to +0.1 s' (
        (Readout $app '+0.1 s') -ne $null) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app 'Reset')
    Check 'resetting the delay moves the readout back to 0.0 s' (
        (Readout $app '0.0 s') -ne $null) "showed: $(Page-Text $app)"

    Check 'the menu carries the Host''s subtitle size' (
        (Readout $app 'Subtitle size 100%') -ne $null) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app 'Larger subtitles')
    Check 'one press of Larger moves the readout up a step, and publishes it' (
        (Readout $app 'Subtitle size 105%') -ne $null) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app 'Smaller subtitles')
    Check 'and Smaller moves it back' (
        (Readout $app 'Subtitle size 100%') -ne $null) "showed: $(Page-Text $app)"
    Press-Keys $app '{ESC}'
    Start-Sleep -Milliseconds 500

    '--- 13c. Audio: the file''s two tracks, embedded, and choosing one'
    Wake-Osd $app
    Press-Button $app 'Audio'
    $text = Wait-Text $app 'English stereo' 10
    Shot $app '13-audio.png'
    Check 'the Audio icon opens its own menu' (
        $text -match 'English stereo') "showed: $text"
    $audioEng = Buttons-Matching $app 'English stereo'
    $audioPor = Buttons-Matching $app 'Portuguese'
    Check 'the file carries two audio tracks, and both are listed' (
        ($audioEng.Count -ge 1) -and ($audioPor.Count -ge 1)) "showed: $text"
    Check 'and both audio tracks are the file''s own, marked embedded' (
        ($audioEng[0].Current.Name -match 'embedded') -and
        ($audioPor[0].Current.Name -match 'embedded')) (
        "$($audioEng[0].Current.Name) | $($audioPor[0].Current.Name)")
    Click-Element $app $audioPor[0]
    Check 'selecting the other audio track takes: its toggle is on and the first is off' (
        (Toggled (Buttons-Matching $app 'Portuguese')[0]) -and
        -not (Toggled (Buttons-Matching $app 'English stereo')[0])) (
        "showed: $(Page-Text $app)")
    Press-Keys $app '{ESC}'
    Start-Sleep -Milliseconds 500

    '--- 13d. Speed: the rates, and the pressed choice moving'
    Wake-Osd $app
    Press-Button $app 'Playback speed'
    $text = Wait-Text $app 'Playback speed' 10
    Shot $app '13-speed.png'
    Check 'the speed menu lists its rates' (
        (Button-Named $app ('1.5' + $times)) -ne $null) "showed: $text"
    Click-Element $app (Button-Named $app ('1.5' + $times))
    Check 'picking a speed presses that choice' (
        Toggled (Button-Named $app ('1.5' + $times))) "showed: $(Page-Text $app)"
    Click-Element $app (Button-Named $app ('1' + $times))
    Check 'and picking another moves the pressed choice' (
        (Toggled (Button-Named $app ('1' + $times))) -and
        -not (Toggled (Button-Named $app ('1.5' + $times)))) "showed: $(Page-Text $app)"
    Press-Keys $app '{ESC}'
    Start-Sleep -Milliseconds 500

    '--- 13e. Chapters: the file''s two, and jumping to one'
    Wake-Osd $app
    Press-Button $app 'Chapters'
    $text = Wait-Text $app 'Intro' 10
    Shot $app '13-chapters.png'
    $intro = @(Buttons-Matching $app 'Intro')[0]
    $middle = @(Buttons-Matching $app 'Middle')[0]
    Check 'the file carries two chapters, and both are listed' (
        ($text -match 'Intro') -and ($text -match 'Middle')) "showed: $text"
    Check 'exactly one chapter is marked as the one playing' (
        ($intro -ne $null) -and ($middle -ne $null) -and
        ((Toggled $intro) -xor (Toggled $middle))) (
        "Intro is $(Toggled $intro), Middle is $(Toggled $middle)")
    # Jump to whichever chapter is not playing, so the check does not assume
    # where the two-minute fixture happens to be by the time this runs.
    $target = if (Toggled $intro) { $middle } else { $intro }
    $other = if (Toggled $intro) { $intro } else { $middle }
    Click-Element $app $target
    Shot $app '13-chapters-jumped.png'
    Check 'a chapter can be jumped to by its own index' (
        (Toggled $target) -and -not (Toggled $other)) "showed: $(Page-Text $app)"
    Press-Keys $app '{ESC}'
    Start-Sleep -Milliseconds 500

    '--- 13f. the volume, and mute'
    Wake-Osd $app
    $before = [regex]::Match((Page-Text $app), '(\d+)%')
    $level = if ($before.Success) { [int]$before.Groups[1].Value } else { -1 }
    # A real click on the pillar moves its thumb: the range input fires its
    # change and pointer-up, and the Host publishes the level it was moved to.
    $volume = Find-Element (Window-Root $app) 'Volume' ([Windows.Automation.ControlType]::Slider) 5
    if (-not $volume) { throw 'the OSD shows no Volume slider' }
    Click-Fraction $app $volume 0.4
    Start-Sleep -Seconds 1
    $after = [regex]::Match((Page-Text $app), '(\d+)%')
    $moved = if ($after.Success) { [int]$after.Groups[1].Value } else { -1 }
    Check 'moving the volume moves its readout' (
        ($level -ge 0) -and ($moved -ne $level)) "the readout went $level% to $moved%"
    Press-Element $app (Button-Named $app 'Mute')
    Check 'muting flips the control to Unmute' (
        Shows $app 'Unmute' 10) "showed: $(Page-Text $app)"
    Check 'and the muted choice is the one toggled on' (
        Toggled (Button-Named $app 'Unmute')) "showed: $(Page-Text $app)"
    Press-Element $app (Button-Named $app 'Unmute')
    Check 'unmuting flips it back to Mute' (
        (Shows $app 'Mute' 10) -and -not (Shows $app 'Unmute' 2)) (
        "showed: $(Page-Text $app)")

    '--- 13g. the episode steps, when an episode is what is playing'
    Wake-Osd $app
    $episode = Episode-Number $app
    if ($episode -ge 1) {
        $beforeAt = Snapshot-Baseline
        Press-Button $app 'Next episode'
        $after = Wait-Episode-Change $app $episode
        Shot $app '13-next-episode.png'
        Check 'pressing Next episode plays the next one: the now-playing line moves on' (
            ($after -gt $episode)) "the line said S1E$episode and says S1E$after"
        Check 'and it published a Snapshot as it did' (
            (Wait-Published $beforeAt 30) -gt $beforeAt) "the log still shows $beforeAt published Snapshot(s)"

        Press-Button $app 'Previous episode'
        $back = Wait-Episode-Change $app $after
        Shot $app '13-previous-episode.png'
        Check 'and Previous episode steps back to the one it came from' (
            ($back -lt $after) -and ($back -ge 1)) "the line said S1E$after and says S1E$back"
    } else {
        'what is playing is a film, so there is no episode step to press'
    }

    '--- 13h. the OSD puts itself away, and any input summons it again'
    Focus-On $app 'Play or pause' ([Windows.Automation.ControlType]::Button)
    $rect = New-Object W+RECT
    [W]::GetWindowRect($app.Handle, [ref]$rect) | Out-Null
    [W]::Move([int](($rect.Left + $rect.Right) / 2), [int]($rect.Top + 8))
    Start-Sleep -Milliseconds 300
    [W]::Move([int](($rect.Left + $rect.Right) / 2), [int]($rect.Top + 10))
    Start-Sleep -Seconds 7
    Shot $app '13-osd-hidden.png'
    Check 'with the pointer idle for three seconds the OSD puts itself away' (
        -not (Shows $app 'Pause' 2)) "showed: $(Page-Text $app)"
    Wake-Osd $app
    Check 'and any input summons it again, on the picture it was over' (
        Shows $app 'Pause' 5) "showed: $(Page-Text $app)"
}

# --- the steps ----------------------------------------------------------------

function Step-1($ctx) {
    '--- 1. launching the Host opens the ten-foot window'
    $app = Start-Host
    $ctx.App = $app
    Focus $app | Out-Null
    Start-Sleep -Seconds 3
    Shot $app '01-start.png'
    $text = Wait-Text $app 'No Addons are configured' 30
    Check 'the window opens on Home, and says it has nothing to draw' (
        $text -match 'No Addons are configured') "showed: $text"
    Check 'the Host answered instead of leaving the window waiting' (
        $text -notmatch 'Waiting for the Host') "showed: $text"
}

function Step-2($ctx) {
    '--- 2. Settings > Preferences: choosing a subtitle language'
    $app = $ctx.App
    $before = Snapshot-Baseline
    Open-Settings $app
    Shot $app '02-settings.png'
    Check 'Settings draws its four categories' (
        (Shows $app 'Credentials') -and (Shows $app 'Preferences') -and
        (Shows $app 'Remote devices') -and (Shows $app 'About/Credits')) (Page-Text $app)
    Press $app 'Preferences'
    Wait-Text $app 'Subtitle language' 20 | Out-Null
    Shot $app '02-preferences.png'
    Check 'Preferences says the Host picks per Video before any choice' (
        (Page-Text $app) -match 'Host picks per Video') (Page-Text $app)

    $english = Button-Named $app 'English' 10
    if (-not $english) { throw 'the Preferences screen shows no English choice' }
    Press-Element $app $english
    $text = Wait-Text $app 'prefer English' 15
    Shot $app '02-saved.png'
    Check 'the window shows the new preference in a sentence' (
        $text -match 'prefer English \(en\)') "showed: $text"
    Check 'the choice pressed is the one the Host holds' (
        Toggled (Button-Named $app 'English')) "showed: $text"
    Check 'and the old choice is no longer pressed' (
        -not (Toggled (Button-Named $app 'Host picks per Video'))) "showed: $text"
    Check 'choosing a language published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
}

function Step-3($ctx) {
    '--- 3. launching again focuses the running Host instead of starting a second one'
    $app = $ctx.App
    $second = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
    Start-Sleep -Seconds 8
    Check 'the second launch exited' (
        -not (Get-Process -Id $second.Id -ErrorAction SilentlyContinue)) 'a second Host is still running'
    Check 'the first Host is still the one running' (
        -not $app.Process.HasExited) 'the first Host died'
    Shot $app '03-after-second-launch.png'
}

function Step-4($ctx) {
    '--- 4. the preference survives a restart'
    $app = $ctx.App
    Stop-Host $app
    Check 'the Host logged the Snapshot it published' (
        (Test-Path $log) -and (Select-String -Path $log -Pattern 'publishing a Snapshot' -Quiet)) 'no publish line in host.log'
    Check 'the Host logged the second launch' (
        (Test-Path $log) -and (Select-String -Path $log -Pattern 'already running' -Quiet)) 'no "already running" line in host.log'

    $restarted = Start-Host
    $ctx.App = $restarted
    Focus $restarted | Out-Null
    Start-Sleep -Seconds 2
    Open-Settings-Category $restarted 'Preferences' 'Subtitle language'
    Shot $restarted '04-restarted.png'
    $text = Wait-Text $restarted 'prefer English' 15
    Check 'the restarted Host still prefers English' (
        $text -match 'prefer English \(en\)') "showed: $text"
    Check 'and its Preferences still marks that choice' (
        Toggled (Button-Named $restarted 'English')) "showed: $text"
}

function Step-5($ctx) {
    '--- 5. choosing another language moves the choice and publishes one Snapshot'
    $app = $ctx.App
    # The new Preferences screen offers choices, not a free-text tag, so the
    # window cannot send a tag the Host would refuse; host-core's preference
    # tests cover that refusal. What is walkable here is that each choice is one
    # Action, and that the pressed choice follows the Host.
    $before = Snapshot-Baseline
    $uk = Button-Named $app 'English (UK)' 10
    if (-not $uk) { throw 'the Preferences screen shows no English (UK) choice' }
    Press-Element $app $uk
    $text = Wait-Text $app 'prefer English \(UK\)' 15
    Shot $app '05-second-language.png'
    Check 'the window shows the second language' (
        $text -match 'prefer English \(UK\) \(en-GB\)') "showed: $text"
    Check 'the second choice is pressed and the first is not' (
        (Toggled (Button-Named $app 'English (UK)')) -and
        -not (Toggled (Button-Named $app 'English'))) "showed: $text"
    Check 'and moving the choice published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
}

function Step-6($ctx) {
    '--- 6. clearing the preference: Host picks per Video, and no featured Catalog'
    $app = $ctx.App
    $before = Snapshot-Baseline
    $none = Button-Named $app 'Host picks per Video' 10
    if (-not $none) { throw 'the Preferences screen shows no Host picks per Video choice' }
    Press-Element $app $none
    $text = Wait-Text $app 'The Host picks per Video' 15
    Shot $app '06-cleared.png'
    Check 'the window says the Host picks per Video again' (
        $text -match 'The Host picks per Video') "showed: $text"
    Check 'the cleared choice is the one pressed' (
        Toggled (Button-Named $app 'Host picks per Video')) "showed: $text"
    Check 'clearing the language published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
    Check 'with no Addon configured there is no Catalog to feature, and the screen says so' (
        (Page-Text $app) -match 'No configured Addon offers a Catalog') (Page-Text $app)
    Check 'and No featured catalog is the choice pressed' (
        Toggled (Button-Named $app 'No featured catalog')) (Page-Text $app)

    Stop-Host $app
}

function Step-7($ctx) {
    '--- 7. configuring an Addon by manifest URL'
    $app = Start-Host
    $ctx.App = $app
    Focus $app | Out-Null
    Start-Sleep -Seconds 2
    Clear-LeftoverKey $app
    Open-Destination $app 'Addons'
    Shot $app '07-addons-empty.png'
    $text = Wait-Text $app 'No Addons are configured yet' 20
    Check 'a fresh Host has no Addons, and the screen says where one goes' (
        $text -match 'No Addons are configured yet') "showed: $text"

    Type-Into $app 'Addon manifest URL' $Addon
    Press $app 'Add'
    $text = Wait-Text $app ([regex]::Escape($AddonName)) 30
    Shot $app '07-addon-added.png'
    Check 'the Addon is listed by its name' (
        $text -match [regex]::Escape($AddonName)) "showed: $text"
    Check 'adding it says which Addon was added' (
        $text -match ([regex]::Escape($AddonName) + ' was added')) "showed: $text"

    # A row says only its name until it is focused; focus expands it in place to
    # the id, resources, types and Catalogs the manifest declared.
    $summary = @(Buttons-Matching $app $AddonName)[0]
    if (-not $summary) { throw "the Addons screen shows no $AddonName row" }
    $summary.SetFocus()
    Start-Sleep -Seconds 1
    $text = Wait-Text $app ([regex]::Escape($AddonId)) 10
    Shot $app '07-addon-expanded.png'
    Check 'the expanded row names the id in its manifest' (
        $text -match [regex]::Escape($AddonId)) "showed: $text"
    Check 'the resources it offers are listed' (
        ($text -match 'Resources') -and ($text -match 'catalog')) "showed: $text"
    Check 'the types it covers are listed' (
        ($text -match 'Types') -and ($text -match 'movie')) "showed: $text"
    Check 'its catalogs are listed' (
        $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
    Check 'the manifest URL is nowhere in the window' (
        $text -notmatch [regex]::Escape($Addon)) "showed: $text"
}

function Step-8($ctx) {
    '--- 8. a URL that is not an Addon is refused without losing the Addon that works'
    $app = $ctx.App
    Open-Destination $app 'Addons'
    Type-Into $app 'Addon manifest URL' 'https://example.com/'
    Press $app 'Add'
    $text = Wait-Text $app "could not read that Addon's manifest" 25
    Shot $app '08-addon-refused.png'
    Check 'the refusal is explained beside the form' (
        $text -match "could not read that Addon's manifest") "showed: $text"
    Check 'the Addon that was working is still listed' (
        $text -match [regex]::Escape($AddonName)) "showed: $text"
}

function Step-9($ctx) {
    '--- 9. the Addon survives a restart'
    $app = $ctx.App
    Stop-Host $app
    $app = Start-Host
    $ctx.App = $app
    Focus $app | Out-Null
    Start-Sleep -Seconds 2
    Open-Destination $app 'Addons'
    Shot $app '09-addon-restarted.png'
    $text = Wait-Text $app ([regex]::Escape($AddonName)) 30
    Check 'the restarted Host still has the Addon' (
        $text -match [regex]::Escape($AddonName)) "showed: $text"
}

function Step-10($ctx) {
    '--- 10. Home draws the Featured hero and a row for each Catalog'
    $app = $ctx.App
    # The hero is drawn from the Host's Featured catalog preference, which the
    # ground set; the step checks the preference the window shows before Home.
    Open-Settings-Category $app 'Preferences' 'Featured catalog'
    $label = $AddonCatalog + ' ' + $dot + ' ' + $AddonName
    $chip = @(Buttons-Matching $app $label)[0]
    Check 'the Featured catalog choice is the Catalog the hero is drawn from' (
        ($chip -ne $null) -and (Toggled $chip)) "expected a pressed choice named like: $label"
    Shot $app '10-featured-choice.png'

    Open-Home $app
    $text = Wait-Text $app 'Featured Title:' 45
    Shot $app '10-home.png'
    Check 'Home draws the Featured hero' (
        $text -match 'Featured Title:') "showed: $text"
    Check 'a row is drawn for each Catalog the Addon declares' (
        ($text -match [regex]::Escape($AddonCatalog)) -and
        ($text -match [regex]::Escape($AddonName))) "showed: $text"
    Check 'a card carries the film the Catalog lists' (
        $text -match 'A Film That Plays') "showed: $text"
    Check 'the hero names the Featured Catalog it was drawn from' (
        (Hero-Title $app) -ne '') "showed: $text"
    Check 'Continue watching is not drawn before anything has been watched' (
        $text -notmatch 'Continue watching') "showed: $text"
    # The posters are images the window loads from the Addon, and UI Automation
    # does not expose them, so the screenshot is the evidence a person reads here.
    'review 10-home.png: the hero should read as a slide, and each row should show poster images'
}

function Step-11($ctx) {
    '--- 11. the keyboard reaches a card, and OK opens the Title'
    $app = $ctx.App
    $published = Snapshot-Baseline
    # From the rail: Right crosses into the content at the Home item's height -
    # the hero where there is one - then Down goes to the first row's card and
    # Enter presses it. This is the D-pad path, not a programmatic click.
    Focus-On $app 'Home' ([Windows.Automation.ControlType]::Button)
    $hero = @(Buttons-Matching $app 'Featured Title:').Count -gt 0
    Press-Keys $app '{RIGHT}'
    if ($hero) { Press-Keys $app '{DOWN}' }
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app 'This Title is one Video|Season \d+|listed no episodes' 25
    Shot $app '11-title-opened.png'
    Check 'the arrow keys reached a card and OK opened the Title' (
        $text -match 'This Title is one Video|Season \d+|listed no episodes') "showed: $text"
    Check 'the opened Title names the Addon that answered for it' (
        $text -match [regex]::Escape($AddonId)) "showed: $text"
    Check 'opening a Title is a question: no Snapshot goes out' (
        (Snapshot-Baseline) -eq $published) "the log went from $published to $(Published-Snapshots)"
    $film = $text -match 'This Title is one Video'
    $series = $text -match 'Season \d+'
    $noEpisodes = $text -match 'listed no episodes'
    Check 'the opened Title is a film, or a series with its seasons' (
        $film -or $series -or $noEpisodes) "showed: $text"
    $kind = 'film'
    if ($series) { $kind = 'series' }
    if ($noEpisodes) { $kind = 'series with no episodes listed' }
    "opened a $kind"
    # The unmapped mark says no TMDB record met the Title, and that it stays keyed
    # by its Addon. With no key held, an id only TMDB could map cannot have been
    # mapped; a key held - the owner's own, say - legitimately can have been, and
    # the Title is then drawn from TMDB. Either is honest; what this step refuses
    # is a blank Title.
    if ($text -match 'Unmapped') {
        'the Title is marked unmapped, and stays keyed by its Addon'
    } else {
        'the Title opened mapped (a TMDB key was held), so no unmapped mark is expected'
    }
    'the series case - seasons, episodes, and choosing one - is step 15.'
    $ctx.Series = $series
    $ctx.NoEpisodes = $noEpisodes
}

function Step-12($ctx) {
    '--- 12. pressing a Video asks the Addons for its Streams'
    $app = $ctx.App
    $series = $ctx.Series
    $noEpisodes = $ctx.NoEpisodes
    if ($series) {
        Check 'the series offers an episode to press' (
            (Open-Streams $app 'S1E1') -and ((Page-Text $app) -match 'Streams ')) (
            "showed: $(Page-Text $app)")
        Shot $app '12-episode-streams.png'
    } elseif ($noEpisodes) {
        'the Title opened is a series whose Addon listed no episodes, so there is no Video to press play on'
    } else {
        # A film is one Video - the film itself - so its Title screen offers Play.
        Check 'pressing play on a film asks for its Streams, and the list is what came back' (
            Open-Streams $app 'Play') "showed: $(Page-Text $app)"
        Shot $app '12-film-streams.png'
    }

    if ((Page-Text $app) -match 'Streams ') {
        if ((Page-Text $app) -match 'No configured Addon offers Streams') {
            'the configured Addon answers no `stream` resource, so the list is empty:'
            'run with -Addon <a stream Addon> to walk the candidates themselves'
        } else {
            Play-A-Candidate $app
        }
        Press-Keys $app '{ESC}'
        Start-Sleep -Seconds 1
        Check 'Back leaves the Streams and returns to the Video it was asked from' (
            (Page-Text $app) -match 'This Title is one Video|Season \d+') "showed: $(Page-Text $app)"
        Press-Keys $app '{ESC}'
        Start-Sleep -Seconds 1
    }

    # The second film in the fixture's Catalog answers an infoHash: the list has
    # to show it, say why it cannot play, and leave the picture alone. Walked
    # when the Catalog drew it, and skipped for an Addon that did not.
    $unplayable = @(Buttons-Matching $app 'A Film That Cannot Play')[0]
    if ($unplayable) {
        Press-Element $app $unplayable
        Wait-Text $app 'This Title is one Video' 20 | Out-Null
        Open-Streams $app 'Play' | Out-Null
        Play-A-Candidate $app
        Press-Keys $app '{ESC}'
        Start-Sleep -Seconds 1
        Press-Keys $app '{ESC}'
        Start-Sleep -Seconds 1
    } else {
        'this Addon drew no second film, so the unplayable-candidate case was not walked'
    }
}

function Step-13($ctx) {
    '--- 13. the OSD: per-icon popovers, auto-hide, and the episode steps'
    $app = $ctx.App
    if (-not (Open-Series $app)) {
        Skip 'the full OSD' (
            "this Addon drew no series row, so there is no episode to play: run with -AddonName Verify (or -Addon <a Series Addon>) to walk the OSD")
        return
    }
    if (-not (Open-Streams $app 'S1E1')) {
        Skip 'the full OSD' 'the series Title offers no first episode'
        return
    }
    Shot $app '13-streams.png'
    $kind = Choose-Candidate $app
    if ($kind -eq $null) {
        Skip 'the full OSD' 'the Addon answered no candidate for the episode'
        return
    }
    if ($kind -eq 'unplayable') {
        Skip 'the full OSD' 'the Addon answered no playable candidate, so the menu cannot be walked'
        return
    }

    $playing = Wait-Shows $app 'Pause' 45
    Check 'the episode is playing, so its controls are live' $playing (
        "the window shows: $(Page-Text $app)")
    if (-not $playing) {
        Skip 'the full OSD' 'the Stream never started playing, so there was no menu to walk'
        return
    }
    Walk-Controls $app

    Press-Button $app 'Stop'
    $text = Wait-Text $app 'Streams ' 20
    Check 'stopping leaves the menu and the Stream list is back' (
        $text -match 'Streams ') "showed: $text"
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Season \d+' 15
    Check 'Back leaves the Streams for the episode list' (
        $text -match 'Season \d+') "showed: $text"
}

function Step-14($ctx) {
    '--- 14. Back leaves the Title, and the same Title opens again'
    $app = $ctx.App
    Open-First-Title $app
    $text = Wait-Text $app 'This Title is one Video|Season \d+' 25
    Check 'a Title is open to back out of' (
        $text -match 'This Title is one Video|Season \d+') "showed: $text"
    $published = Snapshot-Baseline
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Featured Title:' 20
    Shot $app '14-title-back.png'
    Check 'Back returns to Home' (
        $text -match 'Featured Title:') "showed: $text"
    Check 'and the Title surface is gone' (
        $text -notmatch 'This Title is one Video|Season \d+') "showed: $text"

    Open-First-Title $app
    $text = Wait-Text $app 'This Title is one Video|Season \d+' 25
    Shot $app '14-title-reopened.png'
    Check 'the same Title opens again' (
        $text -match 'This Title is one Video|Season \d+') "showed: $text"
    Check 'and opening it moved nothing either' (
        (Snapshot-Baseline) -eq $published) "the log went from $published to $(Published-Snapshots)"

    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Featured Title:' 20
    Check 'and Back leaves it again' (
        ($text -match 'Featured Title:') -and
        ($text -notmatch 'This Title is one Video|Season \d+')) "showed: $text"
}

function Step-15($ctx) {
    '--- 15. a series'' seasons and episodes, and choosing one'
    $app = $ctx.App
    $card = Series-Card $app
    if (-not $card) {
        'this Addon answered with no second row, so there was no series to open'
        'by hand: open a series row and check its seasons and episodes'
        return
    }
    Press-Element $app $card
    $text = Wait-Text $app 'Season \d+' 20
    Shot $app '15-series-opened.png'
    Check 'the second row opens a Title of its own kind' (
        $text -match 'Season \d+') "showed: $text"
    Check 'a series shows a heading per season' (
        $text -match 'Season \d+') "showed: $text"
    Check 'and an episode for each' (
        $text -match 'S\d+E\d+') "showed: $text"
    Check 'the episodes carry their own labels' (
        ($text -match 'S1E1') -and ($text -match 'S1E2')) "showed: $text"

    Check 'pressing an episode opens the Streams surface over the episodes' (
        Open-Streams $app 'S1E2') "showed: $(Page-Text $app)"
    Shot $app '15-series-streams.png'
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Season \d+' 15
    Check 'Back leaves the Streams and returns to the episodes' (
        $text -match 'Season \d+') "showed: $text"
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Featured Title:' 20
    Check 'and Back leaves the series again' (
        $text -match 'Featured Title:') "showed: $text"
}

function Step-16($ctx) {
    '--- 16. paging a row is not a change: no Snapshot goes out'
    $app = $ctx.App
    $published = Snapshot-Baseline
    $more = @(Buttons-Named $app 'More')
    if ($more.Count -eq 0) {
        Skip 'paging a row' 'the Addon Catalog offers no way to page on (no More control)'
        return
    }
    $before = $more.Count
    Press-Element $app $more[0]
    Start-Sleep -Seconds 4
    $text = Wait-No-Text $app 'Looking for' 30
    Shot $app '16-paged.png'
    Check 'the row paged on without emptying' (
        $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
    Check 'the row that answered nothing new stopped offering More' (
        @(Buttons-Named $app 'More').Count -lt $before) (
        "the window still offers $(@(Buttons-Named $app 'More').Count) More control(s)")
    Check 'paging is a question, not a change: no Snapshot went out' (
        (Snapshot-Baseline) -eq $published) "the log went from $published to $(Published-Snapshots)"
}

function Step-17($ctx) {
    '--- 17. Search: the query bar and the answer its arm gives'
    $app = $ctx.App
    $published = Snapshot-Baseline
    Open-Destination $app 'Search'
    $text = Wait-Text $app 'Search' 15
    Check 'the Search destination draws its query bar' (
        (Shows $app 'Search the Addons'' searchable Catalogs' 5) -or
        (Shows $app 'Search TMDB for a film or a series' 5) -or
        ((Page-Text $app) -match 'Every Addon''s Catalog that offers a search')) (Page-Text $app)
    $keyed = (Page-Text $app) -match 'TMDB searches its Movies and Series together'

    Type-With-Keys $app 'Search for a Title' $SearchQuery
    Check 'typing a query enables the submit control' (
        (Wait-Enabled $app 'Search' 10) -ne $null) 'the search submit is still disabled after typing'
    # Enter in the field submits the same form the Search button does; a real
    # key is what a remote's OK sends.
    Press-Keys $app '{ENTER}'
    if ($keyed) {
        Wait-No-Text $app 'Looking for (movies|series)' 30 | Out-Null
        $text = Wait-Text $app 'Movies' 30
        Shot $app '17-search-tmdb.png'
        Check 'with a key held, Search asks TMDB and draws both kinds' (
            ($text -match 'Movies') -and ($text -match 'Series')) "showed: $text"
    } else {
        # Every Catalog that declares `search` answers in one Action. The
        # fixture's Catalog declares none, so the empty arm is the one it walks;
        # an Addon that does declares search fills rows instead.
        $text = Wait-Text $app ('No Addon offers a Catalog that can be searched|' + [regex]::Escape($AddonName)) 30
        Shot $app '17-search.png'
        Check 'without a key, Search asks the Addons and says what answered' (
            ($text -match 'No Addon offers a Catalog that can be searched') -or
            ($text -match [regex]::Escape($AddonName))) "showed: $text"
    }
    Check 'the search did not move a Snapshot' (
        (Snapshot-Baseline) -eq $published) "the log went from $published to $(Published-Snapshots)"
    'review 17-search.png: the results should be a row of posters, or a clear "no Addon answered"'
}

function Step-18($ctx) {
    '--- 18. Back returns to Home, from the keyboard'
    $app = $ctx.App
    # Search is a destination, not a pushed level, so Back is the shell's return
    # to Home - the same Escape a remote sends.
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Featured Title:' 25
    Shot $app '18-back.png'
    Check 'Back returns to Home' (
        $text -match 'Featured Title:') "showed: $text"
    Check 'and the Search surface is gone' (
        $text -notmatch 'Search the Addons'' searchable Catalogs') "showed: $text"
    Check 'and the rail marks Home as the current destination' (
        Shows $app 'Home') "showed: $text"
}

function Step-19($ctx) {
    '--- 19. Settings > Credentials: the TMDB key entered, held, and cleared'
    $app = $ctx.App
    Open-Settings-Category $app 'Credentials' 'TMDB key'
    # The value the walkthrough enters is its own and it takes it out again
    # before the step ends: the point is the round trip, not a credential.
    Clear-TmdbKey $app
    $text = Wait-Text $app 'No TMDB key is held' 15
    Shot $app '19-tmdb-key-none.png'
    Check 'a Host with no key says so' (
        $text -match 'No TMDB key is held') "showed: $text"
    Check 'the window says which backend would hold a key' (
        ($text -match 'OS keyring') -or ($text -match '0600')) "showed: $text"

    $testKey = '0123456789abcdef'
    $before = Snapshot-Baseline
    Set-TmdbKey $app $testKey
    Press $app 'Save key'
    $text = Wait-Text $app 'A TMDB key is held' 20
    Shot $app '19-tmdb-key-saved.png'
    Check 'saving a key is a change: the Snapshot says one is held' (
        $text -match 'A TMDB key is held') "showed: $text"
    Check 'saving a key published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
    # The value has no place in the window; step 21 reads the log for it.
    Check 'the key value is nowhere in the window' (
        $text -notmatch [regex]::Escape($testKey)) "showed: $text"

    # TMDB answers a refusal to a key that is not its own. Opening a Title must
    # then degrade to the Addon's metadata rather than blanking: the find fails,
    # and an id only TMDB could map cannot have been mapped with it.
    Open-Home $app
    Open-First-Title $app
    $text = Wait-Text $app 'This Title is one Video|Season \d+' 40
    Shot $app '19-tmdb-key-refused.png'
    Check 'a Title still opens when TMDB refuses the key' (
        $text -match 'This Title is one Video|Season \d+') "showed: $text"
    if ($text -match 'Unmapped') {
        'and it is marked unmapped rather than blanked'
    } else {
        'the Addon keyed this Title by TMDB itself, so no unmapped mark is expected'
    }
    Press-Keys $app '{ESC}'
    Start-Sleep -Seconds 1

    Open-Settings-Category $app 'Credentials' 'TMDB key'
    $before = Snapshot-Baseline
    Clear-TmdbKey $app
    $text = Wait-Text $app 'No TMDB key is held' 20
    Shot $app '19-tmdb-key-cleared.png'
    Check 'clearing the key says no key is held' (
        $text -match 'No TMDB key is held') "showed: $text"
    Check 'and clearing published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
    $ctx.TestKey = $testKey
}

function Step-20($ctx) {
    '--- 20. removing the Addon'
    $app = $ctx.App
    Open-Destination $app 'Addons'
    $summary = @(Buttons-Matching $app $AddonName)[0]
    if (-not $summary) { throw "the Addons screen shows no $AddonName row to remove" }
    $summary.SetFocus()
    Start-Sleep -Seconds 1
    Click-Element $app (Button-Named $app 'Remove')
    $text = Wait-Text $app ('Remove ' + [regex]::Escape($AddonName) + '\?') 10
    Shot $app '20-remove-confirm.png'
    Check 'removing an Addon asks first' (
        $text -match ('Remove ' + [regex]::Escape($AddonName) + '\?')) "showed: $text"
    # The dialog repeats the row's control; its own confirm button is the last.
    Press-Last $app 'Remove'
    $text = Wait-Text $app 'No Addons are configured yet' 20
    Shot $app '20-addon-removed.png'
    Check 'the Addon is gone' (
        $text -match 'No Addons are configured yet') "showed: $text"
    # The rows are the Addon's own catalog headings, and they go with it. The
    # match is case-*sensitive* on purpose: a library entry whose Addon is gone
    # would name the id in a lowercase mark, which is not a row heading.
    Open-Home $app
    $text = Wait-Text $app 'No Addons are configured' 20
    Check 'and its rows are gone with it' (
        -not ($text -cmatch [regex]::Escape($AddonCatalog))) "showed: $text"
    Check 'and Home says where to add one again' (
        $text -match 'Open Addons') "showed: $text"

    Stop-Host $app
}

function Step-21($ctx) {
    '--- 21. the manifest URL and the TMDB key never reach the log'
    $testKey = $ctx.TestKey
    # A manifest URL can carry a debrid configuration inside it, so the Host must
    # never write one down - and the route that matters is the real one, with the
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
}

function Step-22($ctx) {
    '--- 22. the data directory'
    if (Test-Path $dataDir) {
        Get-ChildItem $dataDir | ForEach-Object { "  $($_.Name)  $($_.Length) bytes" }
    } else { Check 'the data directory exists' $false $dataDir }
}

function Step-23($ctx) {
    '--- 23. Watch progress outlives a Host that was killed, and the row resumes it'
    $app = $ctx.App
    # An episode of the fixture's series is what is watched, because Watch
    # progress is per Video (#29): the fixture's two episodes are separate
    # entries, and a resume reads one of them.
    if (-not (Open-Series $app)) {
        Skip 'Watch progress outlives a killed Host' (
            "this Addon drew no series row, so there is no series to watch: run with -AddonName Verify (or -Addon <a Series Addon>)")
        return
    }
    if (-not (Open-Streams $app 'S1E1')) {
        Skip 'Watch progress outlives a killed Host' 'the series Title offers no first episode'
        return
    }
    Shot $app '23-streams.png'
    $kind = Choose-Candidate $app
    if ($kind -ne 'playable') {
        Skip 'Watch progress outlives a killed Host' (
            "the Addon answered no playable candidate ($kind): $(Page-Text $app)")
        return
    }
    $playing = Wait-Shows $app 'Pause' 45
    if (-not $playing) {
        Skip 'Watch progress outlives a killed Host' (
            'the Stream never started playing, so there was no position to record')
        return
    }

    # Watch a little of it: a seek is a position the Host writes down at once, and
    # the OSD's position slider is where a person (and this script) reads it.
    Press-Button $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    Press-Button $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    Wake-Osd $app
    $watched = Position-Seconds $app
    Check 'playback is where the seeks left it, not at the beginning' (
        $watched -gt 5) "the position reads $watched s"
    Shot $app '23-watching.png'

    # The Host is *killed*, not closed: an unclean exit is the case the criterion
    # is written against, and a clean close would let it flush on the way out.
    'killing the Host rather than closing it, so nothing is given a chance to flush on the way out'
    Stop-Process -Id $app.Process.Id -Force
    Start-Sleep -Seconds 2

    $ctx.App = Start-Host
    $app = $ctx.App
    Focus $app | Out-Null
    $text = Wait-Text $app 'Continue watching' 60
    Shot $app '23-after-restart.png'
    Check 'the restarted Host offers the Video it was on, in the Continue watching row' (
        $text -match 'Continue watching') "showed: $text"

    # The card's own words are the Title, the episode and what is left - the note
    # `m:ss left` is what tells a partly-watched card apart from the rest of the
    # row without spelling the whole accessible name.
    $cards = Continue-Cards $app
    if ($cards.Count -eq 0) {
        Skip 'resuming from the Continue watching row' (
            "the row drew no partly-watched card: showed $text")
        return
    }
    Press-Element $app $cards[0]
    $playing = Wait-Shows $app 'Pause' 45
    Shot $app '23-resumed.png'
    Check 'pressing the card plays the Video again' $playing "showed: $(Page-Text $app)"
    if ($playing) {
        Wake-Osd $app
        $resumed = Position-Seconds $app
        Check 'and it resumes where it was left rather than at the beginning' (
            ($resumed -ge 0) -and ($resumed -ge ($watched - 15))) (
            "it was left at $watched s and resumed at $resumed s")
        Press-Button $app 'Stop'
        # Stop returns to the Streams level; Home is two Backs away.
        Press-Keys $app '{ESC}'
        Start-Sleep -Milliseconds 500
        Press-Keys $app '{ESC}'
        Wait-Text $app 'Continue watching' 20 | Out-Null
    }
}

function Step-24($ctx) {
    '--- 24. Settings > Credentials: signing in to Stremio, and out again'
    $app = $ctx.App
    Open-Settings-Category $app 'Credentials' 'Stremio account'

    # Before: no account, so nothing syncs, and the window offers a sign-in rather
    # than claiming anything it does not hold. An account an earlier run left
    # behind - a crash between sign-in and sign-out - is forgotten first, because
    # the OS keyring is not part of the data-directory wipe at the top.
    if (Shows $app 'Sign out' 2) {
        Click-Element $app (Button-Named $app 'Sign out')
        Wait-Text $app 'Sign out of Stremio' 10 | Out-Null
        Press-Last $app 'Sign out'
        Wait-Text $app 'No Stremio account is signed in' 20 | Out-Null
    }
    $text = Wait-Text $app 'No Stremio account is signed in' 15
    Shot $app '24-before-signin.png'
    Check 'with no account the window says so' (
        $text -match 'No Stremio account is signed in') "showed: $text"
    Check 'and it offers a sign-in rather than a sign-out' (
        (Shows $app 'Sign in') -and -not (Shows $app 'Sign out' 1)) (
        'the window shows no Sign in button')

    # The account is the operator's own, and it is signed in by hand, in the
    # window's own form: the password is typed straight into the password field
    # and never passes through this script, a console, or a PowerShell variable.
    # A refusal (a wrong password) leaves the form up with the Host's own words,
    # so a retry is just signing in again before the wait runs out.
    ''
    'SIGN IN NOW, in the Host window under Settings > Credentials > Stremio account:'
    'type your Stremio email and password, and press Sign in. This script waits for'
    'the window to say an account is held (up to 5 minutes); nothing is typed here.'
    $text = Wait-Text $app 'A Stremio account is signed in' 300
    Shot $app '24-signed-in.png'
    Check 'signing in is held: the window says the account is signed in' (
        $text -match 'A Stremio account is signed in') "showed: $text"
    Check 'and the form is gone, so no password sits in the window' (
        -not (Shows $app 'Stremio email' 1)) 'the sign-in form is still there'
    Check 'and the window says a credential is held, never the credential itself' (
        $text -notmatch 'authKey') "showed: $text"

    # Sign out again: the walkthrough leaves the machine the way it found it, and
    # signing out is the other half of the surface. Progress already merged is not
    # touched by it - the window only stops claiming an account. To watch a Title
    # and see it pushed, sign in and watch before running this step; the merge and
    # the push are covered by host-core/tests/stremio_sync.rs.
    Click-Element $app (Button-Named $app 'Sign out')
    Wait-Text $app 'Sign out of Stremio' 10 | Out-Null
    Press-Last $app 'Sign out'
    $text = Wait-Text $app 'No Stremio account is signed in' 20
    Shot $app '24-signed-out.png'
    Check 'signing out forgets the account: the window says no account is signed in' (
        $text -match 'No Stremio account is signed in') "showed: $text"
    Check 'and it offers the sign-in form again' (
        Shows $app 'Stremio email') 'the sign-in form did not come back'

    # Close the Host the way a person does, so the exit hook #30 added is really
    # run and the log writer flushes.
    Stop-Host $app
    Start-Sleep -Seconds 1

    $exit = Select-String -Path $log -Pattern 'the Host is exiting; the last position is saved' |
        Select-Object -Last 1
    Check 'the Host exits through the hook #30 added' ($exit -ne $null) 'no exit line in host.log'
    Check 'and it says no account was told, because the one signed in was signed out' (
        ($exit -ne $null) -and ($exit.Line -match '"account":false')) (
        "the exit line says: $($exit.Line)")
    Check 'nothing pulled remote progress into the library before an account was held' (
        -not (Select-String -Path $log -SimpleMatch 'remote progress pulled into library' -Quiet)) (
        'host.log holds a remote pull')
    Check 'and the log never names Stremio or its authKey' (
        -not (Select-String -Path $log -SimpleMatch 'strem.io' -Quiet) -and
        -not (Select-String -Path $log -SimpleMatch 'authKey' -Quiet)) (
        'host.log names Stremio or its authKey')
    'the merge and the push need a Title watched while signed in; that is the same'
    'surface (sign-in already proves the account is held) and host-core/tests/stremio_sync.rs'
    'covers it, so this step stops at the account.'
}

function Step-25($ctx) {
    '--- 25. Settings > Remote devices: pairing a phone browser and revoking it'
    $app = $ctx.App
    Open-Settings-Category $app 'Remote devices' 'Pairing code'
    Focus $app | Out-Null

    # The Host is serving remote clients: it said so, and it announced itself. The
    # announcement is what discovery is; a machine whose mDNS could not be spoken
    # says so in the log instead, and everything still works by address.
    Check 'the Host is serving remote clients' (
        (Test-Path $log) -and
        (Select-String -Path $log -SimpleMatch 'the Host answers remote clients' -Quiet)) (
        'host.log says nothing about a wire server')
    Check 'the Host announced itself for discovery' (
        (Test-Path $log) -and
        (Select-String -Path $log -SimpleMatch 'the Host announces itself on the network' -Quiet)) (
        'host.log has no mDNS announcement (manual host:port still works)')

    # What the window reads out is all a person needs to connect a browser on
    # another device: an address, and a code to redeem once.
    $pairing = Read-Pairing $app
    $text = $pairing.Text
    $address = $pairing.Address
    $code = $pairing.Code
    Shot $app '25-pairing.png'
    Check 'the window says where remote clients connect' (
        $text -match 'Remote devices') "showed: $text"
    Check 'and shows an address a phone can open' (
        ($address -ne '') -and ($address -notmatch '^0\.0\.0\.0:')) "read: '$address'"
    Check 'and shows a six-character pairing code' (
        $code -match '^[A-HJ-NP-Z2-9]{6}$') "read: '$code'"
    Check 'and a fresh Host has paired nothing yet' (
        $text -match 'No device is paired yet') "showed: $text"

    # The pairing itself is by hand: a browser on another device on this network.
    # Nothing is typed here, and no token passes through the script.
    $published = Published-Snapshots
    ''
    "PAIR A DEVICE NOW: on another device on this network, open http://$address in"
    "a browser and enter the code $code. The page is the Cast Remote: it says"
    "'Pair this device', and after pairing its bottom nav reads"
    'Home · Discover · Search · Library · Addons · Settings. This script waits until'
    'the window lists a paired device (up to 5 minutes).'
    $text = Wait-No-Text $app 'No device is paired yet' 300
    Shot $app '25-paired.png'
    Check 'the paired device is listed' (
        $text -notmatch 'No device is paired yet') "showed: $text"
    Check 'and the list offers to revoke it' (
        $text -match 'Revoke') "showed: $text"
    $after = Wait-Published $published 30
    Check 'pairing is a change every client is told of: a Snapshot went out' (
        $after -gt $published) ("the log still shows $published published Snapshot(s)")
    Check 'the redeemed code is spent: the Host shows a different one' (
        ([regex]::Match($text, 'Pairing code[^A-Z0-9]{0,6}([A-HJ-NP-Z2-9]{6})')).Groups[1].Value -ne $code) (
        "the code is still '$code'")

    ''
    'WALK THE PAIRED PAGE NOW: it is the Cast Remote. Its bottom nav has six'
    'destinations (Home · Discover · Search · Library · Addons · Settings), and'
    'Settings pushes the Credentials, Preferences, Remote devices and About/Credits'
    'sub-screens. About/Credits carries the TMDB logo and notice. Leave it on Home'
    'for the next step.'

    # Revoke it. The device is cut off - its token names no device from here - and
    # the list it was in lets it go.
    $revoke = @(Buttons-Matching $app 'Revoke ')[0]
    if (-not $revoke) {
        Check 'the paired device offers a Revoke control' $false "showed: $text"
        return
    }
    Click-Element $app $revoke
    Wait-Text $app 'Revoke ' 10 | Out-Null
    Press-Last $app 'Revoke'
    $text = Wait-Text $app 'No device is paired yet' 20
    Shot $app '25-revoked.png'
    Check 'revoking one device takes it off the list' (
        $text -match 'No device is paired yet') "showed: $text"
    Check 'and leaves the Host with nothing paired, working as before' (
        $text -match 'Remote devices') "showed: $text"
    $afterRevoke = Wait-Published $after 30
    Check 'and revoking is a change too: another Snapshot went out' (
        $afterRevoke -gt $after) ("the log still shows $after published Snapshot(s)")

    'the unpaired half - a connection that has not paired reaching only the pairing'
    'exchange - and the revocation cut-off are covered by host-wire/tests/wire.rs,'
    'which drives a real socket; this step walks the window and the pairing by hand.'
}

# The full remote (#32): a browser on another device does everything the Host's
# own window does, because it sends the same Actions. The page is the Cast Remote
# (#88): six destinations, a docked strip that expands into the full-screen
# surface, and the Audio & Subtitles sheet. What this step can check is the half
# that is shared state - a Stream started, paused and stopped from the phone
# shows up in the window, which is another client of the same Snapshot - because
# the phone's own screen is not something this script can screenshot. The
# operator walks the page itself; its capability list is asserted against the
# Action surface by `host-wire/src/remote.rs`.
function Step-26($ctx) {
    '--- 26. the full remote: browse, play and control from another device'
    $app = $ctx.App
    Open-Settings-Category $app 'Remote devices' 'Pairing code'
    Focus $app | Out-Null

    $pairing = Read-Pairing $app
    $text = $pairing.Text
    $address = $pairing.Address
    $code = $pairing.Code
    Shot $app '26-pairing.png'
    Check 'the window reads out where to connect and the code to redeem' (
        ($address -ne '') -and ($address -notmatch '^0\.0\.0\.0:') -and ($code -match '^[A-HJ-NP-Z2-9]{6}$')) (
        "read address '$address' and code '$code'")

    $published = Published-Snapshots
    ''
    "DRIVE THE REMOTE NOW: on another device on this network, open"
    "http://$address in a browser and enter the code $code. Then, from that page,"
    'search or browse, open a Title, pick a Stream and press play. This script waits'
    'until the Host lists the paired device (up to 5 minutes).'
    $text = Wait-No-Text $app 'No device is paired yet' 300
    Shot $app '26-paired.png'
    Check 'the remote paired and is listed as a device' (
        $text -notmatch 'No device is paired yet') "showed: $text"
    Check 'and pairing is a change every client is told of' (
        (Wait-Published $published 30) -gt $published) (
        "the log still shows $published published Snapshot(s)")

    # The page itself is the operator's evidence. These lines are the route, in
    # the order a person walks it; the script cannot screenshot the phone.
    ''
    'WALK SURFACE 1 (Browse) NOW. The page is the Cast Remote:'
    '  - the bottom nav has Home · Discover · Search · Library · Addons · Settings;'
    '  - Home draws the Featured hero, a 16:9 Continue watching row, and one row'
    '    per Catalog in the Addons order, each with More where the Catalog pages;'
    '  - Discover is TMDB weekly Trending with Movie/Series and a genre filter, or'
    '    says where a TMDB key goes when none is held;'
    '  - Search asks TMDB Movies and Series with a key, or every searchable Addon'
    '    Catalog without one;'
    '  - Library shows the shared Stremio sign-in gate, or the signed-in placeholder;'
    '  - Addons adds by manifest URL, expands a row in place, and offers'
    '    Move up · Move down · Remove (Remove asks for confirmation);'
    '  - Settings pushes Credentials, Preferences, Remote devices and About/Credits.'
    '  - a card opens a Title level; a Video opens the Addon-grouped Streams level.'
    'Press Escape to pop each level; it must return to the screen underneath.'
    ''
    'Now open a Title and press play on a Stream. The levels collapse and the'
    'docked cast strip appears directly above the bottom nav.'
    $playing = Wait-Shows $app 'Pause' 120
    Shot $app '26-playing.png'
    Check 'a Stream started from the remote plays on the Host' $playing (
        "the window shows no Pause: $(Page-Text $app)")

    if ($playing) {
        ''
        'WALK SURFACE 2 (the expanded Cast Remote) NOW: tap the centered strip.'
        '  - the full-screen surface shows the centered poster, the three utility'
        '    icons (Audio & Subtitles, Volume, Episodes), the scrubber and times,'
        '    and the transport: Prev Ep · -10 · play/pause · +10 · Next Ep · Stop;'
        '  - Episodes is active for a series and lists the playing series'' episodes;'
        '  - the Speed, Chapters and Picture rows below the transport carry the'
        '    rest of the control set;'
        '  - the footer names the connected Host.'
        ''
        'NOW, ON THE REMOTE: pause it. This script watches the Host for the pause -'
        'the window''s OSD offers Play where it offered Pause.'
        $paused = Wait-Shows $app 'Play' 120
        Check 'pause, taken on the remote, pauses the Host' $paused (Page-Text $app)

        ''
        'WALK SURFACE 3 (Audio & Subtitles) NOW: from the expanded surface, open'
        'Audio & Subtitles. Choose an audio track, a subtitle track (or Subtitles'
        'off), and nudge the subtitle delay. Each choice reaches the Host at once;'
        'there is no Apply. Press Done to close the sheet.'
        ''
        'NOW, ON THE REMOTE: seek (for example +10 s). The Host''s position should'
        'move even though playback is paused.'
        Wake-Osd $app
        $still = Position-Seconds $app
        $seeked = $still
        $deadline = (Get-Date).AddSeconds(120)
        while (($seeked -eq $still) -and ((Get-Date) -lt $deadline)) {
            Start-Sleep -Milliseconds 500
            Wake-Osd $app
            $seeked = Position-Seconds $app
        }
        Check 'seek, taken on the remote, moves the Host''s position' (
            ($still -ge 0) -and ($seeked -ge 0) -and ($seeked -ne $still)) (
            "the position stayed at $still")

        $after = Wait-Published $published 30
        Check 'and the remote''s controls publish Snapshots like any other client' (
            $after -gt $published) ("the log still shows $published published Snapshot(s)")

        ''
        'NOW, ON THE REMOTE: press Stop. The window returns to what it was reading,'
        'and the remote''s docked strip goes away.'
        $text = Wait-No-Text $app 'Pause' 120
        Check 'stopping from the remote clears playback everywhere' (
            $text -notmatch 'Pause') "showed: $text"
    } else {
        Skip 'the remote playing and controlling a Stream' (
            'no Stream started, so there was nothing for the remote to control')
    }

    # Leave the run as step 25 leaves it: nothing paired behind. Guarded, because a
    # run whose operator never paired has nothing to revoke and must say so rather
    # than throw.
    $revoke = @(Buttons-Matching $app 'Revoke ')[0]
    if ($revoke) {
        Click-Element $app $revoke
        Wait-Text $app 'Revoke ' 10 | Out-Null
        Press-Last $app 'Revoke'
        $text = Wait-Text $app 'No device is paired yet' 20
        Shot $app '26-revoked.png'
        Check 'the device can be revoked from the window, leaving nothing paired' (
            $text -match 'No device is paired yet') "showed: $text"
    } else {
        Skip 'revoking the remote from the window' (
            'no device was paired, so there was nothing to revoke')
    }
}

function Step-27($ctx) {
    '--- 27. the rail and the D-pad: edges stop, and a short row does not leak'
    $app = $ctx.App
    Open-Home $app
    Start-Sleep -Seconds 2

    # The rail's two ends are walls: Up on Home is the top, and Down on Settings
    # is the bottom. Nothing wraps.
    Focus-On $app 'Home' ([Windows.Automation.ControlType]::Button)
    $at = Focused-Name
    Check 'the rail starts on Home' ($at -eq 'Home') "focus is on '$at'"
    Press-Keys $app '{UP}'
    $at = Focused-Name
    Check 'Up at the top of the rail stops there' ($at -eq 'Home') "focus is on '$at'"
    for ($i = 0; $i -lt 5; $i++) { Press-Keys $app '{DOWN}' }
    $at = Focused-Name
    Check 'Down walks the rail to Settings' ($at -eq 'Settings') "focus is on '$at'"
    Press-Keys $app '{DOWN}'
    $at = Focused-Name
    Check 'Down at the bottom of the rail stops there' ($at -eq 'Settings') "focus is on '$at'"
    for ($i = 0; $i -lt 5; $i++) { Press-Keys $app '{UP}' }
    $at = Focused-Name
    Check 'Up walks it back to Home' ($at -eq 'Home') "focus is on '$at'"

    # Right leaves the rail for the content at the rail item's height: the hero
    # when Home has one. Left comes back to the rail.
    Press-Keys $app '{RIGHT}'
    $at = Focused-Name
    $destinations = @('Home', 'Discover', 'Search', 'Library', 'Addons', 'Settings')
    Check 'Right leaves the rail for the content' (
        ($at -ne '') -and ($destinations -notcontains $at)) "focus is on '$at'"
    # The hero keeps Left for its own slides; from a card, or once the hero is
    # on its first slide, Left crosses to the rail. Two presses walk both cases.
    Press-Keys $app '{LEFT}'
    Press-Keys $app '{LEFT}'
    $at = Focused-Name
    Check 'and Left comes back to the rail at the matching height' (
        $destinations -contains $at) "focus is on '$at'"

    # A short row stops at its own end: Right on its last card must not leak
    # diagonally into the wider row below (the guard in focus.ts).
    $cards = Continue-Cards $app
    if ($cards.Count -eq 0) {
        Skip 'the short-row crossing guard' (
            'Home has no Continue watching row here: run the checklist through step 23, or watch something first')
    } else {
        $last = $cards[$cards.Count - 1]
        $last.SetFocus()
        Start-Sleep -Milliseconds 400
        $before = Focused-Name
        Press-Keys $app '{RIGHT}'
        $after = Focused-Name
        Check 'Right at the end of a short row stops there, rather than leaking into the row below' (
            ($before -ne '') -and ($after -eq $before)) (
            "focus went from '$before' to '$after'")
    }
    Shot $app '27-dpad.png'
}

function Step-28($ctx) {
    '--- 28. the hero: rotation while unfocused, and its text fallback'
    $app = $ctx.App
    Open-Home $app
    Start-Sleep -Seconds 2
    $hero = @(Buttons-Matching $app 'Featured Title:')[0]
    if (-not $hero) {
        Skip 'the hero rotation' 'Home drew no Featured hero here, so there is no slide to rotate'
        return
    }

    $text = Page-Text $app
    if ($text -match 'Rotation off') {
        'the hero says Rotation off (one slide, or the system asks for reduced motion)'
        Check 'a single-slide hero states that it does not rotate' $true ''
    } else {
        # Focused, the six-second timer holds: the slide a person is reading must
        # not change under them.
        $hero.SetFocus()
        Start-Sleep -Seconds 1
        $text = Wait-Text $app 'Focused . rotation held' 10
        Shot $app '28-hero-focused.png'
        Check 'focusing the hero holds its rotation' (
            $text -match 'Focused . rotation held') "showed: $text"
        $before = Hero-Title $app
        Start-Sleep -Seconds 7
        $after = Hero-Title $app
        Check 'and the slide does not move while it is focused' (
            ($before -ne '') -and ($after -eq $before)) "the slide went '$before' to '$after'"

        # Unfocused, it steps on its own every six seconds.
        Focus-On $app 'Home' ([Windows.Automation.ControlType]::Button)
        Start-Sleep -Seconds 1
        $text = Wait-Text $app 'Auto-rotating' 10
        Check 'an unfocused hero says it rotates' (
            $text -match 'Auto-rotating') "showed: $text"
        $before = Hero-Title $app
        $after = $before
        $deadline = (Get-Date).AddSeconds(10)
        while (($after -eq $before) -and ((Get-Date) -lt $deadline)) {
            Start-Sleep -Milliseconds 500
            $after = Hero-Title $app
        }
        Shot $app '28-hero-rotated.png'
        Check 'and it steps to another slide on its own' (
            ($before -ne '') -and ($before -ne $after)) "the slide stayed '$before'"
    }

    # The fixture carries portrait posters and no billboard art, so the hero has
    # to fall back to its text slide rather than stretching a 2:3 poster. UI
    # Automation cannot see whether an image was drawn, so the screenshot is the
    # evidence a person reads here.
    'fallback: this Catalog declares portrait posters only, so the hero has no billboard art'
    'review 28-hero-focused.png and 28-hero-rotated.png: the hero should be a text slide'
    'with the Title and its description, not a stretched portrait poster'
}

function Step-29($ctx) {
    '--- 29. Library: the sign-in gate, and no collection it does not have'
    $app = $ctx.App
    Open-Destination $app 'Library'
    $text = Wait-Text $app 'Your Library will hold|Signed in to Stremio' 20
    Shot $app '29-library.png'
    $gate = $text -match 'Your Library will hold the Titles saved in your Stremio account'
    $held = $text -match 'Signed in to Stremio\. The Titles saved in your account will appear here'
    Check 'Library either offers the Stremio sign-in gate or says the collection is not built' (
        $gate -or $held) "showed: $text"
    Check 'it draws no collection it does not have' (
        $text -notmatch 'Continue watching') "showed: $text"
    if ($gate) {
        Check 'the gate carries the shared sign-in form' (
            (Shows $app 'Stremio email') -and (Shows $app 'Stremio password')) "showed: $text"
        Check 'and no sign-out, because sign-out lives in Settings' (
            -not (Shows $app 'Sign out' 1)) 'the Library draws a Sign out control'
    } else {
        Check 'the placeholder offers no sign-out of its own' (
            -not (Shows $app 'Sign out' 1)) 'the Library draws a Sign out control'
        Check 'and no form, because the account it draws from is held' (
            -not (Shows $app 'Stremio email' 1)) 'the Library still draws the sign-in form'
    }

    Press-Keys $app '{ESC}'
    $text = Wait-Text $app 'Featured Title:' 20
    Check 'Back returns to Home' (
        $text -match 'Featured Title:') "showed: $text"
}

function Step-30($ctx) {
    '--- 30. Discover: the no-key state, and the keyed feed'
    $app = $ctx.App
    # The keyring outlives the data-directory wipe; start from "no key is held"
    # honestly, the way step 19 does.
    Open-Settings-Category $app 'Credentials' 'TMDB key'
    Clear-TmdbKey $app

    Open-Destination $app 'Discover'
    $text = Wait-Text $app 'Discover is powered by TMDB' 20
    Shot $app '30-discover-no-key.png'
    Check 'with no key, Discover stays in the rail and says what powers it' (
        $text -match 'Discover is powered by TMDB') "showed: $text"
    Check 'and points at where a key is saved' (
        ($text -match 'Settings') -and ($text -match 'Credentials')) "showed: $text"
    Check 'and the no-key state still carries the TMDB attribution' (
        $text -match [regex]::Escape($tmdbNotice)) "showed: $text"

    # The keyed arm, over a key the step enters and clears again: the test key is
    # not TMDB's, so the feed says TMDB did not answer - the screen still draws its
    # filters, and the attribution it has to carry, rather than disappearing.
    Open-Settings-Category $app 'Credentials' 'TMDB key'
    Clear-TmdbKey $app
    Set-TmdbKey $app '0123456789abcdef'
    Press $app 'Save key'
    Wait-Text $app 'A TMDB key is held' 20 | Out-Null

    Open-Destination $app 'Discover'
    $text = Wait-Text $app 'TMDB''s weekly Trending feed' 20
    Shot $app '30-discover-keyed.png'
    Check 'with a key, Discover draws the feed it is named for' (
        $text -match 'TMDB''s weekly Trending feed') "showed: $text"
    Check 'and the kind and genre filters' (
        (Shows $app 'Movie') -and (Shows $app 'Series') -and (Shows $app 'All genres')) (
        "showed: $text")
    $text = Wait-Text $app 'TMDB did not answer' 30
    Check 'a key TMDB refuses is said inline, not hidden' (
        $text -match 'TMDB did not answer') "showed: $text"
    Check 'and Discover carries the TMDB attribution in both states' (
        $text -match [regex]::Escape($tmdbNotice)) (
        "showed: $text")

    # Leave no key behind: the walkthrough started with none.
    Open-Settings-Category $app 'Credentials' 'TMDB key'
    Clear-TmdbKey $app
    $text = Wait-Text $app 'No TMDB key is held' 20
    Check 'clearing the test key leaves no key held' (
        $text -match 'No TMDB key is held') "showed: $text"
    Open-Destination $app 'Discover'
    $text = Wait-Text $app 'Discover is powered by TMDB' 20
    Check 'and Discover is back to its no-key state' (
        $text -match 'Discover is powered by TMDB') "showed: $text"

    Press-Keys $app '{ESC}'
    Wait-Text $app 'Featured Title:' 20 | Out-Null
}

function Step-31($ctx) {
    '--- 31. the previous episode: a wall at S1E1, and a step back from S1E2'
    $app = $ctx.App
    if (-not (Open-Series $app)) {
        Skip 'the previous episode' 'this Addon drew no series row to play an episode from'
        return
    }
    if (-not (Open-Streams $app 'S1E1')) {
        Skip 'the previous episode' 'the series Title offers no first episode'
        return
    }
    $kind = Choose-Candidate $app
    if ($kind -ne 'playable') {
        Skip 'the previous episode' 'the Addon answered no playable candidate'
        return
    }
    $playing = Wait-Shows $app 'Pause' 45
    if (-not $playing) {
        Skip 'the previous episode' 'the Stream never started playing'
        return
    }
    Wake-Osd $app
    $previous = Button-Named $app 'Previous episode' 5
    Check 'at S1E1, Previous episode is greyed where the position alone can say so' (
        ($previous -ne $null) -and ((Episode-Number $app) -eq 1) -and (Is-Disabled $previous)) (
        "S1E$(Episode-Number $app), present=$($previous -ne $null), disabled=$(Is-Disabled $previous)")
    $before = Episode-Number $app
    Press-Button $app 'Next episode'
    $after = Wait-Episode-Change $app $before
    Check 'Next episode moves to S1E2' ($after -eq 2) "the episode is S1E$after"
    Wake-Osd $app
    $previous = Button-Named $app 'Previous episode' 5
    Check 'and at S1E2, Previous episode is offered' (
        ($previous -ne $null) -and -not (Is-Disabled $previous)) 'the Previous episode control is absent or still disabled'
    Press-Button $app 'Previous episode'
    $back = Wait-Episode-Change $app $after
    Shot $app '31-previous-episode.png'
    Check 'pressing it steps back to S1E1' ($back -eq 1) "the episode is S1E$back"
    Press-Button $app 'Stop'
    Wait-Text $app 'Streams ' 20 | Out-Null
}

function Step-32($ctx) {
    '--- 32. TMDB attribution on Discover and in About/Credits'
    $app = $ctx.App
    $notice = $tmdbNotice
    Open-Destination $app 'Discover'
    $text = Wait-Text $app 'This product uses the TMDB API' 20
    Shot $app '32-discover-credit.png'
    Check 'Discover credits TMDB in its footer' (
        $text -match [regex]::Escape($notice)) "showed: $text"
    Check 'and names it by its logo' (
        Shows $app 'TMDB') "showed: $text"

    Open-Settings-Category $app 'About/Credits' 'TMDB'
    $text = Wait-Text $app 'This product uses the TMDB API' 20
    Shot $app '32-about.png'
    Check 'About/Credits repeats the attribution' (
        $text -match [regex]::Escape($notice)) "showed: $text"
    Check 'and names the version and the licence the app is under' (
        ($text -match '\d+\.\d+\.\d+') -and ($text -match 'GPL-3\.0')) "showed: $text"
}

function Step-33($ctx) {
    '--- 33. Settings > Preferences: the subtitle appearance, and its restart'
    $app = $ctx.App
    $before = Snapshot-Baseline
    Open-Settings-Category $app 'Preferences' 'Subtitle appearance'
    Shot $app '33-appearance.png'
    $text = Page-Text $app
    Check 'Preferences has a Subtitle appearance section that says what an ASS track keeps' (
        $text -match 'ASS track') "showed: $text"
    Check 'white and 100% are the choices pressed before anything is chosen' (
        (Toggled (Button-Named $app 'White')) -and
        (Toggled (Button-Named $app ('Default ' + $dot + ' 100%')))) "showed: $text"

    $yellow = Button-Named $app 'Yellow' 10
    if (-not $yellow) { throw 'the Preferences screen shows no Yellow choice' }
    Press-Element $app $yellow
    $text = Wait-Text $app 'Yellow' 10
    Check 'choosing Yellow presses it and takes the press off White' (
        (Toggled (Button-Named $app 'Yellow')) -and
        -not (Toggled (Button-Named $app 'White'))) "showed: $text"
    Check 'choosing a colour published one Snapshot' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"

    $beforeSize = Snapshot-Baseline
    $large = Button-Named $app ('Large ' + $dot + ' 125%') 10
    if (-not $large) { throw 'the Preferences screen shows no Large choice' }
    Press-Element $app $large
    $text = Wait-Text $app 'Large' 10
    Check 'choosing Large presses it and takes the press off Default' (
        (Toggled (Button-Named $app ('Large ' + $dot + ' 125%'))) -and
        -not (Toggled (Button-Named $app ('Default ' + $dot + ' 100%')))) "showed: $text"
    Check 'choosing a size published one Snapshot' (
        (Wait-Published $beforeSize 20) -gt $beforeSize) "the log still shows $beforeSize published Snapshot(s)"
    Shot $app '33-appearance-chosen.png'

    Stop-Host $app
    $restarted = Start-Host
    $ctx.App = $restarted
    Focus $restarted | Out-Null
    Start-Sleep -Seconds 2
    Open-Settings-Category $restarted 'Preferences' 'Subtitle appearance'
    Shot $restarted '33-restarted.png'
    $text = Wait-Text $restarted 'Subtitle appearance' 20
    Check 'the restarted Host still draws subtitles yellow at 125%' (
        (Toggled (Button-Named $restarted 'Yellow')) -and
        (Toggled (Button-Named $restarted ('Large ' + $dot + ' 125%')))) "showed: $text"
}

function Step-34($ctx) {
    '--- 34. subtitles on a real picture: SRT colour, ASS authored colour, and size'
    $app = $ctx.App

    # The colour is a preference, and Settings is not reachable while a Stream
    # plays: choose it before the picture starts.
    Open-Settings-Category $app 'Preferences' 'Subtitle appearance'
    $yellow = Button-Named $app 'Yellow' 10
    if (-not $yellow) { throw 'the Preferences screen shows no Yellow choice' }
    if (-not (Toggled $yellow)) { Press-Element $app $yellow; Start-Sleep -Seconds 1 }
    $defaultSize = Button-Named $app ('Default ' + $dot + ' 100%') 10
    if ($defaultSize -and -not (Toggled $defaultSize)) { Press-Element $app $defaultSize; Start-Sleep -Seconds 1 }
    $text = Page-Text $app
    Check 'the Host holds yellow at the default size before the picture starts' (
        (Toggled (Button-Named $app 'Yellow')) -and
        (Toggled (Button-Named $app ('Default ' + $dot + ' 100%')))) "showed: $text"

    if (-not (Play-The-First-Stream $app)) {
        Skip 'the subtitle appearance on a real picture' (
            'this Addon answered no playable candidate for the first Title: run with the fixture Addon and its fixture video')
        return
    }
    Shot $app '34-playing.png'

    Wake-Osd $app
    Press-Button $app 'Subtitles'
    $text = Wait-Text $app 'Subtitles off' 10
    $srt = @(Buttons-Matching $app 'subrip')[0]
    $ass = @(Buttons-Matching $app 'ASS styled')[0]
    if (-not $srt -or -not $ass) {
        Skip 'the subtitle appearance on a real picture' (
            'the Stream carries no SRT and ASS tracks to compare: the fixture video carries both (scripts/windows/fixture-video.sh)')
        Press-Keys $app '{ESC}'
        Press-Button $app 'Stop'
        return
    }

    # The SRT track first: it has no styling of its own, so it takes the colour.
    Click-Element $app $srt
    Start-Sleep -Seconds 1
    Press-Keys $app '{ESC}'
    # The OSD sits over the bottom of the picture, where the subtitles are: let
    # its three idle seconds pass so the screenshot shows the line, not the menu.
    Start-Sleep -Seconds 5
    Shot $app '34-srt-yellow.png'
    'review 34-srt-yellow.png: the English SRT line should be yellow, not white'

    # The size, from the OSD: five steps from 100% lands on the Large chip.
    Wake-Osd $app
    Press-Button $app 'Subtitles'
    Wait-Text $app 'Subtitles off' 10 | Out-Null
    $before = Snapshot-Baseline
    for ($i = 0; $i -lt 5; $i++) {
        Click-Element $app (Button-Named $app 'Larger subtitles')
        Start-Sleep -Milliseconds 400
    }
    Check 'five presses of the OSD size land on 125%, as the readout says' (
        (Readout $app 'Subtitle size 125%') -ne $null) "showed: $(Page-Text $app)"
    Check 'and each press is the preference changing: Snapshots went out' (
        (Wait-Published $before 20) -gt $before) "the log still shows $before published Snapshot(s)"
    Shot $app '34-osd-size.png'
    Press-Keys $app '{ESC}'
    Start-Sleep -Seconds 5
    Shot $app '34-srt-yellow-large.png'
    'review 34-srt-yellow-large.png against 34-srt-yellow.png: the same SRT line, in the same yellow, larger at 125%'

    # The ASS track: authored red, so the colour preference must not reach it,
    # while the size does.
    Wake-Osd $app
    Press-Button $app 'Subtitles'
    Wait-Text $app 'Subtitles off' 10 | Out-Null
    $ass = @(Buttons-Matching $app 'ASS styled')[0]
    if ($ass) { Click-Element $app $ass }
    Start-Sleep -Seconds 1
    Press-Keys $app '{ESC}'
    Start-Sleep -Seconds 5
    Shot $app '34-ass-authored.png'
    'review 34-ass-authored.png: the ASS line should still be the red it was authored with, and larger than at 100%'

    Wake-Osd $app
    Press-Button $app 'Stop'
    Wait-Text $app 'Streams ' 20 | Out-Null

    # The OSD's size is the Host's preference: Settings presses it.
    Open-Settings-Category $app 'Preferences' 'Subtitle appearance'
    Shot $app '34-settings-after-osd.png'
    $text = Wait-Text $app 'Subtitle appearance' 20
    Check 'the size the OSD set is the choice Settings presses' (
        Toggled (Button-Named $app ('Large ' + $dot + ' 125%'))) "showed: $text"
    Check 'and the colour chosen before playback is still the Host''s' (
        Toggled (Button-Named $app 'Yellow')) "showed: $text"

    # And the next Stream opens at it.
    if (-not (Play-The-First-Stream $app)) {
        Skip 'the size on a new Stream' 'the Addon answered no playable candidate the second time'
        return
    }
    Wake-Osd $app
    Press-Button $app 'Subtitles'
    Wait-Text $app 'Subtitles off' 10 | Out-Null
    Check 'the next Stream''s size readout is the 125% the preference holds' (
        (Readout $app 'Subtitle size 125%') -ne $null) "showed: $(Page-Text $app)"
    Shot $app '34-next-stream.png'
    Press-Keys $app '{ESC}'
    Wake-Osd $app
    Press-Button $app 'Stop'
    Wait-Text $app 'Streams ' 20 | Out-Null
}

# --- the dispatcher -----------------------------------------------------------
#
# The data directory is emptied once, before any Host opens, so "the preference
# survives a restart" and "a fresh Host has no Addons" are really being tested.
Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dataDir 'host.sqlite3*') -ErrorAction SilentlyContinue

$ctx = @{
    App = $null
    Series = $false
    NoEpisodes = $false
    TestKey = ''
}

foreach ($id in $selected) {
    $step = $byId[$id]
    if ($step.Ground -eq 'data') { New-Item -ItemType Directory -Force $dataDir | Out-Null }
    elseif ($step.Ground -eq 'fresh') { Ensure-FreshHost $ctx }
    elseif ($step.Ground -eq 'addon' -or $step.Ground -eq 'rows') { Ensure-AddonHost $ctx }
    & ('Step-' + $step.Id) $ctx
}

# A Host this run started and no step stopped is left the way a person leaves it,
# so its log flushes and it does not hold the single instance for the next run.
if ($ctx.App -and -not $ctx.App.Process.HasExited) { Stop-Host $ctx.App }

# --- the tail of every run ----------------------------------------------------

'--- host.log (last 20 lines)'
if (Test-Path $log) { Get-Content $log -Tail 20 } else { 'no host.log' }

''
if ($failures.Count -eq 0 -and $skipped.Count -eq 0) { 'ALL CHECKS PASSED' }
elseif ($failures.Count -eq 0) {
    "SKIPPED CHECKS ($($skipped.Count)) - this run did not walk these:"
    $skipped | ForEach-Object { "  - $_" }
    exit 2
}
else {
    "FAILED CHECKS ($($failures.Count)):"
    $failures | ForEach-Object { "  - $_" }
    exit 1
}
