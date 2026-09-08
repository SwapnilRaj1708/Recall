/*!
Recall's Android shell.

Deliberately thin. Everything the user sees is the same React application the
desktop and web apps render; this crate exists to give it a native process, a
deep link to catch sign-in, and — once the widget lands — a bridge to the
home-screen widget, which runs outside the webview and cannot see its storage.

The desktop shell is a separate crate on purpose. It is built around a tray,
a global hotkey, autostart and three frameless always-on-top windows, none of
which exist on Android, and it is currently installed and working. Bending it
into a mobile target would have meant `#[cfg]` guards through every one of
those systems for no shared benefit.
*/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Catches `recall://auth-callback`, which is how the Google consent
        // screen hands the authorisation code back to the app.
        .plugin(tauri_plugin_deep_link::init())
        .run(tauri::generate_context!())
        .expect("error while running Recall");
}
