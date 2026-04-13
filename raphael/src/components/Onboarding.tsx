import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getGmailAuthStatus, startGoogleOAuth } from "../services/index";
import { open as openBrowser } from "@tauri-apps/plugin-shell";

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
      await openBrowser(authUrl);
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
            <button
              onClick={skipGmail}
              style={{ ...btnStyle, background: "var(--bg-chip)", color: "var(--text-muted)" }}
            >
              Skip
            </button>
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
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%", background: "var(--bg-surface)", color: "var(--text)",
          border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
          padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none",
        }}
      />
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
