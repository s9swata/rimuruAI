//! Gmail REST API v1 — send email using OAuth bearer token.
//!
//! Encodes a MIME message as base64url and POSTs to:
//!   POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};

const GMAIL_SEND_URL: &str =
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

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
