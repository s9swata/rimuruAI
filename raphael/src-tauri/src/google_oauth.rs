//! Google OAuth 2.0 PKCE flow for Gmail access.
//!
//! Flow:
//! 1. `start_oauth_flow` → returns the Google auth URL + starts local axum callback server
//! 2. User opens URL in browser, consents
//! 3. Google redirects to http://127.0.0.1:{port}/callback?code=...
//! 4. axum handler exchanges code for tokens, stores in SecureStore
//! 5. Returns via oneshot channel to signal completion

use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::sync::oneshot;
use axum::{extract::Query, routing::get, Router};
use serde::{Deserialize, Serialize};
use crate::secure_store::SecureStore;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_SCOPE: &str = "https://www.googleapis.com/auth/gmail.send";

#[derive(Deserialize)]
struct CallbackParams {
    code: Option<String>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    token_type: String,
}

/// Generates a PKCE verifier + challenge pair.
/// Returns (verifier, challenge).
fn generate_pkce() -> (String, String) {
    use rand::Rng;
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use sha2::{Sha256, Digest};

    let verifier: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .map(char::from)
        .collect();

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    (verifier, challenge)
}

/// Starts the OAuth flow. Returns the Google authorization URL.
/// Spawns a background axum server that handles the callback and stores tokens.
///
/// `client_id`: from Google Cloud Console
/// `store_dir`: path to raphael data dir (for SecureStore)
pub async fn start_oauth_flow(
    client_id: String,
    client_secret: String,
    store_dir: PathBuf,
) -> Result<String, String> {
    let (verifier, challenge) = generate_pkce();

    // Bind to a random port on localhost
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind callback server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    // Build Google auth URL
    let auth_url = format!(
        "{base}?client_id={client_id}&redirect_uri={redirect}&response_type=code\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256\
         &access_type=offline&prompt=consent",
        base = GOOGLE_AUTH_URL,
        client_id = urlencoding::encode(&client_id),
        redirect = urlencoding::encode(&redirect_uri),
        scope = urlencoding::encode(GMAIL_SEND_SCOPE),
        challenge = challenge,
    );

    // oneshot to signal the axum server to shut down after successful callback
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let shutdown_tx = std::sync::Arc::new(tokio::sync::Mutex::new(Some(shutdown_tx)));

    let client_id_clone = client_id.clone();
    let client_secret_clone = client_secret.clone();
    let redirect_uri_clone = redirect_uri.clone();
    let store_dir_clone = store_dir.clone();
    let shutdown_tx_clone = shutdown_tx.clone();

    tokio::spawn(async move {
        let app = Router::new().route(
            "/callback",
            get(move |Query(params): Query<CallbackParams>| {
                let verifier = verifier.clone();
                let client_id = client_id_clone.clone();
                let client_secret = client_secret_clone.clone();
                let redirect_uri = redirect_uri_clone.clone();
                let store_dir = store_dir_clone.clone();
                let shutdown_tx = shutdown_tx_clone.clone();
                async move {
                    if let Some(err) = params.error {
                        return format!("OAuth error: {err}");
                    }
                    let code = match params.code {
                        Some(c) => c,
                        None => return "Missing code parameter".to_string(),
                    };
                    match exchange_code(code, verifier, client_id, client_secret, redirect_uri, store_dir).await {
                        Ok(_) => {
                            // Signal server to shut down
                            if let Some(tx) = shutdown_tx.lock().await.take() {
                                let _ = tx.send(());
                            }
                            "Authentication successful! You can close this tab.".to_string()
                        }
                        Err(e) => format!("Token exchange failed: {e}"),
                    }
                }
            }),
        );

        axum::serve(listener, app)
            .with_graceful_shutdown(async { let _ = shutdown_rx.await; })
            .await
            .ok();
    });

    // Auto-shutdown the server after 5 minutes regardless
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        if let Some(tx) = shutdown_tx.lock().await.take() {
            let _ = tx.send(());
        }
    });

    Ok(auth_url)
}

/// Exchanges the auth code for access + refresh tokens and stores them.
async fn exchange_code(
    code: String,
    verifier: String,
    client_id: String,
    client_secret: String,
    redirect_uri: String,
    store_dir: PathBuf,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let params = [
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("code_verifier", verifier.as_str()),
        ("grant_type", "authorization_code"),
    ];

    let resp = client
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token endpoint error: {body}"));
    }

    let tokens: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

    let store = SecureStore::new(store_dir).map_err(|e| e)?;
    store.set("google_access_token", &tokens.access_token)?;

    // Compute expiry timestamp (unix seconds), with 60s buffer
    let expiry = chrono::Utc::now().timestamp() as u64 + tokens.expires_in - 60;
    store.set("google_token_expiry", &expiry.to_string())?;

    if let Some(rt) = tokens.refresh_token {
        store.set("google_refresh_token", &rt)?;
    }

    Ok(())
}

/// Returns a valid access token, refreshing if expired.
/// Called from sync Tauri commands — uses block_on via the existing tokio runtime handle.
pub fn get_valid_access_token(store_dir: PathBuf) -> Result<String, String> {
    let store = SecureStore::new(store_dir.clone())?;

    let expiry_str = store
        .get("google_token_expiry")?
        .ok_or("Not authenticated with Google. Use Settings → Connect Gmail.")?;

    let expiry: u64 = expiry_str
        .parse()
        .map_err(|_| "Corrupt token expiry value".to_string())?;

    // Treat "0" as explicitly revoked
    if expiry == 0 {
        return Err("Gmail disconnected. Use Settings → Connect Gmail.".to_string());
    }

    let now = chrono::Utc::now().timestamp() as u64;

    if now < expiry {
        // Token still valid
        let token = store
            .get("google_access_token")?
            .ok_or("Missing access token".to_string())?;
        if token.is_empty() {
            return Err("Gmail disconnected. Use Settings → Connect Gmail.".to_string());
        }
        return Ok(token);
    }

    // Expired — refresh using the tokio runtime
    let rt = tokio::runtime::Handle::try_current()
        .map_err(|_| "No tokio runtime available".to_string())?;
    rt.block_on(refresh_access_token(store_dir))
}

async fn refresh_access_token(store_dir: PathBuf) -> Result<String, String> {
    let store = SecureStore::new(store_dir.clone())?;

    let refresh_token = store
        .get("google_refresh_token")?
        .ok_or("No refresh token — re-authenticate via Settings → Connect Gmail")?;

    if refresh_token.is_empty() {
        return Err("Gmail disconnected. Use Settings → Connect Gmail.".to_string());
    }

    let client_id = store
        .get("google_client_id")?
        .ok_or("Google client_id not configured")?;

    let client_secret = store
        .get("google_client_secret")?
        .ok_or("Google client_secret not configured")?;

    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id.as_str()),
        ("client_secret", client_secret.as_str()),
        ("refresh_token", refresh_token.as_str()),
        ("grant_type", "refresh_token"),
    ];

    let resp = client
        .post(GOOGLE_TOKEN_URL)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token refresh error: {body}"));
    }

    let tokens: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

    store.set("google_access_token", &tokens.access_token)?;
    let expiry = chrono::Utc::now().timestamp() as u64 + tokens.expires_in - 60;
    store.set("google_token_expiry", &expiry.to_string())?;

    Ok(tokens.access_token)
}

/// Returns true if the user has a non-empty refresh token (connected Gmail).
pub fn is_authenticated(store_dir: PathBuf) -> bool {
    SecureStore::new(store_dir)
        .ok()
        .and_then(|s| s.get("google_refresh_token").ok().flatten())
        .map(|t| !t.is_empty())
        .unwrap_or(false)
}

/// Removes all Google OAuth tokens from SecureStore (empty string = sentinel for revoked).
pub fn revoke(store_dir: PathBuf) -> Result<(), String> {
    let store = SecureStore::new(store_dir)?;
    store.set("google_access_token", "")?;
    store.set("google_refresh_token", "")?;
    store.set("google_token_expiry", "0")?;
    Ok(())
}
