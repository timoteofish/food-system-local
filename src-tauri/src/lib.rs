#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::process::{Child, Command};
use std::sync::Mutex;

struct BackendProcess(Mutex<Option<Child>>);

#[tauri::command]
fn app_info() -> &'static str {
    "Food System"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![app_info])
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app.path().resource_dir()?;
                let launcher = resource_dir.join("desktop").join("launcher.mjs");
                let bundled_node = resource_dir.join("desktop").join("runtime").join("node.exe");
                let node_command = if bundled_node.exists() {
                    bundled_node
                } else {
                    std::path::PathBuf::from("node.exe")
                };
                let child = Command::new(node_command)
                    .arg(&launcher)
                    .current_dir(&resource_dir)
                    .env("NODE_ENV", "development")
                    .spawn()
                    .map_err(|error| format!("não foi possível iniciar o backend local: {error}"))?;
                app.manage(BackendProcess(Mutex::new(Some(child))));
            }
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("Food System")?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(state) = window.app_handle().try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        if let Some(child) = process.as_mut() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao executar Food System");
}
