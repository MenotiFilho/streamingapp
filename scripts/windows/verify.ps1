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
#
# Any subset of the checklist can be walked on its own instead of all of it. A
# step that needs the Host, the fixture Addon, or the catalog rows has that built
# for it first, and two steps that need the same ground share the one Host; a step
# that reads what an earlier step left behind and cannot be rebuilt refuses loudly
# rather than checking the wrong state:
#
#   ... -List           the checklist and what each step needs, without a Host
#   ... -Only 13        just the control set, over one Host and the fixture Addon
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
# page (this file has no BOM), so the em dash the window's Streams heading uses
# is built from its code point instead of written out.
$dash = [char]0x2014

# The checklist, in the order a full run walks it. `-List` prints this and exits;
# the dispatcher uses it to decide what to run and what to refuse.
#
# `Ground` is what the runner has to establish before the step:
#   'fresh' - the empty data directory the run begins with, and one Host running
#   'addon' - that Host with the fixture Addon configured by manifest URL
#   'rows'  - the Addon host, at the catalog rows rather than inside a Title
#   'data'  - only that the data directory exists (step 22 lists it)
# `After` is the earlier steps whose leftovers this step reads and that must have
# run in the same invocation; `Need` is the words `-List` prints for both.
$Steps = @(
    [pscustomobject]@{ Id = 1;  Title = 'launching the Host opens a window'; Ground = ''; After = @(); Need = 'nothing: it starts its own Host from the empty data directory' }
    [pscustomobject]@{ Id = 2;  Title = 'changing the preference goes through the Action surface'; Ground = 'fresh'; After = @(); Need = 'a fresh Host (empty data directory, one Host, no Addon)' }
    [pscustomobject]@{ Id = 3;  Title = 'launching again focuses the running Host instead of starting a second one'; Ground = 'fresh'; After = @(); Need = 'a fresh Host (empty data directory, one Host, no Addon)' }
    [pscustomobject]@{ Id = 4;  Title = 'the preference survives a restart'; Ground = ''; After = @(2, 3); Need = 'steps 2 and 3: the pt-BR preference, and the second launch step 3 logged' }
    [pscustomobject]@{ Id = 5;  Title = 'a language that is not a tag is refused without touching state'; Ground = ''; After = @(4); Need = 'step 4: its restarted Host, holding pt-BR at revision 0' }
    [pscustomobject]@{ Id = 6;  Title = 'clearing the preference'; Ground = ''; After = @(4); Need = 'step 4: its restarted Host, holding pt-BR at revision 0' }
    [pscustomobject]@{ Id = 7;  Title = 'configuring an Addon by manifest URL'; Ground = ''; After = @(); Need = 'nothing: it starts its own Host from the empty data directory' }
    [pscustomobject]@{ Id = 8;  Title = 'a URL that is not an Addon is refused without losing the Addon that works'; Ground = 'addon'; After = @(); Need = 'the fixture Addon configured (one Host, the Addon added by manifest URL)' }
    [pscustomobject]@{ Id = 9;  Title = 'the Addon survives a restart'; Ground = 'addon'; After = @(); Need = 'the fixture Addon configured (one Host, the Addon added by manifest URL)' }
    [pscustomobject]@{ Id = 10; Title = 'the home surface draws a row for each catalog the Addon offers'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at its rows' }
    [pscustomobject]@{ Id = 11; Title = 'the keyboard reaches a card, and OK opens the Title'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at its rows, and the revision they stand at' }
    [pscustomobject]@{ Id = 12; Title = 'pressing a Video asks the Addons for its Streams'; Ground = ''; After = @(11); Need = 'step 11: the Title it opened, and whether it is a film or a series' }
    [pscustomobject]@{ Id = 13; Title = 'the full control set, over a real file'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at its rows' }
    [pscustomobject]@{ Id = 14; Title = 'Back leaves the Title, and the same Title opens again'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at its rows' }
    [pscustomobject]@{ Id = 15; Title = 'a series'' seasons and episodes, and choosing one'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at its rows' }
    [pscustomobject]@{ Id = 16; Title = 'paging a row is not a change: the revision stands still'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at its rows, and the revision they stand at' }
    [pscustomobject]@{ Id = 17; Title = 'searching asks every Addon that offers it'; Ground = 'rows'; After = @(); Need = 'the fixture Addon at its rows, and the revision they stand at' }
    [pscustomobject]@{ Id = 18; Title = 'Back returns to browsing, from the keyboard'; Ground = 'addon'; After = @(17); Need = 'step 17: the search surface it left showing' }
    [pscustomobject]@{ Id = 19; Title = 'the TMDB key: entered, held, cleared, and where it lives'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at its rows (it opens a Title)' }
    [pscustomobject]@{ Id = 20; Title = 'removing the Addon'; Ground = 'rows'; After = @(); Need = 'the fixture Addon configured, at its rows (it removes it)' }
    [pscustomobject]@{ Id = 21; Title = 'the manifest URL and the TMDB key never reach the log'; Ground = ''; After = @(19, 20); Need = 'steps 19 and 20: the log they wrote, the TMDB key and the removed Addon' }
    [pscustomobject]@{ Id = 22; Title = 'the data directory'; Ground = 'data'; After = @(); Need = 'the data directory (made if a Host has not)' }
    [pscustomobject]@{ Id = 23; Title = 'Watch progress outlives a Host that was killed, and the row resumes it'; Ground = 'addon'; After = @(); Need = 'the fixture Addon at its rows (it plays an episode, kills the Host, starts it again, and resumes)' }
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

# A check that could not be made at all — the surface or the Stream it needed was
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

# A candidate's own words, cut to the length a report line can hold.
function Short($text) {
    if ($text.Length -le 90) { return $text }
    return $text.Substring(0, 90) + '…'
}

# Press a control the way a person does: focus it, then the key that presses a
# button. A candidate carries `aria-pressed`, which Chromium exposes as a
# *toggle*, so the pattern a plain button answers is not always there — and the
# keyboard is one path that works for both.
function Press-Element($app, $element) {
    $element.SetFocus()
    Start-Sleep -Milliseconds 400
    if (-not (Focus $app)) { throw 'pressing a control needs the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Seconds 2
}

# Every button the window shows, in the order the tree lists them — which is the
# order they are drawn, and so the order the menu's groups appear in.
function Buttons($app) {
    @((Window-Root $app).FindAll(
        [Windows.Automation.TreeScope]::Descendants,
        (New-Object Windows.Automation.PropertyCondition(
            [Windows.Automation.AutomationElement]::ControlTypeProperty,
            [Windows.Automation.ControlType]::Button))))
}

# The buttons whose accessible name contains this word. A control's name is the
# words on it — a track's label and its marks, a chapter's time and title — so a
# fragment is what finds one without spelling the whole line (and `aria-pressed`
# choices are buttons the Invoke pattern is not guaranteed on; see Press-Element).
function Buttons-Matching($app, $fragment) {
    @(Buttons $app | Where-Object { $_.Current.Name -like ('*' + $fragment + '*') })
}

# The buttons whose accessible name is exactly this word for word.
function Buttons-Named($app, $name) {
    @(Buttons $app | Where-Object { $_.Current.Name -eq $name })
}

# Where a button whose name contains this fragment sits among all the window's
# buttons, in the order the tree lists them; -1 where there is none.
function Button-At($app, $fragment) {
    $names = @(Buttons $app | ForEach-Object { $_.Current.Name })
    for ($i = 0; $i -lt $names.Count; $i++) {
        if ($names[$i] -like ('*' + $fragment + '*')) { return $i }
    }
    return -1
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

# A readout the menu draws — the `<span>` a control's value is shown in — as
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

# The series card in the rows: the first card of the row after the Addon's first
# catalog's pager. The Addon lists its catalogs in its own order, and this
# walkthrough's fixture — and Cinemeta, the default Addon — puts a movie row
# first and a series row second, so the button after `More from <catalog>` is
# that series.
function Series-Card($app) {
    $buttons = Buttons $app
    for ($i = 0; $i -lt $buttons.Count - 1; $i++) {
        if ($buttons[$i].Current.Name -eq ('More from ' + $AddonCatalog)) {
            return $buttons[$i + 1]
        }
    }
    return $null
}

# The now-playing line, `Playing <the Stream's own badges>`, which is how a
# person reads which episode is on.
function Playing-Line($app) {
    $match = [regex]::Match((Page-Text $app), 'Playing [^|]+')
    if ($match.Success) { return $match.Value.Trim() }
    return ''
}

# Walk the whole control set on the Stream that is playing: each group asserted
# present, each choice asserted through the control's own state, and each group
# screenshotted so a person can read it too.
#
# The fixture file is what makes it possible — two audio tracks, two embedded
# subtitle tracks, two chapters and black bars, so every control has something
# to move. Whether what is playing is a film or an episode changes only whether
# `Next episode` is offered, which is the last thing checked.
function Walk-Controls($app) {
    Press-Element $app (Button-Named $app 'Menu')
    # The menu is drawn with the controls in it; `Subtitles off` is one that is
    # always there while it is open, so it is what the wait is for.
    $text = Wait-Text $app 'Subtitles off' 15

    foreach ($group in @('Audio', 'Subtitles', 'Subtitle delay', 'Speed', 'Volume',
            'Chapters', 'Crop', 'Aspect', 'Statistics')) {
        # The headings are rendered however the stylesheet says, and UI
        # Automation reads what is rendered: "Audio" is exposed as "AUDIO",
        # 'Speed' as "SPEED". The group is looked for in either spelling rather
        # than pinned to a `text-transform`, which is a stylesheet's business.
        $shown = (Shows $app $group 4) -or (Shows $app $group.ToUpperInvariant() 4)
        Check "the menu has a $group group" $shown "the window shows: $(Page-Text $app)"
        Shot $app ('13-controls-' + ($group -replace ' ', '-').ToLower() + '.png')
    }

    '--- 13a. the tracks the file carries, embedded first'
    $audioEng = Buttons-Matching $app 'English stereo'
    $audioPor = Buttons-Matching $app 'Portuguese'
    $subtitles = Buttons-Matching $app 'subrip'
    Check 'the file carries two audio tracks, and both are listed' (
        ($audioEng.Count -ge 1) -and ($audioPor.Count -ge 1)) "the window shows: $(Page-Text $app)"
    Check 'and both audio tracks are the file''s own, marked embedded' (
        ($audioEng[0].Current.Name -match 'embedded') -and
        ($audioPor[0].Current.Name -match 'embedded')) (
        "$($audioEng[0].Current.Name) | $($audioPor[0].Current.Name)")
    Check 'the file carries two embedded subtitle tracks, and both are listed' (
        ($subtitles.Count -ge 2) -and
        ($subtitles[0].Current.Name -match 'embedded') -and
        ($subtitles[1].Current.Name -match 'embedded')) "the window shows: $(Page-Text $app)"
    # Embedded first is the rule; every track here is embedded, so what shows is
    # that the file's own order survives — anything the Host added from an Addon
    # would come after these.
    Check 'and the tracks are listed in the file''s own order' (
        ((Button-At $app 'English stereo') -lt (Button-At $app 'Portuguese')) -and
        (($subtitles[0].Current.Name -match 'eng') -and ($subtitles[1].Current.Name -match 'por'))) (
        "audio: $((@($audioEng) + @($audioPor) | ForEach-Object { $_.Current.Name }) -join ' , ') | subtitles: $((@($subtitles) | ForEach-Object { $_.Current.Name }) -join ' , ')")
    Check 'the audio group says which track is on before anything is pressed' (
        (Toggled $audioEng[0]) -and -not (Toggled $audioPor[0])) (
        "English stereo is $(Toggled $audioEng[0]), Portuguese is $(Toggled $audioPor[0])")

    Press-Element $app $audioPor[0]
    Start-Sleep -Seconds 2
    $audioEng = Buttons-Matching $app 'English stereo'
    $audioPor = Buttons-Matching $app 'Portuguese'
    Check 'selecting the other audio track takes: its toggle is on and the first is off' (
        (Toggled $audioPor[0]) -and -not (Toggled $audioEng[0])) (
        "the window shows: $(Page-Text $app)")

    '--- 13b. subtitles on, then off'
    Press-Element $app (Buttons-Matching $app 'subrip')[0]
    Start-Sleep -Seconds 2
    Check 'choosing a subtitle track turns it on' (
        Toggled (Buttons-Matching $app 'subrip')[0]) "the window shows: $(Page-Text $app)"
    Press-Element $app (Button-Named $app 'Subtitles off')
    Start-Sleep -Seconds 2
    Check 'Subtitles off turns every subtitle track off' (
        Toggled (Button-Named $app 'Subtitles off')) "the window shows: $(Page-Text $app)"

    '--- 13c. the subtitle delay, stepped and reset'
    Check 'the delay readout starts at zero' (
        (Readout $app '0.0 s') -ne $null) "the window shows: $(Page-Text $app)"
    Press $app '+0.1 s'
    Check 'stepping the delay moves the readout to +0.1 s' (
        (Readout $app '+0.1 s') -ne $null) "the window shows: $(Page-Text $app)"
    Press $app 'Reset'
    Check 'resetting the delay moves the readout back to 0.0 s' (
        (Readout $app '0.0 s') -ne $null) "the window shows: $(Page-Text $app)"

    '--- 13d. the speed'
    $times = [char]0x00D7
    Check 'the speed group lists its rates' (
        (Button-Named $app ('1.5' + $times)) -ne $null) "the window shows: $(Page-Text $app)"
    Press-Element $app (Button-Named $app ('1.5' + $times))
    Start-Sleep -Seconds 1
    Check 'picking a speed presses that choice' (
        Toggled (Button-Named $app ('1.5' + $times))) "the window shows: $(Page-Text $app)"
    Press-Element $app (Button-Named $app ('1' + $times))
    Start-Sleep -Seconds 1
    Check 'and picking another moves the pressed choice' (
        (Toggled (Button-Named $app ('1' + $times))) -and
        -not (Toggled (Button-Named $app ('1.5' + $times)))) "the window shows: $(Page-Text $app)"

    '--- 13e. the volume, and mute'
    $before = [regex]::Match((Page-Text $app), '(\d+)%')
    $level = if ($before.Success) { [int]$before.Groups[1].Value } else { -1 }
    Focus-On $app 'Volume' ([Windows.Automation.ControlType]::Slider)
    if (-not (Focus $app)) { throw 'the keyboard steps need the Host in the foreground' }
    [Windows.Forms.SendKeys]::SendWait('{RIGHT}{RIGHT}{RIGHT}{RIGHT}{RIGHT}')
    Start-Sleep -Seconds 1
    $after = [regex]::Match((Page-Text $app), '(\d+)%')
    $moved = if ($after.Success) { [int]$after.Groups[1].Value } else { -1 }
    Check 'moving the volume moves its readout' (
        ($level -ge 0) -and ($moved -ne $level)) "the readout went $level% to $moved%"
    Press-Element $app (Button-Named $app 'Mute')
    Check 'muting flips the control to Unmute' (
        Shows $app 'Unmute' 10) "the window shows: $(Page-Text $app)"
    Check 'and the muted choice is the one toggled on' (
        Toggled (Button-Named $app 'Unmute')) "the window shows: $(Page-Text $app)"
    Press-Element $app (Button-Named $app 'Unmute')
    Check 'unmuting flips it back to Mute' (
        (Shows $app 'Mute' 10) -and -not (Shows $app 'Unmute' 2)) (
        "the window shows: $(Page-Text $app)")

    '--- 13f. the chapters, stepped and jumped to'
    $intro = Buttons-Matching $app 'Intro'
    $middle = Buttons-Matching $app 'Middle'
    Check 'the file carries two chapters, and both are listed' (
        ($intro.Count -ge 1) -and ($middle.Count -ge 1)) "the window shows: $(Page-Text $app)"
    Check 'the chapter playing is the one marked' (
        (Toggled $intro[0]) -and -not (Toggled $middle[0])) (
        "Intro is $(Toggled $intro[0]), Middle is $(Toggled $middle[0])")
    Press $app 'Next chapter'
    Start-Sleep -Seconds 1
    Check 'stepping to the next chapter moves the mark' (
        Toggled (Buttons-Matching $app 'Middle')[0]) "the window shows: $(Page-Text $app)"
    Press $app 'Previous chapter'
    Start-Sleep -Seconds 1
    Check 'stepping back moves it back' (
        Toggled (Buttons-Matching $app 'Intro')[0]) "the window shows: $(Page-Text $app)"
    Press-Element $app (Buttons-Matching $app 'Middle')[0]
    Start-Sleep -Seconds 1
    Check 'and a chapter can be jumped to by its own index' (
        Toggled (Buttons-Matching $app 'Middle')[0]) "the window shows: $(Page-Text $app)"

    '--- 13g. the crop, over a file that really has bars'
    # The bars are what make this visible: this file is 1280x540 of picture in a
    # 1280x720 frame. mpv's *own* stock autocrop has already cut them away by
    # now, which is why no crop choice of the menu is the one in force until the
    # Host is asked for one — that is mpv's script, not the Host cropping.
    'the letterboxed fixture is what makes the crop visible: 1280x540 of picture in a 1280x720 frame'
    $full = Button-Named $app 'Full frame'
    $ratios = Buttons-Named $app '4:3'
    Check 'the crop group offers the whole frame and the ratios' (
        ($full -ne $null) -and ($ratios.Count -ge 2)) "the window shows: $(Page-Text $app)"
    Shot $app '13-controls-crop-autocrop.png'
    'review 13-controls-crop-autocrop.png: the black bars should already be gone'
    Check 'the bars were already gone before the Host was asked to crop (mpv''s stock autocrop)' (
        (-not (Toggled $full)) -and (-not (Toggled $ratios[0]))) (
        "the window shows: $(Page-Text $app)")
    Press-Element $app $ratios[0]
    Start-Sleep -Seconds 2
    Check 'applying a crop takes: that ratio becomes the choice pressed' (
        Toggled (Buttons-Named $app '4:3')[0]) "the window shows: $(Page-Text $app)"
    Shot $app '13-controls-crop-applied.png'
    Press-Element $app (Button-Named $app 'Full frame')
    Start-Sleep -Seconds 2
    Check 'clearing the crop takes: the whole frame is the choice pressed' (
        Toggled (Button-Named $app 'Full frame')) "the window shows: $(Page-Text $app)"
    Check 'and the ratio is no longer pressed' (
        -not (Toggled (Buttons-Named $app '4:3')[0])) "the window shows: $(Page-Text $app)"

    '--- 13h. the aspect, set and returned to the source'
    Check 'the aspect group lists the source and the ratios' (
        ((Button-Named $app 'Source') -ne $null) -and
        ((Buttons-Named $app '4:3').Count -ge 2)) "the window shows: $(Page-Text $app)"
    Press-Element $app (Buttons-Named $app '4:3')[1]
    Start-Sleep -Seconds 2
    Check 'setting an aspect takes: that ratio is pressed and the source is not' (
        (Toggled (Buttons-Named $app '4:3')[1]) -and
        -not (Toggled (Button-Named $app 'Source'))) "the window shows: $(Page-Text $app)"
    Shot $app '13-controls-aspect.png'
    Press-Element $app (Button-Named $app 'Source')
    Start-Sleep -Seconds 2
    Check 'returning to the source takes: the source is pressed again' (
        Toggled (Button-Named $app 'Source')) "the window shows: $(Page-Text $app)"
    Check 'and the ratio is no longer pressed' (
        -not (Toggled (Buttons-Named $app '4:3')[1])) "the window shows: $(Page-Text $app)"

    '--- 13i. the statistics, and the decode they name'
    Press-Element $app (Button-Named $app 'Show statistics')
    $text = Wait-Text $app 'Hardware decode' 10
    Shot $app '13-controls-statistics.png'
    Check 'showing statistics draws a readout' (
        $text -match 'Hardware decode') "the window shows: $text"
    $decode = [regex]::Match($text, 'Hardware decode\s*\|\s*([^|]+)')
    $mode = if ($decode.Success) { $decode.Groups[1].Value.Trim() } else { '' }
    Check 'and it names a hardware decode mode, not "no" (a GPU that does the decode)' (
        ($mode -ne '') -and ($mode -ne 'no')) "the readout says Hardware decode | $mode"

    '--- 13j. the next episode, when an episode is what is playing'
    if (Shows $app 'Next episode' 5) {
        $before = Playing-Line $app
        Press $app 'Next episode'
        $after = $before
        $deadline = (Get-Date).AddSeconds(30)
        while (($after -eq $before) -and ((Get-Date) -lt $deadline)) {
            Start-Sleep -Milliseconds 500
            $after = Playing-Line $app
        }
        Shot $app '13-controls-next-episode.png'
        Check 'pressing Next episode plays the next one: the now-playing line changes' (
            ($after -ne '') -and ($after -ne $before)) "the line was '$before' and is '$after'"
        if ($after -match 'S\d+E(\d+)') {
            Check 'and it names a later episode' ([int]$Matches[1] -gt 1) "the line is '$after'"
        }
    } else {
        'what is playing is a film, so there is no Next episode to press'
    }
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
        Skip 'playback over a real Stream' (
            'the Addon answered no candidates at all: run with -Addon <an Addon that answers playable Streams>')
        return
    }

    $playable = @($candidates | Where-Object { $_.Current.Name -notmatch 'Not playable yet' })
    $chosen = if ($playable) { $playable[0] } else { $candidates[0] }
    "chose: $(Short $chosen.Current.Name)"
    # What the revision stands at on the list, so that the Snapshots playback
    # published can be counted once the client is back on it.
    $revision = ([regex]::Match((Page-Text $app), 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value
    Press-Element $app $chosen

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

    # The OSD offers the transport only once the picture is up: an open in
    # flight says so and offers Stop alone, so wait for the control that means
    # playback rather than for the word "Playing" (which the heading says either
    # way). mpv's child window does not exist until there is a picture to draw,
    # so the window checks belong after this and not before it.
    $playing = $false
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $playing -and (Get-Date) -lt $deadline) {
        $playing = Shows $app 'Pause' 2
    }
    Start-Sleep -Seconds 2
    Shot $app '12b-playing-controls.png'
    Check 'the picture is playing, and the OSD is over it with the controls' $playing (
        "the window shows neither Pause nor the transport: $(Page-Text $app)")
    if ($playing) {

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

        # What mpv is decoding with is in the Host's log: no Snapshot carried it
        # in #27, and #28's statistics are where a client reads it. A Stream
        # playing is the only moment it can be read at all.
        Start-Sleep -Seconds 1
        $decode = Select-String -Path $log -Pattern '"message":"the picture is playing"' |
            Select-Object -Last 1
        Check 'the Host logged what mpv is decoding with' (
            $decode -ne $null) 'no "the picture is playing" line in host.log'
        # The line is written when the picture comes up *and* whenever what mpv
        # decodes with changes — hardware decode engages a moment after the
        # picture appears — so the first line may honestly say `no`, and the one
        # that says `d3d11va` is the one to read.
        $engaged = Select-String -Path $log -Pattern '"message":"the picture is playing","hwdec":"(?!no")' |
            Select-Object -Last 1
        Check 'hardware decode is engaged (a line says so, not "no")' (
            $engaged -ne $null) "logged: $($decode.Line)"
        # What the frames' pixel format is is deliberately *not* asserted here:
        # with `vo=gpu-next` embedded by `wid`, this mpv does not answer
        # `video-params.pixelformat` at all (it reads `unknown`), so such a check
        # says nothing in either direction. That the picture is mpv's own output
        # and not a surface the Host made is what the child-window checks above
        # show; what it is decoded with is the line above this one.

        Press $app 'Stop'
        $text = Wait-Text $app ("Streams $dash") 20
        Shot $app '12c-stopped.png'
        Check 'stopping returns the client to the Stream list it chose from' (
            $text -match ("Streams $dash")) "showed: $text"
        $after = ([regex]::Match($text, 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value
        Check 'and playback published Snapshots of its own along the way' (
            ($revision -ne '') -and ($after -ne '') -and ([int]$after -gt [int]$revision)) (
            "the revision went '$revision' (on the list) to '$after' (after stopping)")
    } else {
        Skip 'the playback controls over a real Stream' (
            'the Stream never started playing, so there was no picture to control')
    }
}

# --- the fixtures the later steps stand on ------------------------------------
#
# A step run on its own must not stand on the leftovers of a previous run: the
# runner builds the ground the step declares first, and reuses it, so -Only 13
# means one Host, from the empty data directory, with the fixture Addon
# configured and its rows drawn - and not whatever an earlier run left behind.

# One Host, from the empty data directory the run begins with, placed on the
# chosen monitor. A Host that is still running is that Host and is not started
# twice; the one a previous step stopped is replaced, because the Host a step
# checks is the one the data directory makes.
function Ensure-FreshHost($ctx) {
    if ($ctx.App -and -not $ctx.App.Process.HasExited) { return }
    Start-Sleep -Milliseconds 500
    $ctx.App = Start-Host
    $ctx.Configured = $false
    $ctx.AtRows = $false
    $ctx.Revision = ''
}

# The named fixture: that Host with the Addon configured by its manifest URL and
# its catalogs drawn, so a later step can be run on its own at the rows. Two
# selected steps that need it share the one Host.
function Ensure-AddonHost($ctx) {
    Ensure-FreshHost $ctx
    $app = $ctx.App
    if (-not $ctx.Configured) {
        Type-Into $app 'Addon manifest URL' $Addon
        Press $app 'Add'
        Wait-Text $app ([regex]::Escape($AddonId)) 25 | Out-Null
        $ctx.Configured = $true
    }
    if (-not $ctx.AtRows) {
        # The same wait step 10 makes: a moment so the rows have certainly
        # started loading, then the wait for them to stop. The revision the
        # later steps measure against is read by the 'rows' ground, at the rows,
        # and taken fresh there because a step's playback or a restart moves it.
        Start-Sleep -Seconds 2
        Wait-No-Text $app 'Loading' 45 | Out-Null
        $ctx.AtRows = $true
    }
}

# Back to the rows, wherever a previous step left the client - inside a Title, or
# looking at search results - so a step that stands at the rows is really there.
# Back is the only movement that asks the Addon for nothing, and the rows are
# what it waits for. A step that tests Back itself (14, 18) declares no 'rows'
# ground and keeps its own press.
function Go-To-Rows($app) {
    for ($i = 0; $i -lt 4; $i++) {
        $text = Page-Text $app
        if ($text -notmatch 'Back to browsing') { return }
        Press-Keys $app '{ESC}'
        Start-Sleep -Milliseconds 500
    }
}

# --- the steps ----------------------------------------------------------------

function Step-1($ctx) {
    '--- 1. launching the Host opens a window'
    $app = Start-Host
    $ctx.App = $app
    Focus $app
    Start-Sleep -Seconds 2
    Shot $app '01-start.png'
    $text = Wait-Text $app 'Snapshot revision'
    Check 'the window shows a Snapshot revision' ($text -match 'Snapshot revision') "showed: $text"
    Check 'the snapshot it shows is revision 0' (
        $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"
    Check 'a fresh Host has no subtitle language preference' ($text -match 'none') "showed: $text"
}

function Step-2($ctx) {
    '--- 2. changing the preference goes through the Action surface'
    $app = $ctx.App
    Set-Language $app 'pt-BR'
    Shot $app '02-saved.png'
    $text = Wait-Text $app 'pt-BR'
    Check 'the window shows the new preference' (Shows $app 'pt-BR') "showed: $text"
    Check 'the window shows the new revision' (
        $text -match 'Snapshot revision\s*\|\s*1') "showed: $text"
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
    # A restarted Host starts its revision over, so the fixture's cached rows and
    # revision are no longer the ones a later step stands at.
    $ctx.AtRows = $false
    $ctx.Revision = ''
    Focus $restarted
    Start-Sleep -Seconds 2
    Shot $restarted '04-restarted.png'
    $text = Wait-Text $restarted 'pt-BR'
    Check 'the restarted Host still prefers pt-BR' (Shows $restarted 'pt-BR') "showed: $text"
    Check 'the restarted Host starts a fresh revision' (
        $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"
}

function Step-5($ctx) {
    '--- 5. a language that is not a tag is refused without touching state'
    $app = $ctx.App
    Set-Language $app 'Brazilian Portuguese'
    Shot $app '05-refused.png'
    $text = Wait-Text $app 'not a subtitle language tag'
    Check 'the window explains the refusal' (
        $text -match 'not a subtitle language tag') "showed: $text"
    Check 'the preference is untouched' (Shows $app 'pt-BR') "showed: $text"
    Check 'the refused Action did not move the revision' (
        $text -match 'Snapshot revision\s*\|\s*0') "showed: $text"
}

function Step-6($ctx) {
    '--- 6. clearing the preference'
    $app = $ctx.App
    Press $app 'Clear'
    Shot $app '06-cleared.png'
    $text = Wait-Text $app 'none'
    Check 'the window shows no preference' ($text -match 'none') "showed: $text"
    Check 'clearing it moved the revision on' (
        $text -match 'Snapshot revision\s*\|\s*1') "showed: $text"

    Stop-Host $app
}

function Step-7($ctx) {
    '--- 7. configuring an Addon by manifest URL'
    $app = Start-Host
    $ctx.App = $app
    Focus $app
    Start-Sleep -Seconds 2
    Shot $app '07-addons-empty.png'
    $text = Wait-Text $app 'No Addons are configured'
    Check 'a fresh Host has no Addons' ($text -match 'No Addons are configured') "showed: $text"

    Type-Into $app 'Addon manifest URL' $Addon
    Press $app 'Add'
    $text = Wait-Text $app ([regex]::Escape($AddonId)) 25
    $ctx.Configured = $true
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
}

function Step-8($ctx) {
    '--- 8. a URL that is not an Addon is refused without losing the Addon that works'
    $app = $ctx.App
    Type-Into $app 'Addon manifest URL' 'https://example.com/'
    Press $app 'Add'
    $text = Wait-Text $app "could not read that Addon's manifest" 25
    Shot $app '09-addon-refused.png'
    Check 'the refusal is explained' ($text -match "could not read that Addon's manifest") "showed: $text"
    Check 'the Addon that was working is still listed' (
        $text -match [regex]::Escape($AddonId)) "showed: $text"
}

function Step-9($ctx) {
    '--- 9. the Addon survives a restart'
    $app = $ctx.App
    Stop-Host $app
    $app = Start-Host
    $ctx.App = $app
    # A restarted Host starts its revision over, so the fixture's cached rows and
    # revision are no longer the ones a later step stands at.
    $ctx.AtRows = $false
    $ctx.Revision = ''
    Focus $app
    Start-Sleep -Seconds 2
    Shot $app '10-addon-restarted.png'
    $text = Wait-Text $app ([regex]::Escape($AddonId)) 25
    Check 'the restarted Host still has the Addon' (
        $text -match [regex]::Escape($AddonId)) "showed: $text"
}

function Step-10($ctx) {
    '--- 10. the home surface draws a row for each catalog the Addon offers'
    $app = $ctx.App
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
    $ctx.Revision = $revision
    $ctx.AtRows = $true
}

function Step-11($ctx) {
    '--- 11. the keyboard reaches a card, and OK opens the Title'
    $app = $ctx.App
    $revision = $ctx.Revision
    # The Title surface is the way back, the metadata line naming the Addon that
    # answered, and — for a series — its seasons and episodes. Nothing above this is
    # a Title: which one a client has open is that client's own (ADR-0005), so the
    # rows are still what is showing and the revision has not moved.
    $text = Page-Text $app
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
    'the series case — seasons, episodes, and choosing one — is step 15.'
    $ctx.Series = $series
    $ctx.NoEpisodes = $noEpisodes
}

function Step-12($ctx) {
    '--- 12. pressing a Video asks the Addons for its Streams'
    $app = $ctx.App
    $series = $ctx.Series
    $noEpisodes = $ctx.NoEpisodes
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
}

function Step-13($ctx) {
    '--- 13. the full control set, over a real file'
    $app = $ctx.App
    # Every control the window has is walked here, over the fixture: its own file
    # carries two audio tracks, two embedded subtitle tracks, two chapters and black
    # bars, which is what each control needs something to move. It is an *episode*
    # that is played rather than the film, so that `Next episode` is offered too — a
    # film has no next one, and walking the menu on a film would leave that control
    # unreached. The fixture's series is the second row (where Cinemeta, the default
    # Addon, puts its own), and the client is on a Title at this point, so first it
    # goes back to the rows.
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
    $series = Series-Card $app
    if (-not $series) {
        Skip 'the full control set' (
            "this Addon drew no second row, so there is no series to play: run with -AddonName Verify (or -Addon <a Series Addon>) to walk the control menu")
        # Open a Title anyway, so the step below finds the surface it expects.
        Focus-On $app 'Search the Addons that offer it' ([Windows.Automation.ControlType]::Edit)
        Press-Keys $app '{DOWN}{DOWN}'
        Press-Keys $app '{ENTER}'
        Wait-Text $app 'Back to browsing' 15 | Out-Null
    } else {
        $series.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        $text = Wait-Text $app 'Back to browsing' 15
        Check 'the series opens for the control walk' (
            $text -match 'Season \d+') "showed: $text"
        Focus-On $app 'Back to browsing' ([Windows.Automation.ControlType]::Button)
        Press-Keys $app '{DOWN}'
        Press-Keys $app '{ENTER}'
        $text = Wait-Text $app ("Streams $dash") 20
        Shot $app '13-streams.png'
        Check 'pressing the episode asks for its Streams' (
            $text -match ("Streams $dash")) "showed: $text"
        if ($text -match 'No configured Addon offers Streams') {
            Skip 'the full control set' (
                'the configured Addon answers no `stream` resource, so there is nothing to play')
            Press-Keys $app '{ESC}'
            Wait-Text $app 'Season \d+' 15 | Out-Null
        } else {
            $candidates = Candidates $app
            $playable = @($candidates | Where-Object { $_.Current.Name -notmatch 'Not playable yet' })
            if (-not $playable) {
                Skip 'the full control set' (
                    'the Addon answered no playable candidate, so the menu cannot be walked')
                Press-Keys $app '{ESC}'
                Wait-Text $app 'Season \d+' 15 | Out-Null
            } else {
                Press-Element $app $playable[0]
                $text = Wait-Text $app 'Playing ' 30
                Check 'choosing the candidate starts the episode' (
                    $text -match 'Playing ') "showed: $text"
                # The controls are live once the picture is up, not while the open is
                # still in flight: the transport's Pause is what says so.
                $playing = $false
                $deadline = (Get-Date).AddSeconds(45)
                while (-not $playing -and (Get-Date) -lt $deadline) {
                    $playing = Shows $app 'Pause' 2
                }
                Check 'the episode is playing, so its controls are live' $playing (
                    "the window shows: $(Page-Text $app)")
                if ($playing) {
                    # A moment for mpv's stock autocrop, which fires about five
                    # seconds after the file loads, so the crop step sees the bars
                    # already gone rather than being the thing that removes them.
                    Start-Sleep -Seconds 4
                    Walk-Controls $app
                    Press $app 'Stop'
                }
                $text = Wait-Text $app ("Streams $dash") 20
                Check 'stopping leaves the menu and the Stream list is back' (
                    $text -match ("Streams $dash")) "showed: $text"
                Press-Keys $app '{ESC}'
                $text = Wait-Text $app 'Season \d+' 15
                Check 'Back leaves the Streams for the episode list' (
                    $text -match 'Season \d+') "showed: $text"
            }
        }
    }
}

function Step-14($ctx) {
    '--- 14. Back leaves the Title, and the same Title opens again'
    $app = $ctx.App
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
    Shot $app '14-title-back.png'
    Check 'Back returns to the rows' (
        $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
    Check 'and the Title surface is gone' (
        $text -notmatch 'Back to browsing') "showed: $text"
    # The control walk just published Snapshots of its own, so the revision the
    # questions below are measured against is taken fresh here rather than from
    # before playback.
    $revision = ([regex]::Match($text, 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value
    $ctx.Revision = $revision

    Focus-On $app 'Search the Addons that offer it' ([Windows.Automation.ControlType]::Edit)
    Press-Keys $app '{DOWN}{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app 'Back to browsing' 15
    Shot $app '14-title-reopened.png'
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
}

function Step-15($ctx) {
    '--- 15. a series'' seasons and episodes, and choosing one'
    $app = $ctx.App
    # A series without the keyboard having to know how many cards the first row
    # holds: `More from …` closes a row, so the button after the first one of those
    # is the first card of the second row — which, for the Addon this walkthrough
    # runs against by default, is its series catalog.
    $series = Series-Card $app

    if ($series) {
        $series.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        $text = Wait-Text $app 'Back to browsing' 15
        Shot $app '15-series-opened.png'
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
        Shot $app '15-series-streams.png'
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
}

function Step-16($ctx) {
    '--- 16. paging a row is not a change: the revision stands still'
    $app = $ctx.App
    $revision = $ctx.Revision
    $more = Find-Element (Window-Root $app) ('More from ' + $AddonCatalog) ([Windows.Automation.ControlType]::Button) 10
    if ($more) {
        $more.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
        Start-Sleep -Seconds 3
        $text = Wait-No-Text $app 'Loading' 30
        Shot $app '16-paged.png'
        Check 'the row paged on without emptying' (
            $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
        Check 'paging is a question, not a change: the revision stands still' (
            $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"
    } else {
        Check 'the Addon catalog offers a way to page on' $false 'no More button'
    }
}

function Step-17($ctx) {
    '--- 17. searching asks every Addon that offers it'
    $app = $ctx.App
    $revision = $ctx.Revision
    Set-Search $app $SearchQuery
    $text = Wait-Text $app 'Back to browsing' 30
    Shot $app '17-search.png'
    Check 'the search surface is showing' (
        $text -match 'Back to browsing') "showed: $text"
    Check 'the search did not move the revision either' (
        $text -match ('Snapshot revision\s*\|\s*' + $revision)) "showed: $text"
    'review 17-search.png: the results should be a row of posters, or a clear "no Addon answered"'
}

function Step-18($ctx) {
    '--- 18. Back returns to browsing, from the keyboard'
    $app = $ctx.App
    $revision = $ctx.Revision
    # Escape is Back, so the whole of "arrows, OK and Back" is walked without the
    # mouse at least once (the mouse still works everywhere else in this run).
    Press-Keys $app '{ESC}'
    $text = Wait-Text $app ([regex]::Escape($AddonCatalog)) 25
    Shot $app '18-back.png'
    Check 'Back returns to the rows' (
        $text -match [regex]::Escape($AddonCatalog)) "showed: $text"
    Check 'and the search surface is gone' (
        $text -notmatch 'Back to browsing') "showed: $text"
}

function Step-19($ctx) {
    '--- 19. the TMDB key: entered, held, cleared, and where it lives'
    $app = $ctx.App
    # The value the walkthrough enters is its own and it takes it out again before
    # the step ends: the point is the round trip, not a credential. A key an earlier
    # run left behind — a crash between the save and the clear — is cleared first,
    # because the OS keyring is not part of the data-directory wipe at the top.
    $testKey = '0123456789abcdef'
    Press $app 'Clear key'
    $text = Wait-Text $app 'No TMDB key is held' 15
    Shot $app '19-tmdb-key-none.png'
    Check 'a Host with no key says so' (
        $text -match 'No TMDB key is held') "showed: $text"
    Check 'the window says which backend would hold a key' (
        ($text -match 'keyring') -or ($text -match '0600')) "showed: $text"
    $before = ([regex]::Match($text, 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value

    Set-TmdbKey $app $testKey
    Press $app 'Save key'
    $text = Wait-Text $app 'A TMDB key is held' 15
    Shot $app '19-tmdb-key-saved.png'
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
    Shot $app '19-tmdb-key-refused.png'
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
    Shot $app '19-tmdb-key-cleared.png'
    Check 'clearing the key says no key is held' (
        $text -match 'No TMDB key is held') "showed: $text"
    Check 'and clearing moved the revision on again' (
        $text -match ('Snapshot revision\s*\|\s*' + ([int]$before + 2))) "showed: $text"
    $ctx.TestKey = $testKey
}

function Step-20($ctx) {
    '--- 20. removing the Addon'
    $app = $ctx.App
    Press $app ('Remove ' + $AddonName)
    $text = Wait-Text $app 'No Addons are configured' 20
    Shot $app '20-addon-removed.png'
    Check 'the Addon is gone' ($text -match 'No Addons are configured') "showed: $text"
    # The rows are the Addon's own catalog headings, and they go with it. The
    # match is case-*sensitive* on purpose: a library entry whose Addon is gone
    # stays on the home surface, marked unplayable, and it names that Addon
    # (`Unplayable - the Addon dev.streamingapp.verify ...`, #29) — the lowercase
    # id inside it is not a row heading, and a case-insensitive `-match` would
    # read it as one. The pager goes with the row too.
    Check 'and its rows are gone with it' (
        (-not ($text -cmatch [regex]::Escape($AddonCatalog))) -and
        (-not ($text -match ('More from ' + [regex]::Escape($AddonCatalog))))) "showed: $text"

    Stop-Host $app
}

function Step-21($ctx) {
    '--- 21. the manifest URL and the TMDB key never reach the log'
    $testKey = $ctx.TestKey
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
    $series = Series-Card $app
    if (-not $series) {
        Skip 'Watch progress outlives a killed Host' (
            "this Addon drew no second row, so there is no series to watch: run with -AddonName Verify (or -Addon <a Series Addon>)")
        return
    }

    $series.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $text = Wait-Text $app 'Back to browsing' 15
    Focus-On $app 'Back to browsing' ([Windows.Automation.ControlType]::Button)
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app ("Streams $dash") 20
    if ($text -match 'No configured Addon offers Streams') {
        Skip 'Watch progress outlives a killed Host' (
            'the configured Addon answers no `stream` resource, so nothing can be watched')
        return
    }
    $playable = @(Candidates $app | Where-Object { $_.Current.Name -notmatch 'Not playable yet' })
    if (-not $playable) {
        Skip 'Watch progress outlives a killed Host' (
            'the Addon answered no playable candidate, so nothing can be watched')
        return
    }

    Press-Element $app $playable[0]
    $playing = $false
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $playing -and (Get-Date) -lt $deadline) { $playing = Shows $app 'Pause' 2 }
    if (-not $playing) {
        Skip 'Watch progress outlives a killed Host' (
            'the Stream never started playing, so there was no position to record')
        return
    }

    # Watch a little of it: a seek is a position the Host writes down at once, and
    # the OSD's clock is where a person reads it.
    Press $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    Press $app 'Forward ten seconds'
    Start-Sleep -Seconds 2
    $watched = Clock-Seconds $app
    Check 'playback is where the seeks left it, not at the beginning' (
        $watched -gt 5) "the clock reads $watched s"
    Shot $app '23-watching.png'

    # The Host is *killed*, not closed: an unclean exit is the case the criterion
    # is written against, and a clean close would let it flush on the way out.
    'killing the Host rather than closing it, so nothing is given a chance to flush on the way out'
    Stop-Process -Id $app.Process.Id -Force
    Start-Sleep -Seconds 2

    $ctx.App = Start-Host
    $app = $ctx.App
    $text = Wait-Text $app 'Continue watching' 60
    Shot $app '23-after-restart.png'
    Check 'the restarted Host offers the Video it was on, in the Continue watching row' (
        $text -match 'Continue watching') "showed: $text"

    # The card's own words are the Title, the episode and what is left — the note
    # `m:ss left` is what tells a partly-watched card apart from the rest of the
    # row without spelling the whole accessible name.
    $cards = @(Buttons-Matching $app ' left')
    if ($cards.Count -eq 0) {
        Skip 'resuming from the Continue watching row' (
            "the row drew no partly-watched card: showed $text")
        return
    }
    Press-Element $app $cards[0]
    $playing = $false
    $deadline = (Get-Date).AddSeconds(45)
    while (-not $playing -and (Get-Date) -lt $deadline) { $playing = Shows $app 'Pause' 2 }
    Shot $app '23-resumed.png'
    Check 'pressing the card plays the Video again' $playing "showed: $(Page-Text $app)"
    if ($playing) {
        $resumed = Clock-Seconds $app
        Check 'and it resumes where it was left rather than at the beginning' (
            ($resumed -ge 0) -and ($resumed -ge ($watched - 15))) (
            "it was left at $watched s and resumed at $resumed s")
        Press $app 'Stop'
        Wait-Text $app 'Continue watching' 20 | Out-Null
    }
}

# --- the dispatcher -----------------------------------------------------------
#
# The data directory is emptied once, before any Host opens, so "the preference
# survives a restart" and "a fresh Host has no Addons" are really being tested.
Remove-Item $log -ErrorAction SilentlyContinue
Remove-Item (Join-Path $dataDir 'host.sqlite3*') -ErrorAction SilentlyContinue

$ctx = @{
    App = $null
    Configured = $false
    AtRows = $false
    Revision = ''
    Series = $false
    NoEpisodes = $false
    TestKey = ''
}

foreach ($id in $selected) {
    $step = $byId[$id]
    if ($step.Ground -eq 'data') { New-Item -ItemType Directory -Force $dataDir | Out-Null }
    elseif ($step.Ground -eq 'fresh') { Ensure-FreshHost $ctx }
    elseif ($step.Ground -eq 'rows') {
        Ensure-AddonHost $ctx
        Go-To-Rows $ctx.App
        # The revision the step measures against is the one at the rows, read
        # here rather than carried over: playback and a restart both move it.
        $ctx.Revision = ([regex]::Match((Page-Text $ctx.App), 'Snapshot revision\s*\|\s*(\d+)')).Groups[1].Value
    }
    elseif ($step.Ground -eq 'addon') { Ensure-AddonHost $ctx }
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
