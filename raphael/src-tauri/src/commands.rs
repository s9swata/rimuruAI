#[tauri::command]
pub fn get_secret(_key: String) -> Result<Option<String>, String> {
    Ok(None)
}

#[tauri::command]
pub fn set_secret(_key: String, _value: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn list_files(_dir: String, _pattern: String) -> Result<Vec<String>, String> {
    Ok(vec![])
}

#[tauri::command]
pub fn read_file_content(_path: String) -> Result<String, String> {
    Err("not implemented".into())
}
