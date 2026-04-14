use reqwest::multipart;
use std::path::Path;
use thiserror::Error;
use tokio::fs::File;
use tokio::io::AsyncReadExt;

const GROQ_WHISPER_API_URL: &str = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL: &str = "whisper-large-v3-turbo";

#[derive(Error, Debug)]
pub enum TranscriptionError {
    #[error("Failed to read audio file: {0}")]
    FileReadError(String),
    #[error("Failed to create HTTP request: {0}")]
    RequestError(String),
    #[error("API request failed: {0}")]
    ApiError(String),
    #[error("Failed to parse API response: {0}")]
    ParseError(String),
    #[error("API key not configured")]
    MissingApiKey,
}

pub struct TranscriptionResult {
    pub text: String,
}

pub async fn transcribe_audio(audio_path: &str, api_key: &str, client: &reqwest::Client) -> Result<TranscriptionResult, TranscriptionError> {
    let path = Path::new(audio_path);
    if !path.exists() {
        return Err(TranscriptionError::FileReadError(format!(
            "Audio file not found: {}",
            audio_path
        )));
    }

    if api_key.is_empty() {
        return Err(TranscriptionError::MissingApiKey);
    }

    let mut file = File::open(path)
        .await
        .map_err(|e| TranscriptionError::FileReadError(e.to_string()))?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .map_err(|e| TranscriptionError::FileReadError(e.to_string()))?;

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("audio.wav");

    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("wav") => "audio/wav",
        Some("mp3") => "audio/mpeg",
        Some("mp4") | Some("m4a") => "audio/mp4",
        Some("webm") => "audio/webm",
        Some("ogg") => "audio/ogg",
        _ => "audio/wav",
    };

    let file_part = multipart::Part::bytes(buffer)
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|e| TranscriptionError::RequestError(e.to_string()))?;

    let model_part = multipart::Part::text(WHISPER_MODEL);

    let form = reqwest::multipart::Form::new()
        .part("file", file_part)
        .part("model", model_part);

    let response = client
        .post(GROQ_WHISPER_API_URL)
        .header("Authorization", format!("Bearer {}", api_key))
        .multipart(form)
        .send()
        .await
        .map_err(|e| TranscriptionError::RequestError(e.to_string()))?;

    let status = response.status();
    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        return Err(TranscriptionError::ApiError(format!(
            "HTTP {}: {}",
            status, error_text
        )));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| TranscriptionError::ParseError(e.to_string()))?;

    let text = json
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| TranscriptionError::ParseError("Response missing 'text' field".to_string()))?;

    Ok(TranscriptionResult { text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_display() {
        let err = TranscriptionError::MissingApiKey;
        assert_eq!(err.to_string(), "API key not configured");
    }
}