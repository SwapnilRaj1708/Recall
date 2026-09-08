/*!
Recall's Android shell.

Deliberately thin. Everything the user sees is the same React application the
desktop and web apps render; this crate exists to give it a native process, a
deep link to catch sign-in, and a bridge to the home-screen widget, which runs
outside the webview and cannot see its storage.

The desktop shell is a separate crate on purpose. It is built around a tray,
a global hotkey, autostart and three frameless always-on-top windows, none of
which exist on Android, and it is currently installed and working. Bending it
into a mobile target would have meant `#[cfg]` guards through every one of
those systems for no shared benefit.
*/

use std::fs;
use std::io::Write;

use tauri::{AppHandle, Manager};

/// Where the app leaves the list for the widget to render.
///
/// The widget is an `AppWidgetProvider` rendering `RemoteViews`. It runs in
/// this app's process but outside the webview, so it cannot read the IndexedDB
/// mirror that holds the tasks. This file is the handover: the webview writes
/// it, Kotlin reads it, and the widget paints from it with no network and no
/// webview at all.
const WIDGET_STATE_FILE: &str = "widget-state.json";

/// Publish the current list for the home-screen widget.
///
/// Written to a temporary file and renamed, because the widget may read at any
/// moment: a half-written file would render as an empty list, and an empty list
/// is exactly the wrong thing to show someone using this as external memory.
#[tauri::command]
fn publish_widget_state(app: AppHandle, payload: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("no app data directory: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| format!("could not create {dir:?}: {error}"))?;

    let target = dir.join(WIDGET_STATE_FILE);
    let temporary = dir.join(format!("{WIDGET_STATE_FILE}.tmp"));

    {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("could not open {temporary:?}: {error}"))?;
        file.write_all(payload.as_bytes())
            .map_err(|error| format!("could not write {temporary:?}: {error}"))?;
        // Without this the rename can land before the bytes do.
        file.sync_all()
            .map_err(|error| format!("could not flush {temporary:?}: {error}"))?;
    }

    fs::rename(&temporary, &target)
        .map_err(|error| format!("could not replace {target:?}: {error}"))?;

    // Returned so the Kotlin side's assumption about this location can be
    // checked against reality rather than trusted.
    Ok(target.to_string_lossy().into_owned())
}

/// Actions taken on the widget while the app was not running.
const WIDGET_OPS_FILE: &str = "widget-ops.json";

/// Claim the widget's pending actions without discarding them.
///
/// Two phases on purpose. The widget's queue is the only record that a tap
/// happened, so deleting it as it is handed over would lose those captures if
/// the app then failed to apply them — and a lost capture is the one failure
/// this project exists to prevent. Instead the queue is moved aside to a
/// claimed file, which survives until [`clear_widget_ops`] says the work
/// landed. A crash in between re-offers the same batch on the next run.
///
/// That makes delivery at-least-once rather than exactly-once, which is why
/// every operation carries the id the widget minted: replaying one converges on
/// the same row instead of creating a second.
#[tauri::command]
fn take_widget_ops(app: AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("no app data directory: {error}"))?;

    let pending = dir.join(WIDGET_OPS_FILE);
    let claimed = dir.join(format!("{WIDGET_OPS_FILE}.claimed"));

    // A batch claimed but never confirmed is still owed. Anything queued since
    // joins it, so ordering is preserved and nothing is stranded.
    let mut batch = read_ops(&claimed);
    batch.extend(read_ops(&pending));
    let _ = fs::remove_file(&pending);

    if batch.is_empty() {
        let _ = fs::remove_file(&claimed);
        return Ok("[]".to_string());
    }

    let combined = format!("[{}]", batch.join(","));
    fs::write(&claimed, &combined)
        .map_err(|error| format!("could not claim {claimed:?}: {error}"))?;

    Ok(combined)
}

/// Confirm the claimed actions were applied, so they can be dropped.
#[tauri::command]
fn clear_widget_ops(app: AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("no app data directory: {error}"))?;
    let claimed = dir.join(format!("{WIDGET_OPS_FILE}.claimed"));
    if claimed.exists() {
        fs::remove_file(&claimed)
            .map_err(|error| format!("could not clear {claimed:?}: {error}"))?;
    }
    Ok(())
}

/// The raw JSON objects in a queue file, or nothing if it is absent or damaged.
///
/// Kept as text rather than parsed: this layer only has to move operations
/// around intact, and the webview is where they are understood.
fn read_ops(path: &std::path::Path) -> Vec<String> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<serde_json::Value>>(&contents) {
        Ok(values) => values.iter().map(|value| value.to_string()).collect(),
        Err(_) => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Catches `recall://auth-callback`, which is how the Google consent
        // screen hands the authorisation code back to the app.
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            publish_widget_state,
            take_widget_ops,
            clear_widget_ops
        ])
        .run(tauri::generate_context!())
        .expect("error while running Recall");
}
