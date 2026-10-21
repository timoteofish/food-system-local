#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn app_info() -> &'static str {
    "Food System Local"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![app_info])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("Food System Local")?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar Food System Local");
}
