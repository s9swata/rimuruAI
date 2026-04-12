use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use rand::rngs::ThreadRng;
use rand::RngCore;
use sha2::Digest;
use sha2::Sha256;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

const APP_SALT: &[u8] = b"raphael-ai-v1-salt-2026";

pub struct SecureStore {
    path: PathBuf,
    key_path: PathBuf,
}

impl SecureStore {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
        let store = Self {
            path: data_dir.join("secrets.enc"),
            key_path: data_dir.join(".raphael.key"),
        };
        store.ensure_key()?;
        Ok(store)
    }

    fn ensure_key(&self) -> Result<(), String> {
        if !self.key_path.exists() {
            let mut key_bytes = [0u8; 32];
            let mut rng = ThreadRng::default();
            rng.fill_bytes(&mut key_bytes);
            fs::write(&self.key_path, hex::encode(key_bytes)).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn load_key(&self) -> Result<Key<Aes256Gcm>, String> {
        let hex_key = fs::read_to_string(&self.key_path).map_err(|e| e.to_string())?;
        let raw = hex::decode(hex_key.trim()).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        hasher.update(&raw);
        hasher.update(APP_SALT);
        let derived = hasher.finalize();
        Ok(*Key::<Aes256Gcm>::from_slice(&derived))
    }

    fn load_secrets(&self) -> Result<HashMap<String, String>, String> {
        if !self.path.exists() {
            return Ok(HashMap::new());
        }
        let ciphertext = fs::read(&self.path).map_err(|e| e.to_string())?;
        if ciphertext.len() < 12 {
            return Ok(HashMap::new());
        }
        let (nonce_bytes, data) = ciphertext.split_at(12);
        let key = self.load_key()?;
        let cipher = Aes256Gcm::new(&key);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plain = cipher.decrypt(nonce, data).map_err(|e| e.to_string())?;
        serde_json::from_slice(&plain).map_err(|e| e.to_string())
    }

    fn save_secrets(&self, secrets: &HashMap<String, String>) -> Result<(), String> {
        let key = self.load_key()?;
        let cipher = Aes256Gcm::new(&key);
        let mut nonce_bytes = [0u8; 12];
        let mut rng = ThreadRng::default();
        rng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plain = serde_json::to_vec(secrets).map_err(|e| e.to_string())?;
        let ciphertext = cipher
            .encrypt(nonce, plain.as_ref())
            .map_err(|e| e.to_string())?;
        let mut out = nonce_bytes.to_vec();
        out.extend(ciphertext);
        fs::write(&self.path, out).map_err(|e| e.to_string())
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, String> {
        let secrets = self.load_secrets()?;
        Ok(secrets.get(key).cloned())
    }

    pub fn set(&self, key: &str, value: &str) -> Result<(), String> {
        let mut secrets = self.load_secrets()?;
        secrets.insert(key.to_string(), value.to_string());
        self.save_secrets(&secrets)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip() {
        let dir = std::env::temp_dir().join("raphael_test");
        std::fs::create_dir_all(&dir).unwrap();
        let store = SecureStore::new(dir).unwrap();
        store.set("groq_key", "sk-test-123").unwrap();
        assert_eq!(
            store.get("groq_key").unwrap().as_deref(),
            Some("sk-test-123")
        );
    }

    #[test]
    fn test_missing_key_returns_none() {
        let dir = std::env::temp_dir().join("raphael_test2");
        std::fs::create_dir_all(&dir).unwrap();
        let store = SecureStore::new(dir).unwrap();
        assert_eq!(store.get("nonexistent").unwrap(), None);
    }
}
