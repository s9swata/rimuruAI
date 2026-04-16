use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredChunk {
    pub file_name: String,
    pub chunk_index: usize,
    pub text: String,
    pub embedding: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkResult {
    pub file_name: String,
    pub chunk_index: usize,
    pub text: String,
    pub score: f64,
}

pub fn load_chunks(store_path: &PathBuf) -> Vec<StoredChunk> {
    let path = store_path.join("chunks.json");
    if !path.exists() {
        return Vec::new();
    }
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    serde_json::from_str::<Vec<StoredChunk>>(&content).unwrap_or_default()
}

pub fn save_chunks(store_path: &PathBuf, chunks: &[StoredChunk]) {
    let _ = std::fs::create_dir_all(store_path);
    let path = store_path.join("chunks.json");
    if let Ok(json) = serde_json::to_string_pretty(chunks) {
        let _ = std::fs::write(&path, json);
    }
}

pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f64 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f64 = a.iter().map(|x| x * x).sum::<f64>().sqrt();
    let mag_b: f64 = b.iter().map(|x| x * x).sum::<f64>().sqrt();
    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }
    dot / (mag_a * mag_b)
}

pub fn search(
    query_embedding: &[f64],
    chunks: &[StoredChunk],
    top_k: usize,
    file_names: Option<&[String]>,
) -> Vec<ChunkResult> {
    let filtered: Vec<&StoredChunk> = match file_names {
        Some(names) if !names.is_empty() => {
            chunks.iter().filter(|c| names.contains(&c.file_name)).collect()
        }
        _ => chunks.iter().collect(),
    };

    let mut scored: Vec<ChunkResult> = filtered
        .iter()
        .map(|chunk| {
            let score = cosine_similarity(query_embedding, &chunk.embedding);
            ChunkResult {
                file_name: chunk.file_name.clone(),
                chunk_index: chunk.chunk_index,
                text: chunk.text.clone(),
                score,
            }
        })
        .collect();

    scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(top_k);
    scored
}
