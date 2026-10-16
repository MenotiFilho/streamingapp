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
'the series case — seasons, episodes, and choosing one — is step 14.'

'--- 12. a series'' episodes are selectable'
if ($series) {
    # The Title's way back is its first focusable, so one press down lands on the
    # first episode and OK chooses it. Nothing plays yet (#26/#27): the window
    # says which episode this client has chosen.
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app 'choosing a Stream arrives in' 10
    Shot $app '12-episode-chosen.png'
    Check 'an episode can be chosen, and the window says which' (
        ($text -match 'Selected ') -and
        ($text -match 'choosing a Stream arrives in')) "showed: $text"
} else {
    'the Title opened was a film, so there is no episode to choose here'
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
    # first episode and OK chooses it. Nothing plays yet (#26/#27): the window
    # says which episode this client has chosen.
    Focus-On $app 'Back to browsing' ([Windows.Automation.ControlType]::Button)
    Press-Keys $app '{DOWN}'
    Press-Keys $app '{ENTER}'
    $text = Wait-Text $app 'choosing a Stream arrives in' 10
    Shot $app '14-series-episode.png'
    Check 'an episode can be chosen, and the window says which' (
        ($text -match 'Selected ') -and
        ($text -match 'choosing a Stream arrives in')) "showed: $text"
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

'--- 18. removing the Addon'
Press $app ('Remove ' + $AddonName)
$text = Wait-Text $app 'No Addons are configured' 20
Shot $app '18-addon-removed.png'
Check 'the Addon is gone' ($text -match 'No Addons are configured') "showed: $text"
Check 'and its rows are gone with it' (
    -not ($text -match [regex]::Escape($AddonCatalog))) "showed: $text"

Stop-Host $app

'--- 19. the manifest URL never reaches the log'
# A manifest URL can carry a debrid configuration inside it, so the Host must
# never write one down — and the route that matters is the real one, with the
# Addon the owner actually uses.
$urlPath = ([System.Uri]$Addon).AbsolutePath
Check 'the log never holds the manifest URL' (
    (Test-Path $log) -and
    -not (Select-String -Path $log -SimpleMatch $Addon -Quiet)) 'host.log holds the manifest URL'
Check 'the log never holds the manifest path either' (
    (Test-Path $log) -and
    -not (Select-String -Path $log -SimpleMatch $urlPath -Quiet)) 'host.log holds the manifest path'

'--- 20. the data directory'
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
