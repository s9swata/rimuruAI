import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getGmailAuthStatus, startGoogleOAuth, revokeGoogleOAuth } from "../../services/index";
import { open as openBrowser } from "@tauri-apps/plugin-shell";
import { SectionTitle, FieldLabel, TextInput, TextArea, SaveButton, keyCount } from "./settingsShared";

export default function ApiKeysSection() {
  const [groqKey, setGroqKey] = useState("");
  const [cerebrasKey, setCerebrasKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [nvidiaKey, setNvidiaKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "pending" | "error">("idle");
  const [oauthError, setOauthError] = useState("");

  function parseKeysFromStorage(stored: string | null): string {
    if (!stored) return "";
    try {
      const arr = JSON.parse(stored);
      if (Array.isArray(arr)) return arr.filter(Boolean).join("\n");
    } catch {}
    return stored.trim();
  }

  function serializeKeysForStorage(textarea: string): string {
    const keys = textarea.split("\n").map(k => k.trim()).filter(Boolean);
    return JSON.stringify(keys);
  }

  useEffect(() => {
    (async () => {
      const [groq, cerebras, openai, anthropic, openrouter, nvidia, gemini, clientId, clientSecret, gh, serper, connected] = await Promise.all([
        invoke<string | null>("get_secret", { key: "groq_api_key" }),
        invoke<string | null>("get_secret", { key: "cerebras_api_key" }),
        invoke<string | null>("get_secret", { key: "openai_api_key" }),
        invoke<string | null>("get_secret", { key: "anthropic_api_key" }),
        invoke<string | null>("get_secret", { key: "openrouter_api_key" }),
        invoke<string | null>("get_secret", { key: "nvidia_api_key" }),
        invoke<string | null>("get_secret", { key: "gemini_api_key" }),
        invoke<string | null>("get_secret", { key: "google_client_id" }),
        invoke<string | null>("get_secret", { key: "google_client_secret" }),
        invoke<string | null>("get_secret", { key: "github_pat" }),
        invoke<string | null>("get_secret", { key: "serper_api_key" }),
        getGmailAuthStatus(),
      ]);
      setGroqKey(parseKeysFromStorage(groq));
      setCerebrasKey(parseKeysFromStorage(cerebras));
      setOpenaiKey(parseKeysFromStorage(openai));
      setAnthropicKey(parseKeysFromStorage(anthropic));
      setOpenrouterKey(parseKeysFromStorage(openrouter));
      setNvidiaKey(parseKeysFromStorage(nvidia));
      setGeminiKey(parseKeysFromStorage(gemini));
      if (clientId) setGoogleClientId(clientId);
      if (clientSecret) setGoogleClientSecret(clientSecret);
      if (gh) setGithubPat(gh);
      if (serper) setSerperKey(serper);
      setGmailConnected(connected);
    })();
  }, []);

  async function handleSaveKeys() {
    if (groqKey) await invoke("set_secret", { key: "groq_api_key", value: serializeKeysForStorage(groqKey) });
    if (cerebrasKey) await invoke("set_secret", { key: "cerebras_api_key", value: serializeKeysForStorage(cerebrasKey) });
    if (openaiKey) await invoke("set_secret", { key: "openai_api_key", value: serializeKeysForStorage(openaiKey) });
    if (anthropicKey) await invoke("set_secret", { key: "anthropic_api_key", value: serializeKeysForStorage(anthropicKey) });
    if (openrouterKey) await invoke("set_secret", { key: "openrouter_api_key", value: serializeKeysForStorage(openrouterKey) });
    if (nvidiaKey) await invoke("set_secret", { key: "nvidia_api_key", value: serializeKeysForStorage(nvidiaKey) });
    if (geminiKey) await invoke("set_secret", { key: "gemini_api_key", value: serializeKeysForStorage(geminiKey) });
    if (googleClientId) await invoke("set_secret", { key: "google_client_id", value: googleClientId });
    if (googleClientSecret) await invoke("set_secret", { key: "google_client_secret", value: googleClientSecret });
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
      await invoke("set_secret", { key: "google_client_id", value: googleClientId });
      if (googleClientSecret) await invoke("set_secret", { key: "google_client_secret", value: googleClientSecret });
      const authUrl = await startGoogleOAuth();
      await openBrowser(authUrl);
      const poll = setInterval(async () => {
        const connected = await getGmailAuthStatus();
        if (connected) {
          clearInterval(poll);
          setGmailConnected(true);
          setOauthStatus("idle");
        }
      }, 2000);
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <FieldLabel>Groq API Keys (primary){keyCount(groqKey)}</FieldLabel>
          <TextArea value={groqKey} onChange={setGroqKey} placeholder={"gsk_...\ngsk_..."} rows={2} />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>One key per line</div>
        </div>
        <div>
          <FieldLabel>Cerebras API Keys (free){keyCount(cerebrasKey)}</FieldLabel>
          <TextArea value={cerebrasKey} onChange={setCerebrasKey} placeholder={"csk-...\ncsk-..."} rows={2} />
        </div>
        <div>
          <FieldLabel>OpenAI API Keys{keyCount(openaiKey)}</FieldLabel>
          <TextArea value={openaiKey} onChange={setOpenaiKey} placeholder={"sk-...\nsk-..."} rows={2} />
        </div>
        <div>
          <FieldLabel>Anthropic (Claude) API Keys{keyCount(anthropicKey)}</FieldLabel>
          <TextArea value={anthropicKey} onChange={setAnthropicKey} placeholder={"sk-ant-api03-...\nsk-ant-..."} rows={2} />
        </div>
        <div>
          <FieldLabel>OpenRouter API Keys{keyCount(openrouterKey)}</FieldLabel>
          <TextArea value={openrouterKey} onChange={setOpenrouterKey} placeholder={"sk-or-v1-...\nsk-or-..."} rows={2} />
        </div>
        <div>
          <FieldLabel>NVIDIA API Keys{keyCount(nvidiaKey)}</FieldLabel>
          <TextArea value={nvidiaKey} onChange={setNvidiaKey} placeholder={"nvapi-...\nnvapi-..."} rows={2} />
        </div>
        <div>
          <FieldLabel>Gemini API Keys (fallback){keyCount(geminiKey)}</FieldLabel>
          <TextArea value={geminiKey} onChange={setGeminiKey} placeholder={"AIza...\nAIza..."} rows={2} />
        </div>
      </div>
      <div>
        <FieldLabel>Google OAuth Client ID</FieldLabel>
        <TextInput type="text" value={googleClientId} onChange={setGoogleClientId} placeholder="xxxxxx.apps.googleusercontent.com" />
      </div>
      <div>
        <FieldLabel>Google OAuth Client Secret</FieldLabel>
        <TextInput type="password" value={googleClientSecret} onChange={setGoogleClientSecret} placeholder="GOCSPX-..." />
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
              Opens browser → Google consent → returns automatically
            </span>
          </div>
        )}
      </div>
    </div>
  );
}