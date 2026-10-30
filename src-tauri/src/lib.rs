#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, RunEvent};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct LocalAccessToken {
    value: String,
    api_ready: Arc<AtomicBool>,
}
struct BackendProcess(Mutex<Option<Child>>);

fn load_or_create_secret_key(secret_path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    match fs::read_to_string(secret_path) {
        Ok(value) => return Ok(value.trim().to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {},
        Err(error) => return Err(Box::new(error)),
    }

    let mut key_bytes = [0u8; 32];
    getrandom::fill(&mut key_bytes).map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    let key = key_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).map_err(|error| io::Error::new(io::ErrorKind::Other, error.to_string()))?;
    let nonce_text = nonce.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    let temp_path = secret_path.with_file_name(format!("secret.key.{}.{}.tmp", std::process::id(), nonce_text));

    let mut temp_created = false;
    let create_result = (|| -> io::Result<String> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp_path)?;
        temp_created = true;
        file.write_all(key.as_bytes())?;
        file.sync_all()?;
        match fs::hard_link(&temp_path, secret_path) {
            Ok(()) => Ok(key.clone()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                fs::read_to_string(secret_path).map(|value| value.trim().to_string())
            }
            Err(error) => Err(error),
        }
    })();
    let cleanup_result = if temp_created { fs::remove_file(&temp_path) } else { Ok(()) };
    match create_result {
        Ok(value) => {
            cleanup_result?;
            Ok(value)
        }
        Err(error) => {
            let _ = cleanup_result;
            Err(Box::new(error))
        }
    }
}

#[tauri::command]
fn app_info() -> &'static str {
    "Food System"
}

#[tauri::command]
fn local_access_token(token: tauri::State<'_, LocalAccessToken>) -> Result<String, String> {
    #[cfg(debug_assertions)]
    { let _ = token; Ok(String::new()) }
    #[cfg(not(debug_assertions))]
    {
        if !token.api_ready.load(Ordering::Acquire) {
            return Err("The local API is not ready yet".into());
        }
        Ok(token.value.clone())
    }
}

#[tauri::command]
fn public_menu_base_url() -> String {
    std::env::var("FOOD_SYSTEM_PUBLIC_MENU_URL")
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/')
        .to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_info, local_access_token, public_menu_base_url])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .setup(|app| {
            let mut token_bytes = [0u8; 32];
            getrandom::fill(&mut token_bytes).map_err(|error| format!("Could not create the local access token: {error}"))?;
            let local_access_token = token_bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
            let api_ready = Arc::new(AtomicBool::new(false));
            app.manage(LocalAccessToken { value: local_access_token.clone(), api_ready: Arc::clone(&api_ready) });
            app.manage(BackendProcess(Mutex::new(None)));
            #[cfg(not(debug_assertions))]
            {
                let resource_dir = app.path().resource_dir()?;
                let app_data_dir = app.path().app_data_dir()?;
                fs::create_dir_all(&app_data_dir)?;
                let secret_path = app_data_dir.join("secret.key");
                let secret_key = load_or_create_secret_key(&secret_path)
                    .map_err(|error| format!("Could not load the local encryption key: {error}"))?;
                let launcher = resource_dir.join("desktop").join("launcher.mjs");
                let bundled_node = resource_dir.join("desktop").join("runtime").join("node.exe");
                if !bundled_node.is_file() {
                    return Err("The bundled Node.js runtime was not found. Repair the installation.".into());
                }
                let mut child = Command::new(bundled_node)
                    .arg(&launcher)
                    .current_dir(&resource_dir)
                    .env("NODE_ENV", "production")
                    .env("FOOD_SYSTEM_SECRET_KEY", secret_key.trim())
                    .env("FOOD_SYSTEM_LOCAL_ACCESS_TOKEN", &local_access_token)
                    .env("FOOD_SYSTEM_DATA_DIR", &app_data_dir)
                    .env("FOOD_SYSTEM_PARENT_PID", std::process::id().to_string())
                    .env("FOOD_SYSTEM_TAURI_CONTROL", "1")
                    .stdin(Stdio::piped())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::inherit())
                    .spawn()
                    .map_err(|error| format!("Could not start the local backend: {error}"))?;
                let launcher_stdout = child.stdout.take().ok_or("Could not monitor local API startup")?;
                let readiness = Arc::clone(&api_ready);
                std::thread::spawn(move || {
                    for line in BufReader::new(launcher_stdout).lines() {
                        match line {
                            Ok(line) if line.trim() == "FOOD_SYSTEM_API_LISTENING" => readiness.store(true, Ordering::Release),
                            Ok(line) if line.trim() == "FOOD_SYSTEM_API_STOPPING" => readiness.store(false, Ordering::Release),
                            Ok(_) => {},
                            Err(_) => break,
                        }
                    }
                    readiness.store(false, Ordering::Release);
                });
                if let Some(state) = app.try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        *process = Some(child);
                    }
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("Food System")?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Could not build Food System")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<BackendProcess>() {
                    if let Ok(mut process) = state.0.lock() {
                        if let Some(child) = process.as_mut() {
                            if let Some(input) = child.stdin.as_mut() {
                                let _ = input.write_all(b"{\"type\":\"shutdown\"}\n");
                                let _ = input.flush();
                            }
                            let deadline = Instant::now() + Duration::from_secs(450);
                            loop {
                                match child.try_wait() {
                                    Ok(Some(_)) => break,
                                    Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
                                    _ => {
                                        // Keep the database safe if shutdown stalls. Terminate only
                                        // the launcher after the operation-drain window.
                                        let _ = child.kill();
                                        let _ = child.wait();
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
}
