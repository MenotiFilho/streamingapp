//! The Windows half of putting the picture in the Host's window.
//!
//! mpv is handed the Host window's handle as its `wid` and creates a child
//! window of ours when the video output starts. Two things about that child are
//! ours to fix, and neither has a safe wrapper in the `windows` crate — which is
//! why this module, alone in the app shell, allows `unsafe`:
//!
//! - It is created *on top* of the webview, so until it is pushed to the bottom
//!   of the z-order the picture covers the interface. It is pushed down as soon
//!   as it appears, and it is given `WS_EX_TRANSPARENT` *and* answers
//!   `WM_NCHITTEST` with `HTTRANSPARENT` so that even while it is on top, a
//!   click passes through to the interface rather than stopping at the video.
//! - It is the size mpv made it, not the size of the window. It is kept the size
//!   of the window's client area, so that a resize does not leave the picture
//!   in a corner of the window or a strip of desktop showing.
//!
//! The prototype branch proved this shape on this machine
//! (`docs/research/spike-windows-embedding.md`, ticket #3).

#![allow(unsafe_code)]

use std::thread;
use std::time::Duration;

use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetClassNameW, GetClientRect, GetWindowLongPtrW, IsWindow, SetWindowLongPtrW,
    SetWindowPos, GWL_EXSTYLE, HTTRANSPARENT, HWND_BOTTOM, SWP_NOACTIVATE, SWP_SHOWWINDOW,
    WM_NCHITTEST, WS_EX_TRANSPARENT,
};

/// How often the child window is looked for, and re-measured once it is found.
///
/// mpv creates its child when the video output starts — the first Stream, not
/// the Host's launch — and keeps it for the Host's life once `force-window` is
/// on (#250), so this is the difference between a picture that appears at once
/// and one that appears a quarter of a second later. Nothing here is on the
/// path of a frame: mpv draws in its own thread.
const WATCH: Duration = Duration::from_millis(250);

/// The subclass id the child window is tagged with, so that setting it twice is
/// setting it once.
const SUBCLASS: usize = 0x5354_5245; // "STRE"

/// Watch for mpv's child window under the Host's, adopt it, and keep it the size
/// of the window from then on.
///
/// Runs on a thread of its own for as long as the Host does: the first moment
/// the child exists is mpv's own, and the window's own size is only knowable
/// from the window. The handle travels as a number because a raw window handle
/// is not `Send`; the thread makes its own.
pub fn adopt(handle: i64) {
    thread::spawn(move || {
        let host = HWND(handle as *mut core::ffi::c_void);
        let mut picture: Option<HWND> = None;

        loop {
            match picture {
                Some(child) if unsafe { IsWindow(Some(child)).as_bool() } => {
                    unsafe { place(child, host) };
                }
                // The child is gone: mpv let the Stream go, and the next one
                // makes a new child to adopt.
                Some(_) => picture = None,
                None => picture = unsafe { find(host) },
            }

            thread::sleep(WATCH);
        }
    });
}

/// The child window of `host` whose class is mpv's, where there is one.
unsafe fn find(host: HWND) -> Option<HWND> {
    let mut found: Option<HWND> = None;

    unsafe {
        let _ = EnumChildWindows(
            Some(host),
            Some(named),
            LPARAM((&mut found as *mut Option<HWND>) as isize),
        );
    }

    unsafe extern "system" fn named(child: HWND, state: LPARAM) -> windows::core::BOOL {
        let mut class = [0u16; 64];
        let length = unsafe { GetClassNameW(child, &mut class) };
        let name = String::from_utf16_lossy(&class[..length.max(0) as usize]);

        // mpv's window class is `mpv` on mpv 0.41, and has been `mpv` plus a
        // suffix in some builds; anything else under this window is Tauri's own.
        if name.starts_with("mpv") {
            unsafe { *(state.0 as *mut Option<HWND>) = Some(child) };
            return windows::core::BOOL(0);
        }

        windows::core::BOOL(1)
    }

    found
}

/// Put the picture behind the interface, make it click-through, and give it the
/// size of the window it is in.
unsafe fn place(child: HWND, host: HWND) {
    unsafe {
        let mut client = windows::Win32::Foundation::RECT::default();
        if GetClientRect(host, &mut client).is_err() {
            return;
        }
        let width = client.right - client.left;
        let height = client.bottom - client.top;

        let _ = SetWindowPos(
            child,
            Some(HWND_BOTTOM),
            0,
            0,
            width,
            height,
            SWP_NOACTIVATE | SWP_SHOWWINDOW,
        );

        // A click that lands on the picture is a click the interface never sees,
        // so the child is made transparent to input: `WS_EX_TRANSPARENT` for the
        // painting order and `HTTRANSPARENT` for the hit test itself.
        let style = GetWindowLongPtrW(child, GWL_EXSTYLE);
        let _ = SetWindowLongPtrW(child, GWL_EXSTYLE, style | WS_EX_TRANSPARENT.0 as isize);
        let _ = SetWindowSubclass(child, Some(hit_test), SUBCLASS, 0);
    }
}

/// Answer every hit test with `HTTRANSPARENT`, so that the window beneath — the
/// interface — is what a click lands on.
unsafe extern "system" fn hit_test(
    child: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if message == WM_NCHITTEST {
        return LRESULT(HTTRANSPARENT as isize);
    }

    unsafe { DefSubclassProc(child, message, wparam, lparam) }
}
