use crate::secure_store::SecureStore;
use dirs::data_dir;
use std::path::PathBuf;

fn store_dir() -> PathBuf {
    data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("raphael")
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    SecureStore::new(store_dir())?.get(&key)
}

#[tauri::command]
pub fn set_secret(key: String, value: String) -> Result<(), String> {
    SecureStore::new(store_dir())?.set(&key, &value)
}

#[tauri::command]
pub fn list_files(dir: String, pattern: String) -> Result<Vec<String>, String> {
    use std::fs;
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
    Ok(results)
}

#[tauri::command]
pub fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
