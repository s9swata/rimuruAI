use crate::secure_store::SecureStore;
use dirs::data_dir;
use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
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
    log_to_file(&format!("get_secret result: {:?}", result));
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
    app_password: String,
) -> Result<(), String> {
    log_to_file(&format!("send_email: from={} to={} subject={}", from, to, subject));

    let email = Message::builder()
        .from(from.parse().map_err(|e| format!("Invalid from address: {e}"))?)
        .to(to.parse().map_err(|e| format!("Invalid to address: {e}"))?)
        .subject(&subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(from.clone(), app_password);

    let mailer = SmtpTransport::relay("smtp.gmail.com")
        .map_err(|e| e.to_string())?
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| format!("SMTP error: {e}"))?;
    log_to_file("send_email: success");
    Ok(())
}
