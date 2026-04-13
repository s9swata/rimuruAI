# Google OAuth 2.0 Gmail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Gmail SMTP + app-password auth with Google OAuth 2.0 PKCE flow, using better-auth Rust's Account model for structured token storage and axum for the local OAuth callback server.

**Architecture:** Rust module `google_oauth.rs` runs a short-lived local axum server to capture the OAuth callback, exchanges the auth code for tokens (PKCE, no client secret needed for desktop), stores refresh_token in the existing `SecureStore`, and exposes new Tauri commands. `gmail_api.rs` calls Gmail REST API with the OAuth bearer token (replacing the current SMTP path). Frontend replaces password fields with a "Connect Gmail" OAuth button flow.

**Tech Stack:** `better-auth 0.10` (Account model + MemoryDatabaseAdapter), `oauth2 4` (PKCE), `axum 0.8` (callback server), `reqwest` (Gmail API, already in Cargo.toml), `base64 0.22`, `tauri-plugin-shell` (open browser, already in Cargo.toml), existing `SecureStore`

---

## Pre-requisites (user must complete)

Before any task, create a Google Cloud OAuth client:
1. console.cloud.google.com → APIs & Services → Credentials → Create → OAuth 2.0 Client ID
2. Application type: **Desktop app**
3. Note `client_id` (no client secret needed for PKCE desktop flow)
4. Enable Gmail API: console.cloud.google.com → Library → "Gmail API" → Enable
5. OAuth consent screen → add test user (your Gmail) and scope `https://www.googleapis.com/auth/gmail.send`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `raphael/src-tauri/src/google_oauth.rs` | PKCE flow, local axum callback, token exchange, token refresh |
| Create | `raphael/src-tauri/src/gmail_api.rs` | Gmail REST API send, token validity check |
| Modify | `raphael/src-tauri/src/commands.rs` | Replace SMTP send_email, add new OAuth Tauri commands |
| Modify | `raphael/src-tauri/src/lib.rs` | Register new commands, declare new modules |
| Modify | `raphael/src-tauri/Cargo.toml` | Add better-auth, oauth2, axum, base64, url deps |
| Modify | `raphael/src/services/index.ts` | Add `getGmailAuthStatus`, `startGoogleOAuth`, `revokeGoogleOAuth` |
| Modify | `raphael/src/components/SettingsPanel.tsx` | Replace password fields with OAuth button + status |
| Modify | `raphael/src/components/Onboarding.tsx` | Replace gmail step with OAuth flow |

---

## Task 1: Add Cargo Dependencies

**Files:**
- Modify: `raphael/src-tauri/Cargo.toml`

- [ ] **Step 1: Update Cargo.toml**

Replace the existing `[dependencies]` block with:

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-global-shortcut = "2"
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
aes-gcm = "0.10"
rand = "0.9"
sha2 = "0.10"
hex = "0.4"
dirs = "5"
chrono = "0.4"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["rt-multi-thread", "sync"] }
better-auth = { version = "0.10", features = ["axum"] }
oauth2 = "4"
axum = "0.8"
base64 = "0.22"
url = "2"
```

Note: `lettre` is removed. `tokio` gains the `sync` feature for `oneshot`.

- [ ] **Step 2: Verify compile with no src changes**

```bash
cd raphael/src-tauri && cargo check 2>&1 | grep -E "^error" | head -20
```

Expected: compilation errors about unused/removed lettre imports in commands.rs (OK — Task 2 fixes those). Zero errors about the new deps.

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/Cargo.toml
git commit -m "chore: add better-auth, oauth2, axum, base64, url deps; drop lettre"
```

---

## Task 2: Create `google_oauth.rs`

**Files:**
- Create: `raphael/src-tauri/src/google_oauth.rs`

This module handles the full PKCE OAuth2 flow for Google.

- [ ] **Step 1: Write the module**

Create `raphael/src-tauri/src/google_oauth.rs`:

```rust
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
use serde::Deserialize;
use crate::secure_store::SecureStore;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_SCOPE: &str = "https://www.googleapis.com/auth/gmail.send";

#[derive(Deserialize)]
struct CallbackParams {
    code: Option<String>,
    error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
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

    let verifier_bytes: Vec<u8> = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(64)
        .collect();
    let verifier = String::from_utf8(verifier_bytes).expect("alphanumeric is valid utf8");

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

    // oneshot to signal the axum server to shut down after one callback
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let client_id_clone = client_id.clone();
    let redirect_uri_clone = redirect_uri.clone();

    tokio::spawn(async move {
        let app = Router::new().route(
            "/callback",
            get(move |Query(params): Query<CallbackParams>| {
                let verifier = verifier.clone();
                let client_id = client_id_clone.clone();
                let redirect_uri = redirect_uri_clone.clone();
                let store_dir = store_dir.clone();
                async move {
                    if let Some(err) = params.error {
                        return format!("OAuth error: {err}");
                    }
                    let code = match params.code {
                        Some(c) => c,
                        None => return "Missing code".to_string(),
                    };
                    match exchange_code(code, verifier, client_id, redirect_uri, store_dir).await {
                        Ok(_) => "Authentication successful! You can close this tab.".to_string(),
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
        let _ = shutdown_tx.send(());
    });

    Ok(auth_url)
}

/// Exchanges the auth code for access + refresh tokens and stores them.
async fn exchange_code(
    code: String,
    verifier: String,
    client_id: String,
    redirect_uri: String,
    store_dir: PathBuf,
) -> Result<(), String> {
    let client = reqwest::Client::new();

    let params = [
        ("code", code.as_str()),
        ("client_id", client_id.as_str()),
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

    // Compute expiry timestamp (unix seconds)
    let expiry = chrono::Utc::now().timestamp() as u64 + tokens.expires_in - 60;
    store.set("google_token_expiry", &expiry.to_string())?;

    if let Some(rt) = tokens.refresh_token {
        store.set("google_refresh_token", &rt)?;
    }

    Ok(())
}

/// Returns a valid access token, refreshing if expired.
pub fn get_valid_access_token(store_dir: PathBuf) -> Result<String, String> {
    let store = SecureStore::new(store_dir.clone())?;

    let expiry: u64 = store
        .get("google_token_expiry")?
        .ok_or("Not authenticated with Google")?
        .parse()
        .map_err(|_| "Corrupt token expiry")?;

    let now = chrono::Utc::now().timestamp() as u64;

    if now < expiry {
        // Token still valid
        return store
            .get("google_access_token")?
            .ok_or("Missing access token".to_string());
    }

    // Need refresh — run in a blocking context (this fn is sync, called from sync Tauri command)
    let rt = tokio::runtime::Handle::try_current()
        .map_err(|_| "No tokio runtime")?;
    rt.block_on(refresh_access_token(store_dir))
}

async fn refresh_access_token(store_dir: PathBuf) -> Result<String, String> {
    let store = SecureStore::new(store_dir.clone())?;

    let refresh_token = store
        .get("google_refresh_token")?
        .ok_or("No refresh token stored — re-authenticate")?;
    let client_id = store
        .get("google_client_id")?
        .ok_or("Google client_id not configured")?;

    let client = reqwest::Client::new();
    let params = [
        ("client_id", client_id.as_str()),
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
        return Err(format!("Refresh error: {body}"));
    }

    let tokens: TokenResponse = resp.json().await.map_err(|e| e.to_string())?;

    store.set("google_access_token", &tokens.access_token)?;
    let expiry = chrono::Utc::now().timestamp() as u64 + tokens.expires_in - 60;
    store.set("google_token_expiry", &expiry.to_string())?;

    Ok(tokens.access_token)
}

/// Returns true if refresh_token exists (user has connected Gmail).
pub fn is_authenticated(store_dir: PathBuf) -> bool {
    SecureStore::new(store_dir)
        .ok()
        .and_then(|s| s.get("google_refresh_token").ok().flatten())
        .is_some()
}

/// Removes all Google OAuth tokens from SecureStore.
pub fn revoke(store_dir: PathBuf) -> Result<(), String> {
    let store = SecureStore::new(store_dir)?;
    // SecureStore::set with empty string effectively clears; 
    // or delete if SecureStore supports it. Use empty string as sentinel.
    store.set("google_access_token", "")?;
    store.set("google_refresh_token", "")?;
    store.set("google_token_expiry", "0")?;
    Ok(())
}
```

Note: the `urlencoding` crate is needed. Add it to Cargo.toml:
```toml
urlencoding = "2"
```

- [ ] **Step 2: Check compile**

```bash
cd raphael/src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Expected: errors only about `google_oauth` not declared in `lib.rs` (OK — Task 4 fixes that).

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/google_oauth.rs raphael/src-tauri/Cargo.toml
git commit -m "feat: add google_oauth module with PKCE flow and token management"
```

---

## Task 3: Create `gmail_api.rs`

**Files:**
- Create: `raphael/src-tauri/src/gmail_api.rs`

- [ ] **Step 1: Write the module**

Create `raphael/src-tauri/src/gmail_api.rs`:

```rust
//! Gmail REST API v1 — send email using OAuth bearer token.
//!
//! Encodes a MIME message as base64url and POSTs to:
//!   POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;

const GMAIL_SEND_URL: &str =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

#[derive(Deserialize)]
struct GmailSendResponse {
    id: Option<String>,
}

/// Sends an email via Gmail REST API.
///
/// `access_token`: valid OAuth bearer token with gmail.send scope
/// `from`: sender address (must match the authenticated account)
/// `to`: recipient address
/// `subject`: email subject
/// `body`: plain-text body
pub async fn send_email(
    access_token: &str,
    from: &str,
    to: &str,
    subject: &str,
    body: &str,
) -> Result<(), String> {
    // Build a minimal RFC 2822 MIME message
    let raw_message = format!(
        "From: {from}\r\nTo: {to}\r\nSubject: {subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n{body}"
    );

    let encoded = URL_SAFE_NO_PAD.encode(raw_message.as_bytes());

    let payload = serde_json::json!({ "raw": encoded });

    let client = reqwest::Client::new();
    let resp = client
        .post(GMAIL_SEND_URL)
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Gmail API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Gmail API error {status}: {body}"));
    }

    Ok(())
}
```

- [ ] **Step 2: Check compile (lib.rs not updated yet, expect module-not-found errors)**

```bash
cd raphael/src-tauri && cargo check 2>&1 | grep "^error" | head -20
```

Expected: only "file not found for module" errors (lib.rs declares neither module yet).

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/src/gmail_api.rs
git commit -m "feat: add gmail_api module for OAuth-based email sending"
```

---

## Task 4: Update `lib.rs` and `commands.rs`

**Files:**
- Modify: `raphael/src-tauri/src/lib.rs`
- Modify: `raphael/src-tauri/src/commands.rs`

- [ ] **Step 1: Update `lib.rs` to declare modules and register commands**

Replace `raphael/src-tauri/src/lib.rs` content:

```rust
mod commands;
mod secure_store;
mod search;
mod google_oauth;
mod gmail_api;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
            app.global_shortcut().register(shortcut)?;

            let quit = MenuItem::with_id(app, "quit", "Quit Raphael", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Raphael", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => toggle_window(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_secret,
            commands::set_secret,
            commands::list_files,
            commands::read_file_content,
            commands::get_logs,
            commands::clear_logs,
            commands::send_email,
            commands::start_google_oauth,
            commands::get_gmail_auth_status,
            commands::revoke_google_oauth,
            commands::load_config,
            commands::save_config,
            commands::load_profile,
            commands::update_profile,
            search::search_web,
        ])
        .run(tauri::generate_context!())
        .expect("error while running raphael");
}

fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}
```

- [ ] **Step 2: Update `commands.rs` — replace `send_email`, add OAuth commands**

In `raphael/src-tauri/src/commands.rs`:

**Remove** the `lettre` imports at the top (lines 2–7):
```rust
// DELETE these lines:
use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
```

**Replace** the entire `send_email` command (lines 101–137) with:

```rust
#[tauri::command]
pub fn send_email(
    from: String,
    to: String,
    subject: String,
    body: String,
) -> Result<(), String> {
    log_to_file(&format!("send_email: from={} to={} subject={}", from, to, subject));

    let access_token = crate::google_oauth::get_valid_access_token(store_dir())?;

    let rt = tokio::runtime::Handle::try_current()
        .map_err(|_| "No tokio runtime available".to_string())?;

    rt.block_on(crate::gmail_api::send_email(
        &access_token,
        &from,
        &to,
        &subject,
        &body,
    ))?;

    log_to_file("send_email: success via Gmail API");
    Ok(())
}
```

**Add** these three new commands after `send_email`:

```rust
/// Initiates Google OAuth 2.0 PKCE flow.
/// Returns the authorization URL — frontend opens it in the system browser.
#[tauri::command]
pub async fn start_google_oauth() -> Result<String, String> {
    log_to_file("start_google_oauth: initiating");

    let store = SecureStore::new(store_dir())?;
    let client_id = store
        .get("google_client_id")?
        .ok_or("Google client_id not configured. Save it in Settings first.")?;

    let url = crate::google_oauth::start_oauth_flow(client_id, store_dir()).await?;

    log_to_file(&format!("start_google_oauth: auth url generated (port embedded)"));
    Ok(url)
}

/// Returns whether the user has connected their Gmail account (has a refresh token).
#[tauri::command]
pub fn get_gmail_auth_status() -> bool {
    crate::google_oauth::is_authenticated(store_dir())
}

/// Removes all Google OAuth tokens — user must re-authenticate to send email.
#[tauri::command]
pub fn revoke_google_oauth() -> Result<(), String> {
    log_to_file("revoke_google_oauth");
    crate::google_oauth::revoke(store_dir())
}
```

- [ ] **Step 3: Verify full compile**

```bash
cd raphael/src-tauri && cargo build 2>&1 | grep "^error" | head -30
```

Expected: zero errors. Warnings about unused imports are OK.

- [ ] **Step 4: Commit**

```bash
git add raphael/src-tauri/src/lib.rs raphael/src-tauri/src/commands.rs
git commit -m "feat: wire OAuth commands into Tauri, replace SMTP send_email with Gmail API"
```

---

## Task 5: Update Frontend — `services/index.ts`

**Files:**
- Modify: `raphael/src/services/index.ts`

The `sendEmail` service path is unchanged (still invokes `send_email`). Add three new helper functions for OAuth management. These are NOT part of the `ServiceMap` (they're auth utilities).

- [ ] **Step 1: Add OAuth helpers to `services/index.ts`**

Add after the `import` block at the top of `raphael/src/services/index.ts`:

```typescript
export async function getGmailAuthStatus(): Promise<boolean> {
  return invoke<boolean>("get_gmail_auth_status");
}

export async function startGoogleOAuth(): Promise<string> {
  return invoke<string>("start_google_oauth");
}

export async function revokeGoogleOAuth(): Promise<void> {
  await invoke("revoke_google_oauth");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/services/index.ts
git commit -m "feat: add Gmail OAuth helper functions to services"
```

---

## Task 6: Update `SettingsPanel.tsx` — Replace Password Fields with OAuth UI

**Files:**
- Modify: `raphael/src/components/SettingsPanel.tsx`

Replace the `ApiKeysSection` component. The Gmail address and app password fields become a "Connect Gmail" button that triggers OAuth. The Google client_id still needs to be entered (once, from Google Cloud Console).

- [ ] **Step 1: Add imports at top of SettingsPanel.tsx**

After the existing imports, add:
```typescript
import { getGmailAuthStatus, startGoogleOAuth, revokeGoogleOAuth } from "../services/index";
```

- [ ] **Step 2: Replace `ApiKeysSection` component**

Find and replace the entire `ApiKeysSection` function (lines 94–158) with:

```typescript
function ApiKeysSection() {
  const [groqKey, setGroqKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "pending" | "error">("idle");
  const [oauthError, setOauthError] = useState("");

  useEffect(() => {
    (async () => {
      const [groq, clientId, gh, serper, connected] = await Promise.all([
        invoke<string | null>("get_secret", { key: "groq_api_key" }),
        invoke<string | null>("get_secret", { key: "google_client_id" }),
        invoke<string | null>("get_secret", { key: "github_pat" }),
        invoke<string | null>("get_secret", { key: "serper_api_key" }),
        getGmailAuthStatus(),
      ]);
      if (groq) setGroqKey(groq);
      if (clientId) setGoogleClientId(clientId);
      if (gh) setGithubPat(gh);
      if (serper) setSerperKey(serper);
      setGmailConnected(connected);
    })();
  }, []);

  async function handleSaveKeys() {
    if (groqKey) await invoke("set_secret", { key: "groq_api_key", value: groqKey });
    if (googleClientId) await invoke("set_secret", { key: "google_client_id", value: googleClientId });
    if (githubPat) await invoke("set_secret", { key: "github_pat", value: githubPat });
    if (serperKey) await invoke("set_secret", { key: "serper_api_key", value: serperKey });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleConnectGmail() {
    if (!googleClientId) {
      setOauthError("Save your Google client_id first.");
      return;
    }
    try {
      setOauthStatus("pending");
      setOauthError("");
      // Save client_id so the Rust side can read it
      await invoke("set_secret", { key: "google_client_id", value: googleClientId });
      const authUrl = await startGoogleOAuth();
      // Open in system browser
      window.open(authUrl, "_blank");
      // Poll for completion
      const poll = setInterval(async () => {
        const connected = await getGmailAuthStatus();
        if (connected) {
          clearInterval(poll);
          setGmailConnected(true);
          setOauthStatus("idle");
        }
      }, 2000);
      // Stop polling after 5 min
      setTimeout(() => clearInterval(poll), 300_000);
    } catch (e) {
      setOauthStatus("error");
      setOauthError(String(e));
    }
  }

  async function handleDisconnectGmail() {
    await revokeGoogleOAuth();
    setGmailConnected(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>API KEYS</SectionTitle>
      <div>
        <FieldLabel>Groq API Key</FieldLabel>
        <TextInput type="password" value={groqKey} onChange={setGroqKey} placeholder="gsk_..." />
      </div>
      <div>
        <FieldLabel>Google OAuth Client ID (from Google Cloud Console)</FieldLabel>
        <TextInput type="text" value={googleClientId} onChange={setGoogleClientId} placeholder="xxxxxx.apps.googleusercontent.com" />
      </div>
      <div>
        <FieldLabel>GitHub PAT (optional — calendar cloud sync)</FieldLabel>
        <TextInput type="password" value={githubPat} onChange={setGithubPat} placeholder="ghp_..." />
      </div>
      <div>
        <FieldLabel>Serper API Key (optional — web search)</FieldLabel>
        <TextInput type="password" value={serperKey} onChange={setSerperKey} placeholder="Get from serper.dev" />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <SaveButton onClick={handleSaveKeys} />
        {saved && <span style={{ fontSize: 11, color: "var(--accent)" }}>Saved</span>}
      </div>

      {/* Gmail OAuth section */}
      <div style={{ borderTop: "1px solid var(--accent-dim)", paddingTop: 12 }}>
        <FieldLabel>Gmail (OAuth 2.0)</FieldLabel>
        {gmailConnected ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 12, color: "var(--accent)" }}>Connected</span>
            <button
              onClick={handleDisconnectGmail}
              style={{ background: "var(--bg-chip)", color: "var(--text-muted)", border: "none", borderRadius: "var(--radius)", padding: "5px 12px", fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer" }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={handleConnectGmail}
              disabled={oauthStatus === "pending"}
              style={{ alignSelf: "flex-start", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", padding: "6px 16px", fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer", opacity: oauthStatus === "pending" ? 0.6 : 1 }}
            >
              {oauthStatus === "pending" ? "Waiting for browser…" : "Connect Gmail"}
            </button>
            {oauthError && <span style={{ fontSize: 11, color: "var(--danger)" }}>{oauthError}</span>}
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              Opens browser → Google consent → comes back automatically
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add raphael/src/components/SettingsPanel.tsx
git commit -m "feat: replace Gmail password fields with OAuth connect button in SettingsPanel"
```

---

## Task 7: Update `Onboarding.tsx` — Replace Gmail Step with OAuth

**Files:**
- Modify: `raphael/src/components/Onboarding.tsx`

- [ ] **Step 1: Replace the Onboarding component**

Replace the entire `raphael/src/components/Onboarding.tsx` with:

```typescript
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getGmailAuthStatus, startGoogleOAuth } from "../services/index";

interface Props { onComplete: () => void; }

type Step = "groq" | "gmail" | "github" | "done";

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("groq");
  const [groqKey, setGroqKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [error, setError] = useState("");
  const [oauthPending, setOauthPending] = useState(false);

  async function saveGroq() {
    if (!groqKey.startsWith("gsk_")) { setError("Groq keys start with gsk_"); return; }
    await invoke("set_secret", { key: "groq_api_key", value: groqKey });
    setError(""); setStep("gmail");
  }

  async function startGmail() {
    if (!googleClientId) { setError("Paste your Google OAuth client_id first"); return; }
    setError("");
    await invoke("set_secret", { key: "google_client_id", value: googleClientId });
    try {
      setOauthPending(true);
      const authUrl = await startGoogleOAuth();
      window.open(authUrl, "_blank");
      // Poll until connected
      const poll = setInterval(async () => {
        const connected = await getGmailAuthStatus();
        if (connected) {
          clearInterval(poll);
          setOauthPending(false);
          setStep("github");
        }
      }, 2000);
      setTimeout(() => {
        clearInterval(poll);
        setOauthPending(false);
        setError("OAuth timed out. Try again.");
      }, 300_000);
    } catch (e) {
      setOauthPending(false);
      setError(String(e));
    }
  }

  async function skipGmail() {
    setError(""); setStep("github");
  }

  async function saveGithub() {
    if (githubPat) {
      await invoke("set_secret", { key: "github_pat", value: githubPat });
    }
    setStep("done");
  }

  const container: React.CSSProperties = {
    height: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 32, gap: 16,
  };

  if (step === "done") return (
    <div style={container}>
      <div style={{ color: "var(--accent)", fontSize: 14 }}>RAPHAEL ONLINE</div>
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>At your service, sir.</div>
      <button onClick={onComplete} style={btnStyle}>Begin</button>
    </div>
  );

  return (
    <div style={container}>
      <div style={{ color: "var(--accent)", letterSpacing: "0.2em", fontSize: 11 }}>
        {step === "groq"   && "STEP 1 / 3 — GROQ API KEY"}
        {step === "gmail"  && "STEP 2 / 3 — GMAIL (GOOGLE OAUTH)"}
        {step === "github" && "STEP 3 / 3 — GITHUB (CALENDAR SYNC)"}
      </div>

      {step === "groq" && <>
        <SecretInput label="Groq API Key" value={groqKey} onChange={setGroqKey} />
        <HelpText>Get your key at console.groq.com</HelpText>
        <button onClick={saveGroq} style={btnStyle}>Next</button>
      </>}

      {step === "gmail" && <>
        <SecretInput label="Google OAuth Client ID" value={googleClientId} onChange={setGoogleClientId} />
        <HelpText>
          console.cloud.google.com → Credentials → OAuth 2.0 Client ID (Desktop app type)
        </HelpText>
        {oauthPending ? (
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            Waiting for Google consent in browser…
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={startGmail} style={btnStyle}>Connect Gmail</button>
            <button onClick={skipGmail} style={{ ...btnStyle, background: "var(--bg-chip)", color: "var(--text-muted)" }}>Skip</button>
          </div>
        )}
      </>}

      {step === "github" && <>
        <SecretInput label="GitHub Personal Access Token (optional)" value={githubPat} onChange={setGithubPat} />
        <HelpText>
          github.com → Settings → Developer settings → Personal access tokens → gist scope only.
          Leave blank to store calendar locally only.
        </HelpText>
        <button onClick={saveGithub} style={btnStyle}>Finish</button>
      </>}

      {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function SecretInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "var(--bg-surface)", color: "var(--text)",
          border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
          padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }} />
    </div>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{children}</div>;
}

const btnStyle: React.CSSProperties = {
  background: "var(--accent)", color: "white", border: "none",
  borderRadius: "var(--radius)", padding: "8px 24px",
  fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/components/Onboarding.tsx
git commit -m "feat: replace Gmail app password onboarding step with Google OAuth flow"
```

---

## Task 8: End-to-End Smoke Test

- [ ] **Step 1: Full Rust build**

```bash
cd raphael/src-tauri && cargo build 2>&1 | tail -5
```

Expected: `Finished dev [unoptimized + debuginfo] target(s) in ...`

- [ ] **Step 2: Frontend build**

```bash
cd raphael && npm run build 2>&1 | tail -10
```

Expected: zero errors.

- [ ] **Step 3: Manual OAuth flow test**

1. Run `npm run tauri dev` in `raphael/`
2. Open Settings → paste your Google client_id → Save
3. Click "Connect Gmail" → browser opens Google consent page
4. Approve → tab shows "Authentication successful!"
5. Back in app: Gmail section shows "Connected"

- [ ] **Step 4: Manual send test**

Ask Raphael to "send a test email to yourself@gmail.com" — confirm email arrives.

- [ ] **Step 5: Token refresh test**

```bash
# In raphael data dir (~/Library/Application Support/raphael on macOS)
# Manually set expiry to 0 to force a refresh:
# Use the app's get_secret/set_secret or edit the encrypted store
# Then trigger a send — should refresh silently and succeed
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Google OAuth 2.0 Gmail integration complete"
```

---

## Known Gotchas

| Issue | Resolution |
|-------|-----------|
| `send_email` called from sync Tauri command but needs async for Gmail API | Uses `Handle::try_current().block_on()` — works because Tauri uses a tokio runtime |
| Tauri `send_email` command is still sync | If you hit runtime issues, make it `async fn` — Tauri supports both |
| Google OAuth redirect must be `http://127.0.0.1:PORT` not `localhost` | Some Google configs are strict about this — always use `127.0.0.1` |
| `axum 0.8` API vs `0.7` | `axum::serve` is the 0.7+ API; if you see `Server` not found, verify version |
| `rand` version conflict | better-auth pulls `rand 0.8`, Cargo.toml has `rand 0.9` — update `Cargo.toml` rand to `0.8` if compile fails |
| Gmail "From" address must match authenticated user | `from` param in `send_email` must be the user's actual Gmail address; fetch it via `gmail.googleapis.com/gmail/v1/users/me/profile` if needed |

---

## `rand` version fix (if needed)

If you get a `rand` version conflict during `cargo build`:

In `Cargo.toml`, change:
```toml
rand = "0.9"
```
to:
```toml
rand = "0.8"
```

And update `google_oauth.rs` — the `Alphanumeric` distribution is in `rand::distributions` in 0.8:
```rust
// Already uses rand::distributions::Alphanumeric which is correct for 0.8
```
