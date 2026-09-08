// Recall — Windows shell.
//
// The Rust side owns everything the web layer cannot do for itself: window
// behaviour, the tray, the global hotkey, autostart, and the loopback listener
// that receives the Google sign-in redirect.
//
// Window manipulation is deliberately exposed as application commands rather
// than driven from JavaScript through the plugin APIs. That keeps the
// capability surface to `core:default`, and it puts the rules about *how* the
// widget behaves in one place rather than spread across three entry points.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

const MAIN: &str = "main";
const WIDGET: &str = "widget";
const QUICK: &str = "quick";

/// Candidate quick-capture shortcuts, tried in order at startup.
///
/// Global hotkeys are first-come-first-served across the whole machine, and the
/// obvious combinations are popular: graphics drivers, IMEs, launchers and
/// chat apps all claim them. Shipping one guess would mean the single most
/// important feature in the product silently does nothing on some machines, so
/// the app tries a short list and reports which one it actually got.
const HOTKEY_CANDIDATES: [&str; 5] = [
    "CommandOrControl+Alt+Space",
    "CommandOrControl+Shift+Space",
    "CommandOrControl+Alt+N",
    "CommandOrControl+Shift+Backslash",
    "CommandOrControl+Alt+Backslash",
];

/// Candidate ports for the sign-in redirect.
///
/// A fixed, short list rather than an ephemeral port: every one of these has to
/// be on Supabase's redirect allow-list, and asking someone to allow-list all
/// 65535 of them is not a serious proposal.
const OAUTH_PORTS: [u16; 3] = [47821, 47822, 47823];

/// Emitted to the front end with the full redirect URL once Google comes back.
const OAUTH_EVENT: &str = "recall://oauth-callback";

/// Emitted whenever the widget is shown or hidden, from anywhere.
const WIDGET_VISIBILITY_EVENT: &str = "recall://widget-visibility";

/// How long the widget must sit still before its position is written to disk.
const WINDOW_STATE_DEBOUNCE: Duration = Duration::from_millis(600);

/// What is worth remembering about a window between runs.
///
/// Position and size only. Visibility is deliberately excluded: hiding the
/// widget and quitting would otherwise mean the next launch shows nothing but
/// a tray icon, and the widget being on screen is the entire point of it.
fn window_state_flags() -> StateFlags {
    StateFlags::POSITION | StateFlags::SIZE
}

/// What the global hotkey is currently doing, so the UI can tell the truth
/// about it rather than leaving the user to discover it silently does nothing.
#[derive(Default, Clone, serde::Serialize)]
struct HotkeyStatus {
    accelerator: String,
    registered: bool,
    error: Option<String>,
}

#[derive(Default)]
struct HotkeyState {
    shortcut: Mutex<Option<Shortcut>>,
    status: Mutex<HotkeyStatus>,
}

/* ------------------------------------------------------------------ windows */

fn window(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

fn show_and_focus(win: &WebviewWindow) {
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
}

/// Open the full window, creating it if it does not exist yet.
///
/// The main window is deliberately not created at startup. Each window costs a
/// WebView2 renderer — around 85 MB — and this is an app that runs all day for
/// the sake of a widget the user glances at. The full window is opened
/// occasionally and on purpose, so it is built on demand and torn down on
/// close; the widget and the capture bar, which must be instant, stay resident.
fn open_main(app: &AppHandle) {
    if let Some(win) = window(app, MAIN) {
        show_and_focus(&win);
        return;
    }

    match tauri::WebviewWindowBuilder::new(app, MAIN, tauri::WebviewUrl::App("index.html".into()))
        .title("Recall")
        .inner_size(860.0, 680.0)
        .min_inner_size(420.0, 380.0)
        .center()
        .resizable(true)
        .build()
    {
        Ok(win) => show_and_focus(&win),
        Err(error) => eprintln!("[recall] could not open the main window: {error}"),
    }
}

/// Open the full window, creating it on the main thread if it does not exist.
///
/// Hopping to the main thread is not optional. A command invoked from a webview
/// runs on a worker thread, and building a window there leaves it stuck on
/// about:blank — the window appears but never loads. The tray menu happened to
/// work because tray callbacks already run on the main thread, which made this
/// look fine right up until it was opened from the widget instead.
#[tauri::command]
async fn show_main(app: AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || open_main(&handle));
}

/// Tell every window whether the widget is on screen.
///
/// The main window shows a toggle for it, and the widget can also be hidden
/// from its own menu or the tray. Without a broadcast, that button would show
/// whatever was true when it last rendered.
fn announce_widget_visibility(app: &AppHandle, visible: bool) {
    let _ = app.emit(WIDGET_VISIBILITY_EVENT, visible);
}

#[tauri::command]
fn show_widget(app: AppHandle) {
    if let Some(win) = window(&app, WIDGET) {
        let _ = win.show();
        announce_widget_visibility(&app, true);
    }
}

#[tauri::command]
fn hide_widget(app: AppHandle) {
    if let Some(win) = window(&app, WIDGET) {
        let _ = win.hide();
        // Hiding is a good moment to persist — the position is final and the
        // user is done with it — but this command runs on a worker thread, so
        // it goes through the same main-thread path as everything else.
        request_geometry_save(&app);
        announce_widget_visibility(&app, false);
    }
}

#[tauri::command]
fn toggle_widget(app: AppHandle) -> bool {
    match window(&app, WIDGET) {
        Some(win) => {
            let visible = win.is_visible().unwrap_or(false);
            if visible {
                let _ = win.hide();
                request_geometry_save(&app);
            } else {
                let _ = win.show();
            }
            announce_widget_visibility(&app, !visible);
            !visible
        }
        None => false,
    }
}

/// Push a window to the bottom of the z-order, so it rests on the desktop.
///
/// Deliberately not `SetParent` onto the wallpaper window (`WorkerW`), which is
/// the usual trick for desktop widgets: that turns the window into a child, and
/// a child window cannot be moved by the caption-drag that Tauri's drag regions
/// rely on. Being able to move the widget matters more than surviving Win+D.
#[cfg(windows)]
fn send_to_back(win: &WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Ok(handle) = win.hwnd() {
        unsafe {
            SetWindowPos(
                handle.0 as _,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(not(windows))]
fn send_to_back(_win: &WebviewWindow) {}

/// Pinned means "above everything". Unpinned means "down on the desktop",
/// not merely "no longer forced upward" — otherwise turning the pin off leaves
/// the widget floating wherever it happened to be in the stack.
#[tauri::command]
fn set_widget_always_on_top(app: AppHandle, on_top: bool) {
    let Some(win) = window(&app, WIDGET) else { return };
    let _ = win.set_always_on_top(on_top);
    if !on_top {
        send_to_back(&win);
    }
}

#[tauri::command]
fn is_widget_visible(app: AppHandle) -> bool {
    window(&app, WIDGET)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

/// Show the quick-capture window centred and focused.
///
/// Focus is the whole point: the hotkey exists so a thought can be typed
/// without touching the mouse, and a window that appears unfocused would
/// silently swallow the first few characters.
fn present_quick(app: &AppHandle) {
    if let Some(win) = window(app, QUICK) {
        let _ = win.center();
        show_and_focus(&win);
        let _ = win.emit("recall://quick-shown", ());
    }
}

#[tauri::command]
fn show_quick(app: AppHandle) {
    present_quick(&app);
}

#[tauri::command]
fn hide_quick(app: AppHandle) {
    if let Some(win) = window(&app, QUICK) {
        let _ = win.hide();
    }
}

/* ---------------------------------------------------------------- autostart */

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|error| error.to_string())
}

/* ----------------------------------------------------------- global hotkey */

/// Report whether quick capture is actually armed.
#[tauri::command]
fn get_hotkey_status(app: AppHandle) -> HotkeyStatus {
    app.state::<HotkeyState>()
        .status
        .lock()
        .map(|status| status.clone())
        .unwrap_or_default()
}

#[tauri::command]
fn set_global_hotkey(app: AppHandle, accelerator: String) -> Result<(), String> {
    let state = app.state::<HotkeyState>();

    let record = |registered: bool, error: Option<String>| {
        if let Ok(mut status) = state.status.lock() {
            *status = HotkeyStatus {
                accelerator: accelerator.clone(),
                registered,
                error,
            };
        }
    };

    let shortcut = match Shortcut::from_str(&accelerator) {
        Ok(shortcut) => shortcut,
        Err(_) => {
            let message = format!("\"{accelerator}\" is not a valid shortcut");
            record(false, Some(message.clone()));
            return Err(message);
        }
    };

    // Release the old binding first. Skipping this would leak the previous
    // combination, and the second attempt at any accelerator would collide with
    // our own registration rather than with another application's.
    if let Ok(mut current) = state.shortcut.lock() {
        if let Some(previous) = current.take() {
            let _ = app.global_shortcut().unregister(previous);
        }
    }

    match app.global_shortcut().register(shortcut) {
        Ok(()) => {
            if let Ok(mut current) = state.shortcut.lock() {
                *current = Some(shortcut);
            }
            record(true, None);
            Ok(())
        }
        Err(error) => {
            // Almost always means another application already owns the
            // combination. Recoverable — the user picks a different one — but
            // only if we tell them, so the message is written for a person.
            let message = format!(
                "{accelerator} is already in use by another application. Pick a different shortcut. ({error})"
            );
            record(false, Some(message.clone()));
            Err(message)
        }
    }
}

/* --------------------------------------------------------------- OAuth flow */

/// Start a one-shot loopback listener for the Google redirect.
///
/// Loopback rather than a custom `recall://` URI scheme: a custom scheme has to
/// be registered with Windows by an installer, so it does not work in `tauri
/// dev` and behaves differently between a development run and a real install.
/// A localhost listener behaves identically in both.
#[tauri::command]
async fn start_oauth_listener(app: AppHandle) -> Result<u16, String> {
    let listener = OAUTH_PORTS
        .iter()
        .find_map(|port| TcpListener::bind(("127.0.0.1", *port)).ok())
        .ok_or_else(|| {
            format!(
                "None of the sign-in ports {:?} were free. Close whatever is using them and retry.",
                OAUTH_PORTS
            )
        })?;

    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    std::thread::spawn(move || {
        // One connection only. The listener is dropped afterwards so a stale
        // port is never left open waiting for something that will not come.
        if let Ok((stream, _)) = listener.accept() {
            let mut stream = stream;
            let target = {
                let mut reader = BufReader::new(&stream);
                let mut request_line = String::new();
                let _ = reader.read_line(&mut request_line);
                request_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/")
                    .to_string()
            };

            let body = "<!doctype html><meta charset=\"utf-8\"><title>Recall</title>\
                <body style=\"font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f4f4f6;color:#1b1b20\">\
                <div style=\"text-align:center\"><p style=\"font-size:19px;font-weight:600;margin:0 0 6px\">You are signed in.</p>\
                <p style=\"margin:0;color:#63636e\">You can close this tab and go back to Recall.</p></div>";

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();

            let _ = app.emit(OAUTH_EVENT, format!("http://localhost:{port}{target}"));
        }
    });

    Ok(port)
}

/* ---------------------------------------------------------------- tray icon */

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Recall", true, None::<&str>)?;
    let capture = MenuItem::with_id(app, "capture", "Quick capture", true, None::<&str>)?;
    let widget = MenuItem::with_id(app, "widget", "Show / hide widget", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Recall", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&open, &capture, &widget, &separator, &quit])?;

    TrayIconBuilder::with_id("recall-tray")
        .icon(app.default_window_icon().cloned().expect("bundled icon"))
        .tooltip("Recall")
        .menu(&menu)
        // The menu is for the right button; a left click should just show the app.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => open_main(app),
            "capture" => present_quick(app),
            "widget" => {
                toggle_widget(app.clone());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                open_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// When a window last moved or resized. `None` means nothing to save.
#[derive(Default)]
struct PendingWindowState(Arc<Mutex<Option<Instant>>>);

/// How often the saver checks whether the window has finished moving.
const WINDOW_STATE_POLL: Duration = Duration::from_millis(200);

/// Queue a geometry save for the moment the window stops moving.
fn mark_geometry_changed(app: &AppHandle) {
    if let Ok(mut last) = app.state::<PendingWindowState>().0.lock() {
        *last = Some(Instant::now());
    }
}

/// Ask for a save as soon as the saver next looks.
fn request_geometry_save(app: &AppHandle) {
    if let Ok(mut last) = app.state::<PendingWindowState>().0.lock() {
        // Backdated past the debounce so the next poll writes it immediately.
        *last = Instant::now().checked_sub(WINDOW_STATE_DEBOUNCE);
    }
}

/// Persist window geometry once the window has been still for a moment.
///
/// `tauri-plugin-window-state` only writes on a clean shutdown, which is
/// precisely what does not happen when someone ends the task or the machine
/// loses power. Two details here are not optional:
///
///   * The debounce measures time since the *last* move, not a fixed interval.
///     Saving on a timer while a drag is still under way is what made the
///     widget hang: dragging fires `Moved` continuously, so a periodic saver
///     fires in the middle of the gesture.
///
///   * The save runs on the main thread. Reading a window's position from
///     another thread posts a request to the event loop and blocks for the
///     answer — and during a drag the main thread is inside Windows' modal
///     move loop, not answering. With the plugin's state mutex held by the
///     waiting background thread and wanted by the main thread's own move
///     handler, the two deadlock and the window stops responding.
fn spawn_window_state_saver(app: &AppHandle) {
    let handle = app.clone();
    let pending = app.state::<PendingWindowState>().0.clone();

    std::thread::spawn(move || loop {
        std::thread::sleep(WINDOW_STATE_POLL);

        let due = match pending.lock() {
            Ok(mut last) => match *last {
                Some(at) if at.elapsed() >= WINDOW_STATE_DEBOUNCE => {
                    *last = None;
                    true
                }
                _ => false,
            },
            Err(_) => false,
        };

        if due {
            let for_main = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                let _ = for_main.save_window_state(window_state_flags());
            });
        }
    });
}

/* --------------------------------------------------------------------- run */

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(HotkeyState::default())
        .manage(PendingWindowState::default())
        // Re-launching should surface the app that is already running, not
        // start a second copy fighting over the same windows and hotkey.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            open_main(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            // The widget's position and size are the user's arrangement of
            // their own desktop; losing it on every restart would make the
            // widget feel disposable.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .with_denylist(&[QUICK])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    // Fire on press only; acting on release too would show the
                    // window twice for one keystroke.
                    if event.state() == ShortcutState::Pressed {
                        present_quick(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            show_main,
            show_widget,
            hide_widget,
            toggle_widget,
            is_widget_visible,
            set_widget_always_on_top,
            show_quick,
            hide_quick,
            get_autostart,
            set_autostart,
            set_global_hotkey,
            get_hotkey_status,
            start_oauth_listener,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            build_tray(&handle)?;
            spawn_window_state_saver(&handle);

            // Take the first shortcut this machine will actually give us.
            let bound = HOTKEY_CANDIDATES.iter().find_map(|candidate| {
                set_global_hotkey(handle.clone(), (*candidate).to_string())
                    .ok()
                    .map(|()| *candidate)
            });

            match bound {
                Some(accelerator) if accelerator == HOTKEY_CANDIDATES[0] => {
                    eprintln!("[recall] quick capture: {accelerator}");
                }
                Some(accelerator) => {
                    // Worth saying out loud: the user will reach for the
                    // default, find it does nothing, and needs to know why.
                    eprintln!(
                        "[recall] quick capture: {accelerator} (the preferred {} was already taken by another application)",
                        HOTKEY_CANDIDATES[0]
                    );
                }
                None => {
                    // Every candidate is spoken for. The app is still fully
                    // usable through the widget and the tray; Settings shows
                    // the failure so the user can choose something free.
                    eprintln!(
                        "[recall] quick capture is unavailable: every default shortcut is already in use. Pick one in Settings."
                    );
                }
            }


            Ok(())
        })
        .on_window_event(|window, event| {
            // The window-state plugin only writes on a clean shutdown. Ending
            // the process from Task Manager — or losing power — would otherwise
            // throw away wherever the user had carefully put the widget.
            if matches!(
                event,
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
            ) {
                mark_geometry_changed(window.app_handle());
            }

            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    // The main window is allowed to close for real, which frees
                    // its renderer; `show_main` rebuilds it on demand. Recall
                    // keeps running in the tray either way, so closing it never
                    // disables the widget or the capture shortcut.
                    MAIN => {}
                    // These two must survive: hiding is what the close button
                    // means here, and destroying them would cost the instant
                    // response they exist to provide.
                    WIDGET | QUICK => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    _ => {}
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to start Recall");
}
