import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RaphaelConfig, TrustLevel, applyTrustLevel } from "../config/types";
import { saveConfig } from "../config/loader";

interface Props {
  config: RaphaelConfig;
  onClose: () => void;
  onSave: (config: RaphaelConfig) => void;
}

// ── Shared primitives ────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--accent)", marginBottom: 12 }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{children}</div>;
}

function TextInput({ value, onChange, type = "text", placeholder }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: "var(--bg-surface)", color: "var(--text)",
        border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
        padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none",
      }}
    />
  );
}

function Segment<T extends string>({ options, value, onChange }: {
  options: readonly T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--bg-chip)", borderRadius: "var(--radius)", padding: 3 }}>
      {options.map((opt) => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          flex: 1, padding: "4px 0", fontSize: 11, border: "none", cursor: "pointer",
          borderRadius: 6, fontFamily: "var(--font-mono)", textTransform: "capitalize",
          background: value === opt ? "var(--accent)" : "transparent",
          color: value === opt ? "white" : "var(--text-muted)",
          transition: "background 0.15s",
        }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer",
      background: value ? "var(--accent)" : "var(--accent-dim)",
      position: "relative", transition: "background 0.2s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 3, left: value ? 17 : 3,
        width: 12, height: 12, borderRadius: "50%", background: "white",
        transition: "left 0.2s",
      }} />
    </button>
  );
}

function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      alignSelf: "flex-start", background: "var(--accent)", color: "white", border: "none",
      borderRadius: "var(--radius)", padding: "6px 20px",
      fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", marginTop: 4,
    }}>
      Save
    </button>
  );
}

// ── API Keys section ─────────────────────────────────────────────────────────

function ApiKeysSection() {
  const [groqKey, setGroqKey] = useState("");
  const [gmailAddress, setGmailAddress] = useState("");
  const [gmailPassword, setGmailPassword] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const [groq, gmail, pass, gh] = await Promise.all([
        invoke<string | null>("get_secret", { key: "groq_api_key" }),
        invoke<string | null>("get_secret", { key: "gmail_address" }),
        invoke<string | null>("get_secret", { key: "gmail_app_password" }),
        invoke<string | null>("get_secret", { key: "github_pat" }),
      ]);
      if (groq) setGroqKey(groq);
      if (gmail) setGmailAddress(gmail);
      if (pass) setGmailPassword(pass);
      if (gh) setGithubPat(gh);
    })();
  }, []);

  async function handleSave() {
    if (groqKey) await invoke("set_secret", { key: "groq_api_key", value: groqKey });
    if (gmailAddress) await invoke("set_secret", { key: "gmail_address", value: gmailAddress });
    if (gmailPassword) await invoke("set_secret", { key: "gmail_app_password", value: gmailPassword });
    if (githubPat) await invoke("set_secret", { key: "github_pat", value: githubPat });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>API KEYS</SectionTitle>
      <div>
        <FieldLabel>Groq API Key</FieldLabel>
        <TextInput type="password" value={groqKey} onChange={setGroqKey} placeholder="gsk_..." />
      </div>
      <div>
        <FieldLabel>Gmail Address</FieldLabel>
        <TextInput type="text" value={gmailAddress} onChange={setGmailAddress} placeholder="you@gmail.com" />
      </div>
      <div>
        <FieldLabel>Gmail App Password</FieldLabel>
        <TextInput type="password" value={gmailPassword} onChange={setGmailPassword} placeholder="xxxx xxxx xxxx xxxx" />
      </div>
      <div>
        <FieldLabel>GitHub PAT (optional — calendar cloud sync)</FieldLabel>
        <TextInput type="password" value={githubPat} onChange={setGithubPat} placeholder="ghp_..." />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <SaveButton onClick={handleSave} />
        {saved && <span style={{ fontSize: 11, color: "var(--accent)" }}>Saved</span>}
      </div>
    </div>
  );
}

// ── Persona section ──────────────────────────────────────────────────────────

function PersonaSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [address, setAddress] = useState(config.persona.address);
  const [tone, setTone] = useState(config.persona.tone);
  const [verbosity, setVerbosity] = useState(config.persona.verbosity);

  async function handleSave() {
    const updated: RaphaelConfig = { ...config, persona: { address, tone, verbosity } };
    await saveConfig(updated);
    onSave(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>PERSONA</SectionTitle>
      <div>
        <FieldLabel>Address (how Raphael calls you)</FieldLabel>
        <TextInput value={address} onChange={setAddress} placeholder="sir" />
      </div>
      <div>
        <FieldLabel>Tone</FieldLabel>
        <Segment options={["jarvis", "professional", "friendly"] as const} value={tone} onChange={setTone} />
      </div>
      <div>
        <FieldLabel>Verbosity</FieldLabel>
        <Segment options={["terse", "balanced", "verbose"] as const} value={verbosity} onChange={setVerbosity} />
      </div>
      <SaveButton onClick={handleSave} />
    </div>
  );
}

// ── Permissions section ──────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  "gmail.sendEmail": "Send email",
  "gmail.draftEmail": "Draft email",
  "calendar.createEvent": "Create event",
  "calendar.listEvents": "List events",
  "calendar.checkAvailability": "Check availability",
  "x.getTimeline": "Get timeline",
  "x.getMentions": "Get mentions",
  "x.searchTweets": "Search tweets",
  "files.searchFiles": "Search files",
  "files.readFile": "Read file",
  "memory.query": "Query memory",
};

const TOOL_GROUPS: Record<string, string[]> = {
  Gmail: ["gmail.sendEmail", "gmail.draftEmail"],
  Calendar: ["calendar.createEvent", "calendar.listEvents", "calendar.checkAvailability"],
  X: ["x.getTimeline", "x.getMentions", "x.searchTweets"],
  Files: ["files.searchFiles", "files.readFile"],
  Memory: ["memory.query"],
};

function PermissionsSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [local, setLocal] = useState(config);

  function handleTrustChange(level: TrustLevel) {
    setLocal(applyTrustLevel(local, level));
  }

  function handleToolToggle(tool: string, value: boolean) {
    setLocal((prev) => ({
      ...prev,
      tools: { ...prev.tools, [tool]: { requiresApproval: value } },
    }));
  }

  async function handleSave() {
    await saveConfig(local);
    onSave(local);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>PERMISSIONS</SectionTitle>
      <div>
        <FieldLabel>Trust Level</FieldLabel>
        <Segment
          options={["supervised", "balanced", "autonomous"] as const}
          value={local.trustLevel}
          onChange={handleTrustChange}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Supervised: confirm everything · Balanced: confirm side-effects · Autonomous: confirm nothing
        </div>
      </div>
      {Object.entries(TOOL_GROUPS).map(([group, tools]) => (
        <div key={group}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>{group.toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tools.map((tool) => (
              <div key={tool} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--text)" }}>{TOOL_LABELS[tool]}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {local.tools[tool]?.requiresApproval ? "requires approval" : "auto"}
                  </span>
                  <Toggle
                    value={local.tools[tool]?.requiresApproval ?? false}
                    onChange={(v) => handleToolToggle(tool, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <SaveButton onClick={handleSave} />
    </div>
  );
}

// ── Hotkey section ───────────────────────────────────────────────────────────

function HotkeySection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [hotkey, setHotkey] = useState(config.hotkey);

  async function handleSave() {
    const updated: RaphaelConfig = { ...config, hotkey };
    await saveConfig(updated);
    onSave(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>HOTKEY</SectionTitle>
      <div>
        <FieldLabel>Global shortcut to summon Raphael</FieldLabel>
        <TextInput value={hotkey} onChange={setHotkey} placeholder="Super+Shift+Space" />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Changes take effect after restarting the app.
        </div>
      </div>
      <SaveButton onClick={handleSave} />
    </div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function SettingsPanel({ config, onClose, onSave }: Props) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "var(--bg)", display: "flex", flexDirection: "column",
      animation: "slideIn 0.18s ease-out",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", borderBottom: "1px solid #1e1e2e", flexShrink: 0,
      }}>
        <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>SETTINGS</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "var(--text-muted)",
          cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px",
        }}>×</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: 36 }}>
        <ApiKeysSection />
        <div style={{ height: 1, background: "#1e1e2e" }} />
        <PersonaSection config={config} onSave={onSave} />
        <div style={{ height: 1, background: "#1e1e2e" }} />
        <PermissionsSection config={config} onSave={onSave} />
        <div style={{ height: 1, background: "#1e1e2e" }} />
        <HotkeySection config={config} onSave={onSave} />
      </div>
    </div>
  );
}
