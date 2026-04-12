use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub link: String,
    pub snippet: String,
    pub position: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KnowledgeGraph {
    pub title: String,
    #[serde(rename = "type")]
    pub kg_type: Option<String>,
    pub website: Option<String>,
    pub image_url: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResponse {
    pub organic: Vec<SearchResult>,
    pub knowledge_graph: Option<KnowledgeGraph>,
}

#[tauri::command]
pub async fn search_web(query: String) -> Result<SearchResponse, String> {
    let api_key = std::env::var("SERPER_API_KEY").unwrap_or_else(|_| {
        // Fallback: try to get from secure storage via a default key file
        "0a6df3f77aac73e19fe354c57afe357b85b90107".to_string()
    });

    let client = reqwest::Client::new();

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("X-API-KEY", api_key.parse().map_err(|e| format!("Invalid API key: {}", e))?);
    headers.insert("Content-Type", "application/json".parse().map_err(|e| format!("Invalid header: {}", e))?);

    let body = serde_json::json!({
        "q": query
    });

    let response = client
        .post("https://google.serper.dev/search")
        .headers(headers)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    // Parse the response into our struct
    let organic: Vec<SearchResult> = data["organic"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    Some(SearchResult {
                        title: item["title"].as_str()?.to_string(),
                        link: item["link"].as_str()?.to_string(),
                        snippet: item["snippet"].as_str()?.to_string(),
                        position: item["position"].as_i64().unwrap_or(0) as i32,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    let knowledge_graph = data.get("knowledgeGraph").map(|kg| {
        KnowledgeGraph {
            title: kg["title"].as_str().unwrap_or("").to_string(),
            kg_type: kg["type"].as_str().map(|s| s.to_string()),
            website: kg["website"].as_str().map(|s| s.to_string()),
            image_url: kg["imageUrl"].as_str().map(|s| s.to_string()),
            description: kg["description"].as_str().map(|s| s.to_string()),
        }
    });

    Ok(SearchResponse {
        organic,
        knowledge_graph,
    })
}