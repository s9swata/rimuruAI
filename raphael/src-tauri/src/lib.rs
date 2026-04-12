mod commands;
mod secure_store;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_secret,
            commands::set_secret,
            commands::list_files,
            commands::read_file_content,
        ])
        .run(tauri::generate_context!())
        .expect("error while running raphael");
}
