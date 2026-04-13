// raphael/src-tauri/src/graph_cache.rs
//
// Content-hash cache for graph extraction results.
// Key: SHA256(input_text). Value: JSON of { nodes, edges }.
// Stored in store_dir/graph_cache/{hash}.json
//
// This mirrors graphify v3 cache.py — prevents re-calling Groq
// for text the agent has already processed.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;

fn cache_dir(store_dir: &PathBuf) -> PathBuf {
    store_dir.join("graph_cache")
}

fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn load_cached(text: &str, store_dir: &PathBuf) -> Option<String> {
    let hash = content_hash(text);
    let path = cache_dir(store_dir).join(format!("{}.json", hash));
    fs::read_to_string(&path).ok()
}

pub fn save_cached(text: &str, json: &str, store_dir: &PathBuf) -> Result<(), String> {
    let dir = cache_dir(store_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let hash = content_hash(text);
    let path = dir.join(format!("{}.json", hash));
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}
