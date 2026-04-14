use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use thiserror::Error;

const APP_NAME: &str = "words-of-world";
const SETTINGS_FILENAME: &str = "settings.json";
const API_KEY_FILENAME: &str = ".groq_api_key";

#[derive(Error, Debug)]
pub enum SettingsError {
    #[error("Failed to access app data directory: {0}")]
    DataDirError(String),
    #[error("Failed to read settings: {0}")]
    ReadError(String),
    #[error("Failed to write settings: {0}")]
    WriteError(String),
    #[error("Failed to parse settings: {0}")]
    ParseError(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing, default)]
    pub groq_api_key: String,
    pub hotkey: String,
    pub push_to_talk: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            groq_api_key: String::new(),
            hotkey: "Alt+Space".to_string(),
            push_to_talk: false,
        }
    }
}

fn data_dir() -> Result<PathBuf, SettingsError> {
    dirs::data_dir().map(|d| d.join(APP_NAME)).ok_or_else(|| {
        SettingsError::DataDirError("Could not determine data directory".to_string())
    })
}

fn settings_path() -> Result<PathBuf, SettingsError> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| SettingsError::DataDirError(e.to_string()))?;
    Ok(dir.join(SETTINGS_FILENAME))
}

fn api_key_path() -> Result<PathBuf, SettingsError> {
    let dir = data_dir()?;
    fs::create_dir_all(&dir).map_err(|e| SettingsError::DataDirError(e.to_string()))?;
    Ok(dir.join(API_KEY_FILENAME))
}

pub fn get_settings() -> Result<AppSettings, SettingsError> {
    let path = settings_path()?;

    let mut settings = if !path.exists() {
        AppSettings::default()
    } else {
        let content = fs::read_to_string(&path).map_err(|e| SettingsError::ReadError(e.to_string()))?;
        serde_json::from_str(&content).map_err(|e| SettingsError::ParseError(e.to_string()))?
    };

    // Load API key from secure storage (not settings.json)
    if let Ok(Some(key)) = get_api_key() {
        settings.groq_api_key = key;
    }

    Ok(settings)
}

pub fn save_settings(settings: &AppSettings) -> Result<(), SettingsError> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| SettingsError::WriteError(e.to_string()))?;
    fs::write(&path, content).map_err(|e| SettingsError::WriteError(e.to_string()))?;

    if !settings.groq_api_key.is_empty() {
        let api_key_path = api_key_path()?;
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&api_key_path)
            .map_err(|e| SettingsError::WriteError(e.to_string()))?;
        file.write_all(settings.groq_api_key.as_bytes())
            .map_err(|e| SettingsError::WriteError(e.to_string()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&api_key_path, fs::Permissions::from_mode(0o600))
                .map_err(|e| SettingsError::WriteError(e.to_string()))?;
        }
    } else {
        // Remove stale key file when key is cleared
        let path = api_key_path()?;
        if path.exists() {
            fs::remove_file(&path).map_err(|e| SettingsError::WriteError(e.to_string()))?;
        }
    }

    Ok(())
}

pub fn get_api_key() -> Result<Option<String>, SettingsError> {
    let path = api_key_path()?;

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path).map_err(|e| SettingsError::ReadError(e.to_string()))?;

    let key = content.trim().to_string();
    if key.is_empty() {
        Ok(None)
    } else {
        Ok(Some(key))
    }
}

pub fn set_api_key(key: &str) -> Result<(), SettingsError> {
    let path = api_key_path()?;

    {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| SettingsError::WriteError(e.to_string()))?;

        file.write_all(key.as_bytes())
            .map_err(|e| SettingsError::WriteError(e.to_string()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| SettingsError::WriteError(e.to_string()))?;
    }

    Ok(())
}

