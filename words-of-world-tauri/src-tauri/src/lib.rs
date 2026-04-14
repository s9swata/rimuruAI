mod audio;
mod injector;
mod settings;
mod transcription;

use audio::AudioRecorder;
use injector::InjectorState;
use settings::AppSettings;
use std::sync::Mutex;
use tauri::State;

pub struct AppState {
    recorder: Mutex<AudioRecorder>,
    injector: InjectorState,
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
fn get_settings() -> Result<AppSettings, String> {
    settings::get_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings::save_settings(&settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn transcribe_audio(audio_path: String) -> Result<String, String> {
    let api_key = settings::get_api_key()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "API key not configured. Please set your Groq API key first.".to_string())?;

    transcription::transcribe_audio(&audio_path, &api_key)
        .await
        .map(|result| result.text)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_recording(state: State<AppState>) -> Result<String, String> {
    let state = state.inner();
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    recorder.start_recording().map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<Option<String>, String> {
    let state = state.inner();
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    recorder.stop_recording().map_err(|e| e.to_string())
}

#[tauri::command]
fn check_recording_status(state: State<AppState>) -> Result<bool, String> {
    let state = state.inner();
    let recorder = state.recorder.lock().map_err(|e| e.to_string())?;
    Ok(recorder.check_recording_status())
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
        .manage(AppState {
            recorder: Mutex::new(AudioRecorder::new()),
            injector: InjectorState::default(),
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            injector::inject_text,
            injector::check_accessibility_permissions,
            get_api_key,
            set_api_key,
            get_settings,
            save_settings,
            transcribe_audio,
            start_recording,
            stop_recording,
            check_recording_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}