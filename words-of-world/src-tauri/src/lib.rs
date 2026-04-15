mod audio;
mod injector;
mod settings;
mod transcription;

use audio::AudioRecorder;
use injector::InjectorState;
use settings::AppSettings;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

pub struct AppState {
    recorder: Mutex<AudioRecorder>,
    http_client: reqwest::Client,
}

pub struct TrayMenuState {
    record_item: MenuItem<tauri::Wry>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_api_key() -> Result<Option<String>, String> {
    settings::get_api_key().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_api_key(key: String) -> Result<(), String> {
    settings::set_api_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn has_api_key() -> Result<bool, String> {
    Ok(settings::get_api_key().map_err(|e| e.to_string())?.is_some())
}

#[tauri::command]
fn get_settings() -> Result<AppSettings, String> {
    settings::get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn transcribe_audio(audio_path: String, state: State<'_, AppState>) -> Result<String, String> {
    let api_key = settings::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "API key not configured. Please set your Groq API key first.".to_string())?;

    transcription::transcribe_audio(&audio_path, &api_key, &state.http_client)
        .await
        .map(|result| result.text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_recording(app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    let result = recorder.start_recording().map_err(|e| e.to_string())?;
    if let Some(tray_state) = app.try_state::<TrayMenuState>() {
        let _ = tray_state.record_item.set_text("Stop Recording");
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some("WordsOfWorld - Recording..."));
    }
    Ok(result)
}

#[tauri::command]
fn stop_recording(app: tauri::AppHandle, state: State<AppState>) -> Result<Option<String>, String> {
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    let result = recorder.stop_recording().map_err(|e| e.to_string())?;
    if let Some(tray_state) = app.try_state::<TrayMenuState>() {
        let _ = tray_state.record_item.set_text("Start Recording");
    }
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some("WordsOfWorld - Voice to Text"));
    }
    Ok(result)
}

#[tauri::command]
fn check_recording_status(state: State<AppState>) -> Result<bool, String> {
    let state = state.inner();
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    Ok(recorder.check_recording_status())
}

#[tauri::command]
fn list_microphones() -> Result<Vec<audio::AudioDevice>, String> {
    audio::list_input_devices().map_err(|e: anyhow::Error| e.to_string())
}

#[tauri::command]
fn test_microphone(device_name: Option<String>) -> Result<bool, String> {
    audio::test_microphone(device_name.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn check_microphone_status() -> Result<bool, String> {
    audio::check_microphone_status().map_err(|e| e.to_string())
}

#[tauri::command]
async fn start_mic_test(app: tauri::AppHandle, device_name: Option<String>) -> Result<(), String> {
    audio::start_mic_test(&app, device_name.as_deref())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_mic_test() -> Result<(), String> {
    audio::stop_mic_test().map_err(|e| e.to_string())
}

fn setup_tray(app: &tauri::App) -> Result<MenuItem<tauri::Wry>, Box<dyn std::error::Error>> {
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let record = MenuItem::with_id(app, "record", "Start Recording", true, None::<&str>)?;
    let prefs = MenuItem::with_id(app, "prefs", "Preferences", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&record, &prefs, &show, &quit])?;

    let icon_bytes = include_bytes!("../icons/32x32.png");
    let icon = Image::from_bytes(icon_bytes)?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("WordsOfWorld - Voice to Text")
        .on_menu_event(|app: &tauri::AppHandle, event| {
            match event.id.as_ref() {
                "quit" => {
                    app.exit(0);
                }
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "record" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("tray-record", ());
                    }
                }
                "prefs" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        let _ = window.emit("open-preferences", ());
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(record)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let record_item = setup_tray(app)?;
            app.manage(TrayMenuState { record_item });

            // Pre-warm TLS connection so the first transcription has zero handshake cost.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Some(state) = handle.try_state::<AppState>() {
                    let _ = state
                        .http_client
                        .head("https://api.groq.com")
                        .send()
                        .await;
                    eprintln!("[http] connection to api.groq.com pre-warmed");
                }
            });

            Ok(())
        })
        .manage(AppState {
            recorder: Mutex::new(AudioRecorder::new()),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("failed to build HTTP client"),
        })
        .manage(InjectorState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            injector::inject_text,
            injector::check_accessibility_permissions,
            get_api_key,
            set_api_key,
            has_api_key,
            get_settings,
            save_settings,
            transcribe_audio,
            start_recording,
            stop_recording,
            check_recording_status,
            list_microphones,
            test_microphone,
            check_microphone_status,
            start_mic_test,
            stop_mic_test,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}