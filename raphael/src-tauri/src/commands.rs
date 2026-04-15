
use crate::secure_store::SecureStore;

use dirs::data_dir;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
pub fn graphify_query(query: String, _depth: Option<usize>) -> Result<String, String> {
    log_to_file(&format!("--- [DEBUG] START graphify_query ---"));
    log_to_file(&format!("Input Query: '{}'", query));
    
    let memory_dir = store_dir().join("memory");
    std::fs::create_dir_all(&memory_dir).unwrap_or_default();
    log_to_file(&format!("Current working directory for graphify: {:?}", memory_dir));
    
    let output = Command::new("python3")
        .arg("/tmp/graphify-v4/graphify/__main__.py")
        .arg("query")
        .arg(&query)
        .current_dir(&memory_dir)
        .output()
        .map_err(|e| {
            let err_msg = format!("Failed to spawn graphify command: {}", e);
            log_to_file(&err_msg);
            err_msg
        })?;

    if output.status.success() {
        let result = String::from_utf8_lossy(&output.stdout).to_string();
        log_to_file(&format!("graphify_query SUCCESS. Status: {}", output.status));
        log_to_file(&format!("STDOUT Snippet (first 500 chars): {:.500}", result));
        log_to_file(&format!("--- [DEBUG] END graphify_query ---"));
        Ok(result)
    } else {
        let err = String::from_utf8_lossy(&output.stderr).to_string();
        log_to_file(&format!("graphify_query FAILED. Status: {}", output.status));
        log_to_file(&format!("STDERR Output:\n{}", err));
        if !output.stdout.is_empty() {
            log_to_file(&format!("STDOUT Output:\n{}", String::from_utf8_lossy(&output.stdout)));
        }
        log_to_file(&format!("--- [DEBUG] END graphify_query ---"));
        Err(err)
    }
}

#[tauri::command]
pub fn store_memory(text: String) -> Result<String, String> {
    log_to_file(&format!("--- [DEBUG] START store_memory ---"));
    log_to_file(&format!("Input Text: '{}'", text));
    
    let memory_dir = store_dir().join("memory");
    
    log_to_file(&format!("Will attempt to create/use memory_dir: {:?}", memory_dir));
    std::fs::create_dir_all(&memory_dir).map_err(|e| {
        let err_msg = format!("Failed to create memory_dir: {:?} Error: {}", memory_dir, e);
        log_to_file(&err_msg);
        err_msg
    })?;
    
    let path = memory_dir.join("memory_log.md");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let entry = format!("- [{}]: {}\n", timestamp, text);
    
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(e) = file.write_all(entry.as_bytes()) {
                let err_msg = format!("Failed to write to memory_log.md: {}", e);
                log_to_file(&err_msg);
                return Err(err_msg);
            }
            log_to_file(&format!("Successfully appended to {:?}", path));
            
            // --- Graphify v4 Fast Injection ---
            // Graphify v4's AST extractor parses code files natively, but requires agents to parse unstructured memory logs.
            // To ensure immediate queryability without LLM delays, we dynamically inject the text as a node directly into graph.json.
            let out_dir = memory_dir.join("graphify-out");
            std::fs::create_dir_all(&out_dir).unwrap_or_default();
            let graph_path = out_dir.join("graph.json");
            
            let mut graph_data = if graph_path.exists() {
                let content = std::fs::read_to_string(&graph_path).unwrap_or_else(|_| r#"{"nodes":[],"links":[]}"#.to_string());
                serde_json::from_str::<serde_json::Value>(&content).unwrap_or_else(|_| serde_json::json!({"nodes":[],"links":[]}))
            } else {
                serde_json::json!({"nodes": [], "links": []})
            };
            
            let new_id = format!("mem_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());
            let new_node = serde_json::json!({
                "id": new_id,
                "label": text,
                "file_type": "memory",
                "community": 0
            });
            
            if let Some(nodes) = graph_data.get_mut("nodes").and_then(|n| n.as_array_mut()) {
                nodes.push(new_node);
            } else {
                graph_data["nodes"] = serde_json::json!([new_node]);
            }
            
            if graph_data.get("links").is_none() {
                graph_data["links"] = serde_json::json!([]);
            }
            
            if let Err(e) = std::fs::write(&graph_path, serde_json::to_string_pretty(&graph_data).unwrap_or_default()) {
                log_to_file(&format!("Failed to write injected graph.json: {}", e));
            } else {
                log_to_file(&format!("Successfully injected node {} into graph.json", new_id));
            }
            // ----------------------------------
                
            log_to_file("--- [DEBUG] END store_memory ---");
            Ok(format!("Saved to memory and successfully injected into knowledge graph"))
        }
        Err(e) => {
            let err_msg = format!("Could not open memory log: {}", e);
            log_to_file(&err_msg);
            log_to_file("--- [DEBUG] END store_memory ---");
            Err(err_msg)
        }
    }
}

fn store_dir() -> PathBuf {
    // Cross-platform: try data_dir() first, then fallback based on OS
    if let Some(dir) = data_dir() {
        return dir.join("ai.rimuru.raphael");
    }
    
    // Fallback: derive platform-specific app data directory
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    
    #[cfg(target_os = "macos")]
    return home.join("Library/Application Support/ai.rimuru.raphael");
    
    #[cfg(target_os = "windows")]
    return home.join("AppData/Roaming/ai.rimuru.raphael");
    
    #[cfg(target_os = "linux")]
    return home.join(".local/share/ai.rimuru.raphael");
    
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    return home.join(".local/share/ai.rimuru.raphael");
}

/// Expose the app data directory to the frontend so TypeScript can construct
/// paths to persistent files (e.g. the MCP memory store) without hardcoding
/// platform-specific conventions.
#[tauri::command]
pub fn get_store_dir() -> String {
    store_dir().to_string_lossy().into_owned()
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
pub async fn send_email(
    from: String,
    to: String,
    subject: String,
    body: String,
) -> Result<(), String> {
    log_to_file(&format!("send_email: from={} to={} subject={}", from, to, subject));

    let access_token = crate::google_oauth::get_valid_access_token(store_dir()).await?;

    crate::gmail_api::send_email(
        &access_token,
        &from,
        &to,
        &subject,
        &body,
    ).await?;

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

    let client_secret = store
        .get("google_client_secret")?
        .ok_or("Google client_secret not configured. Save it in Settings first.")?;

    if client_secret.is_empty() {
        return Err("Google client_secret is empty. Save it in Settings first.".to_string());
    }

    let url = crate::google_oauth::start_oauth_flow(client_id, client_secret, store_dir()).await?;

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
        log_to_file(&format!("update_profile path: {:?}", path));
    log_to_file(&format!("update_profile saved: {}", info));
        Ok(())
    } else {
        Err("Could not open PROFILE.md for appending".to_string())
    }
}

#[derive(Serialize, Deserialize)]
pub struct HttpFetchParams {
    url: String,
    method: String,
    body: Option<String>,
}

#[tauri::command]
pub async fn http_fetch(params: HttpFetchParams) -> Result<serde_json::Value, String> {
    log_to_file(&format!("http_fetch: {} {}", params.method, params.url));
    
    let client = Client::new();
    let request = match params.method.to_uppercase().as_str() {
        "GET" => client.get(&params.url),
        "POST" => client.post(&params.url),
        _ => return Err("Unsupported method".to_string()),
    };
    
    let mut request = request;
    if let Some(body) = params.body {
        request = request.header("Content-Type", "application/json").body(body);
    }
    
    let response = request.send().await.map_err(|e| {
        log_to_file(&format!("http_fetch error: {}", e));
        e.to_string()
    })?;
    
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        log_to_file(&format!("http_fetch failed: {} {}", status, text));
        return Err(format!("HTTP {}: {}", status, text));
    }
    
    let json: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    log_to_file(&format!("http_fetch success: {}", json));
    Ok(json)
}
