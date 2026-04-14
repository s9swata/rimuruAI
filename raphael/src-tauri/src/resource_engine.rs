use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceField {
    pub name: String,
    pub field_type: String, // "string", "number", "boolean"
    pub required: bool,
    pub searchable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceToolDef {
    pub name: String,
    pub description: String,
    pub op: String, // "find" | "upsert" | "list" | "delete"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceManifest {
    pub resource_type: String,
    pub description: String,
    pub fields: Vec<ResourceField>,
    pub tools: Vec<ResourceToolDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceStore {
    pub items: Vec<serde_json::Value>,
}

fn resources_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let dir = base.join("resources");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create resources dir: {e}"))?;
    Ok(dir)
}

fn manifest_path(dir: &PathBuf, resource_type: &str) -> PathBuf {
    dir.join(format!("{}.manifest.json", resource_type))
}

fn store_path(dir: &PathBuf, resource_type: &str) -> PathBuf {
    dir.join(format!("{}.store.json", resource_type))
}

fn read_store(store_file: &PathBuf) -> Result<ResourceStore, String> {
    if !store_file.exists() {
        return Ok(ResourceStore { items: vec![] });
    }
    let raw = fs::read_to_string(store_file)
        .map_err(|e| format!("Failed to read store file: {e}"))?;
    serde_json::from_str::<ResourceStore>(&raw)
        .map_err(|e| format!("Failed to parse store file: {e}"))
}

fn write_store(store_file: &PathBuf, store: &ResourceStore) -> Result<(), String> {
    let json = serde_json::to_string_pretty(store)
        .map_err(|e| format!("Failed to serialize store: {e}"))?;
    fs::write(store_file, json).map_err(|e| format!("Failed to write store file: {e}"))
}

fn read_manifest(manifest_file: &PathBuf) -> Result<ResourceManifest, String> {
    let raw = fs::read_to_string(manifest_file)
        .map_err(|e| format!("Failed to read manifest file: {e}"))?;
    serde_json::from_str::<ResourceManifest>(&raw)
        .map_err(|e| format!("Failed to parse manifest file: {e}"))
}

/// Save a new resource type manifest. Creates resources dir + manifest file + empty store file.
#[tauri::command]
pub async fn resource_define(
    app: tauri::AppHandle,
    manifest: ResourceManifest,
) -> Result<ResourceManifest, String> {
    let dir = resources_dir(&app)?;

    // Write manifest
    let mpath = manifest_path(&dir, &manifest.resource_type);
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {e}"))?;
    fs::write(&mpath, json).map_err(|e| format!("Failed to write manifest file: {e}"))?;

    // Initialize store if not already present
    let spath = store_path(&dir, &manifest.resource_type);
    if !spath.exists() {
        let empty = ResourceStore { items: vec![] };
        write_store(&spath, &empty)?;
    }

    Ok(manifest)
}

/// List all defined resource manifests (reads all *.manifest.json files).
#[tauri::command]
pub async fn resource_list_manifests(
    app: tauri::AppHandle,
) -> Result<Vec<ResourceManifest>, String> {
    let dir = resources_dir(&app)?;

    let mut manifests = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("Failed to read resources dir: {e}"))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Dir entry error: {e}"))?;
        let path = entry.path();
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if name.ends_with(".manifest.json") {
                match read_manifest(&path) {
                    Ok(m) => manifests.push(m),
                    Err(e) => eprintln!("Skipping bad manifest {name}: {e}"),
                }
            }
        }
    }

    Ok(manifests)
}

/// Upsert an item into a resource store. Matches on "name" field for dedup if present, else "id".
#[tauri::command]
pub async fn resource_upsert(
    app: tauri::AppHandle,
    resource_type: String,
    item: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let dir = resources_dir(&app)?;
    let spath = store_path(&dir, &resource_type);
    let mut store = read_store(&spath)?;

    // Determine the dedup key: prefer "name", fall back to "id"
    let key_value = item
        .get("name")
        .or_else(|| item.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    if let Some(key) = key_value {
        // Check for an existing item with the same name/id
        let use_name = item.get("name").and_then(|v| v.as_str()).is_some();
        let field = if use_name { "name" } else { "id" };

        let pos = store.items.iter().position(|existing| {
            existing
                .get(field)
                .and_then(|v| v.as_str())
                .map(|s| s == key)
                .unwrap_or(false)
        });

        if let Some(idx) = pos {
            store.items[idx] = item.clone();
        } else {
            store.items.push(item.clone());
        }
    } else {
        // No name or id — always append
        store.items.push(item.clone());
    }

    write_store(&spath, &store)?;
    Ok(item)
}

/// Fuzzy (case-insensitive substring) search across all searchable fields of a resource type.
#[tauri::command]
pub async fn resource_find(
    app: tauri::AppHandle,
    resource_type: String,
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = resources_dir(&app)?;

    // Load manifest to discover searchable fields
    let mpath = manifest_path(&dir, &resource_type);
    if !mpath.exists() {
        return Err(format!("Resource type '{}' is not defined", resource_type));
    }
    let manifest = read_manifest(&mpath)?;
    let searchable_fields: Vec<&str> = manifest
        .fields
        .iter()
        .filter(|f| f.searchable)
        .map(|f| f.name.as_str())
        .collect();

    let spath = store_path(&dir, &resource_type);
    let store = read_store(&spath)?;

    let q = query.to_lowercase();
    let results = store
        .items
        .into_iter()
        .filter(|item| {
            searchable_fields.iter().any(|field| {
                item.get(*field)
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_lowercase().contains(&q))
                    .unwrap_or(false)
            })
        })
        .collect();

    Ok(results)
}

/// List all items of a resource type.
#[tauri::command]
pub async fn resource_list(
    app: tauri::AppHandle,
    resource_type: String,
) -> Result<Vec<serde_json::Value>, String> {
    let dir = resources_dir(&app)?;
    let spath = store_path(&dir, &resource_type);
    let store = read_store(&spath)?;
    Ok(store.items)
}

/// Delete item by "name" or "id" field match.
#[tauri::command]
pub async fn resource_delete(
    app: tauri::AppHandle,
    resource_type: String,
    id: String,
) -> Result<bool, String> {
    let dir = resources_dir(&app)?;
    let spath = store_path(&dir, &resource_type);
    let mut store = read_store(&spath)?;

    let before = store.items.len();
    store.items.retain(|item| {
        let name_match = item
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| s == id)
            .unwrap_or(false);
        let id_match = item
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s == id)
            .unwrap_or(false);
        !(name_match || id_match)
    });
    let deleted = store.items.len() < before;

    if deleted {
        write_store(&spath, &store)?;
    }

    Ok(deleted)
}
