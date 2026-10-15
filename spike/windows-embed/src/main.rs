// Spike for ticket #3 — Windows only.
//
// Question: can libmpv render into a CHILD window inside our Tauri window
// (`wid`), with a transparent, click-through webview drawing our UI above it,
// while mpv keeps ownership of its swapchain (the thing that preserves HDR)?
//
// Everything this spike observes is written to spike.log, because the point is
// to produce evidence, not a demo. Two facts are self-verifying in the log:
//   - embedding: the mpv child window found under our HWND, with its class name
//   - click-through: clicks that arrive at the webview from over the video area
//
// Deliberate spike-level shortcuts, none of which affect the answer:
//   - libmpv is loaded at runtime (libloading) instead of linking libmpv2
//   - properties are polled instead of using observe_property
//   - the boxed Library is leaked so the fn pointers stay valid

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::ffi::{c_char, c_int, c_void, CString};
use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use std::time::Duration;

// Needed for AppHandle::state (Tauri's Manager trait).
use tauri::Manager;

#[cfg(windows)]
use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM, RECT, TRUE};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, FindWindowW, GetClassNameW, GetClientRect, GetWindowLongPtrW,
    SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_BOTTOM, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    WS_EX_TRANSPARENT,
};

const LOG_PATH: &str = r"C:\Users\menot\streamingapp-spike\spike.log";
const DEFAULT_CLIP: &str = r"C:\Users\menot\streamingapp-spike\4k60.mp4";
const WINDOW_TITLE: &str = "spike-embed";

fn log(msg: &str) {
    let line = format!("[spike] {msg}\n");
    print!("{line}");
    let _ = std::io::stdout().flush();
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(LOG_PATH) {
        let _ = f.write_all(line.as_bytes());
    }
}

// ---------------------------------------------------------------- libmpv FFI

type MpvHandle = *mut c_void;

struct Mpv {
    handle: MpvHandle,
    command: unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int,
    get_property_string: unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char,
    mpv_free: unsafe extern "C" fn(*mut c_void),
}

unsafe impl Send for Mpv {}

fn cstr(s: &str) -> CString {
    CString::new(s).unwrap_or_else(|_| CString::new("").unwrap())
}

/// Load the DLL and start playback embedded in `hwnd`.
unsafe fn mpv_start(hwnd: isize, file: &str) -> Result<Mpv, String> {
    let lib: &'static libloading::Library = Box::leak(Box::new(
        libloading::Library::new("libmpv-2.dll").map_err(|e| format!("load libmpv-2.dll: {e}"))?,
    ));

    let create: libloading::Symbol<unsafe extern "C" fn() -> MpvHandle> =
        lib.get(b"mpv_create\0").map_err(|e| e.to_string())?;
    let set_option: libloading::Symbol<
        unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    > = lib.get(b"mpv_set_option_string\0").map_err(|e| e.to_string())?;
    let initialize: libloading::Symbol<unsafe extern "C" fn(MpvHandle) -> c_int> =
        lib.get(b"mpv_initialize\0").map_err(|e| e.to_string())?;
    let command = *lib
        .get::<unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int>(b"mpv_command\0")
        .map_err(|e| e.to_string())?;
    let get_property_string = *lib
        .get::<unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char>(
            b"mpv_get_property_string\0",
        )
        .map_err(|e| e.to_string())?;
    let mpv_free = *lib
        .get::<unsafe extern "C" fn(*mut c_void)>(b"mpv_free\0")
        .map_err(|e| e.to_string())?;

    let handle = create();
    if handle.is_null() {
        return Err("mpv_create returned null".into());
    }

    // mpv owns its window/swapchain inside OUR window: this is the whole point.
    let options: [(&str, String); 8] = [
        ("wid", hwnd.to_string()),
        ("vo", "gpu-next".into()),
        ("gpu-api", "d3d11".into()),
        ("gpu-context", "d3d11".into()),
        ("hwdec", "auto-safe".into()),
        ("target-colorspace-hint", "yes".into()),
        ("keep-open", "yes".into()),
        ("terminal", "no".into()),
    ];
    for (k, v) in options {
        let rc = set_option(handle, cstr(k).as_ptr(), cstr(&v).as_ptr());
        log(&format!("option {k}={v} -> {rc}"));
        if rc < 0 {
            return Err(format!("mpv_set_option_string({k}) failed"));
        }
    }

    if initialize(handle) < 0 {
        return Err("mpv_initialize failed".into());
    }
    log("mpv initialized");

    // argv-style command, so no quoting surprises with Windows paths.
    let args = [cstr("loadfile"), cstr(file)];
    let argv: Vec<*const c_char> = args
        .iter()
        .map(|a| a.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect();
    let rc = command(handle, argv.as_ptr());
    log(&format!("loadfile {file} -> {rc}"));

    Ok(Mpv {
        handle,
        command,
        get_property_string,
        mpv_free,
    })
}

impl Mpv {
    fn prop(&self, name: &str) -> String {
        unsafe {
            let p = (self.get_property_string)(self.handle, cstr(name).as_ptr());
            if p.is_null() {
                return "<null>".into();
            }
            let s = std::ffi::CStr::from_ptr(p).to_string_lossy().into_owned();
            (self.mpv_free)(p as *mut c_void);
            s
        }
    }
}

// ---------------------------------------------------------------- Win32 glue

#[cfg(windows)]
struct ChildSearch {
    found: Option<(HWND, String)>,
}

#[cfg(windows)]
unsafe extern "system" fn enum_child(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam as *mut ChildSearch);
    let mut buf = [0u16; 256];
    let n = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as c_int);
    let class = if n > 0 {
        String::from_utf16_lossy(&buf[..n as usize])
    } else {
        String::new()
    };
    // mpv names its child window "mpv" (sometimes with a suffix).
    if class == "mpv" || class.starts_with("mpv") {
        search.found = Some((hwnd, class));
        return 0; // stop enumerating
    }
    TRUE
}

/// Find mpv's child window under our HWND and put it behind the webview.
#[cfg(windows)]
unsafe fn adopt_mpv_child(parent: HWND) {
    // mpv creates the child during initialize/loadfile; poll rather than sleep-guess.
    let mut found: Option<(HWND, String)> = None;
    for attempt in 0..40 {
        let mut search = ChildSearch { found: None };
        EnumChildWindows(parent, Some(enum_child), &mut search as *mut _ as LPARAM);
        if let Some(hit) = search.found {
            log(&format!(
                "found mpv child window class='{}' hwnd={:p} (attempt {attempt})",
                hit.1, hit.0
            ));
            found = Some(hit);
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }

    let Some((child, _class)) = found else {
        log("NO mpv child window found after 10s — embedding did not happen");
        return;
    };

    let mut rect = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    GetClientRect(parent, &mut rect);
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    SetWindowPos(
        child,
        HWND_BOTTOM,
        0,
        0,
        w,
        h,
        SWP_NOACTIVATE | SWP_SHOWWINDOW,
    );
    let ex = GetWindowLongPtrW(child, GWL_EXSTYLE);
    let new_ex = (ex as u32 | WS_EX_TRANSPARENT) as isize;
    SetWindowLongPtrW(child, GWL_EXSTYLE, new_ex);
    log(&format!(
        "child repositioned to {w}x{h}, HWND_BOTTOM, WS_EX_TRANSPARENT added (ex {ex:#x} -> {new_ex:#x})"
    ));
}

// ------------------------------------------------------------------ commands

#[derive(Default)]
struct SpikeState {
    mpv: Mutex<Option<Mpv>>,
}

#[tauri::command]
fn log_click(name: String) -> String {
    log(&format!("WEBVIEW GOT CLICK: {name}"));
    format!("logged {name}")
}

/// Drive mpv from the webview, so the spike also proves the overlay UI can
/// control playback (the "full parity" requirement) rather than just be drawn.
#[tauri::command]
fn mpv_cmd(state: tauri::State<'_, SpikeState>, args: Vec<String>) -> String {
    let guard = state.mpv.lock().unwrap();
    let Some(mpv) = guard.as_ref() else {
        return "mpv not started".into();
    };
    let owned: Vec<CString> = args.iter().map(|a| cstr(a)).collect();
    let mut argv: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
    argv.push(std::ptr::null());
    let rc = unsafe { (mpv.command)(mpv.handle, argv.as_ptr()) };
    log(&format!("COMMAND {args:?} -> rc={rc}"));
    format!("rc={rc}")
}

#[tauri::command]
fn mpv_props(state: tauri::State<'_, SpikeState>) -> String {
    let guard = state.mpv.lock().unwrap();
    let Some(mpv) = guard.as_ref() else {
        return r#"{"error":"mpv not started"}"#.into();
    };
    let names = [
        "hwdec-current",
        "vo-configured",
        "video-params",
        "width",
        "height",
        "display-fps",
        "estimated-vf-fps",
        "frame-drop-count",
        "decoder-frame-drop-count",
        "video-bitrate",
        "target-colorspace-hint",
        "video-crop",
    ];
    let map: serde_json::Map<String, serde_json::Value> = names
        .iter()
        .map(|n| ((*n).to_string(), serde_json::Value::String(mpv.prop(n))))
        .collect();
    serde_json::Value::Object(map).to_string()
}

fn main() {
    tauri::Builder::default()
        .manage(SpikeState::default())
        .invoke_handler(tauri::generate_handler![log_click, mpv_props, mpv_cmd])
        .setup(|app| {
            log("--- spike starting ---");
            let clip = std::env::args().nth(1).unwrap_or_else(|| DEFAULT_CLIP.into());
            let app_handle = app.handle().clone();

            #[cfg(windows)]
            std::thread::spawn(move || unsafe {
                // Our own HWND by title: avoids depending on Tauri's internal
                // window accessors, which differ between versions.
                let title: Vec<u16> = WINDOW_TITLE
                    .encode_utf16()
                    .chain(std::iter::once(0))
                    .collect();
                let mut parent: HWND = std::ptr::null_mut();
                for _ in 0..40 {
                    parent = FindWindowW(std::ptr::null(), title.as_ptr());
                    if !parent.is_null() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                if parent.is_null() {
                    log("could not find our own window by title — giving up");
                    return;
                }
                log(&format!("our window hwnd={parent:p} title={WINDOW_TITLE:?}"));

                match mpv_start(parent as isize, &clip) {
                    Ok(mpv) => {
                        log("libmpv started; waiting for its child window");
                        let state = app_handle.state::<SpikeState>();
                        *state.mpv.lock().unwrap() = Some(mpv);
                        adopt_mpv_child(parent);

                        // Poll properties so the log carries playback facts.
                        for tick in 0..20 {
                            std::thread::sleep(Duration::from_millis(1000));
                            let guard = state.mpv.lock().unwrap();
                            if let Some(mpv) = guard.as_ref() {
                                log(&format!(
                                    "t={tick}s hwdec={} vo-configured={} size={}x{} video-params={} drops={} display-fps={}",
                                    mpv.prop("hwdec-current"),
                                    mpv.prop("vo-configured"),
                                    mpv.prop("width"),
                                    mpv.prop("height"),
                                    mpv.prop("video-params"),
                                    mpv.prop("frame-drop-count"),
                                    mpv.prop("display-fps"),
                                ));
                            }
                        }
                        log("--- observation window over ---");
                    }
                    Err(e) => log(&format!("libmpv start FAILED: {e}")),
                }
            });

            #[cfg(not(windows))]
            let _ = (&app, &clip);

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
