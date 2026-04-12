import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
interface Props { onComplete: () => void; }

type Step = "groq" | "google" | "x" | "folders" | "done";

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("groq");
  const [groqKey, setGroqKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [xBearerToken, setXBearerToken] = useState("");
  const [folders, setFolders] = useState("");
  const [error, setError] = useState("");

  async function saveGroq() {
    if (!groqKey.startsWith("gsk_")) { setError("Groq keys start with gsk_"); return; }
    await invoke("set_secret", { key: "groq_api_key", value: groqKey });
    setError(""); setStep("google");
  }

  async function saveGoogle() {
    if (!googleClientId) { setError("Client ID required"); return; }
    await invoke("set_secret", { key: "google_client_id", value: googleClientId });
    await invoke("set_secret", { key: "google_client_secret", value: googleClientSecret });
    setError(""); setStep("x");
  }

  async function saveX() {
    if (xBearerToken) {
      await invoke("set_secret", { key: "x_bearer_token", value: xBearerToken });
    }
    setStep("folders");
  }

  async function saveFolders() {
    const list = folders.split("\n").map((f) => f.trim()).filter(Boolean);
    await invoke("set_secret", { key: "watched_folders", value: JSON.stringify(list) });
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
        {step === "groq" && "STEP 1 / 4 — GROQ API KEY"}
        {step === "google" && "STEP 2 / 4 — GOOGLE OAUTH"}
        {step === "x" && "STEP 3 / 4 — X.COM (OPTIONAL)"}
        {step === "folders" && "STEP 4 / 4 — WATCHED FOLDERS"}
      </div>

      {step === "groq" && <>
        <SecretInput label="Groq API Key" value={groqKey} onChange={setGroqKey} />
        <HelpText>Get your key at console.groq.com</HelpText>
        <button onClick={saveGroq} style={btnStyle}>Next</button>
      </>}

      {step === "google" && <>
        <SecretInput label="Google Client ID" value={googleClientId} onChange={setGoogleClientId} />
        <SecretInput label="Google Client Secret" value={googleClientSecret} onChange={setGoogleClientSecret} />
        <HelpText>Create an OAuth 2.0 app at console.cloud.google.com (testing mode, free)</HelpText>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={saveGoogle} style={btnStyle}>Next</button>
        </div>
      </>}

      {step === "x" && <>
        <SecretInput label="X Bearer Token (optional)" value={xBearerToken} onChange={setXBearerToken} />
        <HelpText>Leave blank to skip X.com integration</HelpText>
        <button onClick={saveX} style={btnStyle}>Next</button>
      </>}

      {step === "folders" && <>
        <div style={{ color: "var(--text-muted)", fontSize: 12 }}>One folder path per line</div>
        <textarea value={folders} onChange={(e) => setFolders(e.target.value)} rows={4}
          style={{ width: "100%", background: "var(--bg-surface)", color: "var(--text)",
            border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
            padding: "8px", fontFamily: "var(--font-mono)", fontSize: 12, resize: "none" }} />
        <button onClick={saveFolders} style={btnStyle}>Finish</button>
      </>}

      {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function SecretInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "var(--bg-surface)", color: "var(--text)",
          border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
          padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }} />
    </div>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{children}</div>;
}

const btnStyle: React.CSSProperties = {
  background: "var(--accent)", color: "white", border: "none",
  borderRadius: "var(--radius)", padding: "8px 24px",
  fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
};