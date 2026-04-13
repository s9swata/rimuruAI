use crate::secure_store::SecureStore;
use dirs::data_dir;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

fn store_dir() -> PathBuf {
    data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("raphael")
}

fn log_path() -> PathBuf {
    store_dir().join("raphael.log")
}

fn log_to_file(msg: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
    {
        let _ = writeln!(
            file,
            "[{}] {}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
            msg
        );
    }
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    log_to_file(&format!("get_secret: {}", key));
    let result = SecureStore::new(store_dir())?.get(&key);
    log_to_file(&format!("get_secret result: {}", if result.as_ref().map(|r| r.is_some()).unwrap_or(false) { "Some(***)" } else { "None" }));
    result
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
    log_to_file(&format!("set_secret: {} (value len: {})", key, value.len()));
    let result = SecureStore::new(store_dir())?.set(&key, &value);
    log_to_file(&format!("set_secret result: {:?}", result));
    result
}

#[tauri::command]
pub fn list_files(dir: String, pattern: String) -> Result<Vec<String>, String> {
    log_to_file(&format!("list_files: dir={}, pattern={}", dir, pattern));
    let path = std::path::Path::new(&dir);
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut results = vec![];
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(&pattern) {
            results.push(entry.path().to_string_lossy().to_string());
        }
    }
    log_to_file(&format!("list_files result: {} files", results.len()));
    Ok(results)
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    log_to_file(&format!("read_file_content: {}", path));
    let result = std::fs::read_to_string(&path).map_err(|e| e.to_string());
    log_to_file(&format!(
        "read_file_content result: {} bytes",
        result.as_ref().map(|s| s.len()).unwrap_or(0)
    ));
    result
}

#[tauri::command]
pub fn get_logs() -> Result<String, String> {
    let path = log_path();
    if !path.exists() {
        return Ok("No logs yet".to_string());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_logs() -> Result<(), String> {
    let path = log_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn send_email(
    from: String,
    to: String,
    subject: String,
    body: String,
) -> Result<(), String> {
    log_to_file(&format!("send_email: from={} to={} subject={}", from, to, subject));

    let access_token = crate::google_oauth::get_valid_access_token(store_dir())?;

    let rt = tokio::runtime::Handle::try_current()
        .map_err(|_| "No tokio runtime available".to_string())?;

    rt.block_on(crate::gmail_api::send_email(
        &access_token,
        &from,
        &to,
        &subject,
        &body,
    ))?;

    log_to_file("send_email: success via Gmail API");
    Ok(())
}

/// Initiates Google OAuth 2.0 PKCE flow.
/// Returns the authorization URL — frontend opens it in the system browser.
#[tauri::command]
pub async fn start_google_oauth() -> Result<String, String> {
    log_to_file("start_google_oauth: initiating");

    let store = SecureStore::new(store_dir())?;
    let client_id = store
        .get("google_client_id")?
        .ok_or("Google client_id not configured. Save it in Settings first.")?;

    if client_id.is_empty() {
        return Err("Google client_id is empty. Save it in Settings first.".to_string());
    }

    let url = crate::google_oauth::start_oauth_flow(client_id, store_dir()).await?;

    log_to_file("start_google_oauth: auth url generated");
    Ok(url)
}

/// Returns whether the user has connected their Gmail account (has a non-empty refresh token).
#[tauri::command]
pub fn get_gmail_auth_status() -> bool {
    crate::google_oauth::is_authenticated(store_dir())
}

/// Removes all Google OAuth tokens — user must re-authenticate to send email.
#[tauri::command]
pub fn revoke_google_oauth() -> Result<(), String> {
    log_to_file("revoke_google_oauth");
    crate::google_oauth::revoke(store_dir())
}

#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let path = store_dir().join("config.json");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(json: String) -> Result<(), String> {
    let dir = store_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_profile() -> Result<String, String> {
    let path = store_dir().join("PROFILE.md");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_profile(info: String) -> Result<(), String> {
    let dir = store_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("PROFILE.md");
    
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("- [{}]: {}\n", timestamp, info);
    
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        if let Err(e) = write!(file, "{}", entry) {
            return Err(e.to_string());
        }
        log_to_file(&format!("update_profile saved: {}", info));
        Ok(())
    } else {
        Err("Could not open PROFILE.md for appending".to_string())
    }
}
