import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RaphaelConfig, McpServerConfig, TrustLevel, applyTrustLevel } from "../config/types";
import { saveConfig } from "../config/loader";
import { getGmailAuthStatus, startGoogleOAuth, revokeGoogleOAuth } from "../services/index";
import { open as openBrowser } from "@tauri-apps/plugin-shell";

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

function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: "var(--bg-surface)", color: "var(--text)",
        border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
        padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none",
        resize: "vertical", boxSizing: "border-box",
      }}
    />
  );
}

function keyCount(text: string) {
  const n = text.split("\n").map(k => k.trim()).filter(Boolean).length;
  return n > 1 ? <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 6 }}>{n} keys</span> : null;
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

function parseKeysFromStorage(stored: string | null): string {
  if (!stored) return "";
  try {
    const arr = JSON.parse(stored);
    if (Array.isArray(arr)) return arr.filter(Boolean).join("\n");
  } catch {}
  return stored.trim(); // backwards compat: single key string
}

function serializeKeysForStorage(textarea: string): string {
  const keys = textarea.split("\n").map(k => k.trim()).filter(Boolean);
  return JSON.stringify(keys);
}

function ApiKeysSection() {
  const [groqKey, setGroqKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [serperKey, setSerperKey] = useState("");
  const [gmailConnected, setGmailConnected] = useState(false);
  const [saved, setSaved] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "pending" | "error">("idle");
  const [oauthError, setOauthError] = useState("");

  useEffect(() => {
    (async () => {
      const [groq, gemini, clientId, clientSecret, gh, serper, connected] = await Promise.all([
        invoke<string | null>("get_secret", { key: "groq_api_key" }),
        invoke<string | null>("get_secret", { key: "gemini_api_key" }),
        invoke<string | null>("get_secret", { key: "google_client_id" }),
        invoke<string | null>("get_secret", { key: "google_client_secret" }),
        invoke<string | null>("get_secret", { key: "github_pat" }),
        invoke<string | null>("get_secret", { key: "serper_api_key" }),
        getGmailAuthStatus(),
      ]);
      setGroqKey(parseKeysFromStorage(groq));
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
          <FieldLabel>
            Groq API Keys (primary — orchestrator + streaming){keyCount(groqKey)}
          </FieldLabel>
          <TextArea value={groqKey} onChange={setGroqKey} placeholder={"gsk_...\ngsk_..."} rows={3} />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>One key per line</div>
        </div>
        <div>
          <FieldLabel>
            Gemini API Keys (fallback){keyCount(geminiKey)}
          </FieldLabel>
          <TextArea value={geminiKey} onChange={setGeminiKey} placeholder={"AIza...\nAIza..."} rows={3} />
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>One key per line</div>
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
  "search.query": "Web search",
};

const TOOL_GROUPS: Record<string, string[]> = {
  Gmail: ["gmail.sendEmail", "gmail.draftEmail"],
  Calendar: ["calendar.createEvent", "calendar.listEvents", "calendar.checkAvailability"],
  X: ["x.getTimeline", "x.getMentions", "x.searchTweets"],
  Files: ["files.searchFiles", "files.readFile"],
  Memory: ["memory.query"],
  Search: ["search.query"],
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

// ── MCP Servers section ──────────────────────────────────────────────────────

const EMPTY_FORM: { name: string; command: string; args: string } = { name: "", command: "", args: "" };

function McpServersSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [servers, setServers] = useState<McpServerConfig[]>(config.mcpServers ?? []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  function updateServers(next: McpServerConfig[]) {
    setServers(next);
  }

  async function handleSave(next: McpServerConfig[]) {
    const updated: RaphaelConfig = { ...config, mcpServers: next };
    await saveConfig(updated);
    onSave(updated);
  }

  function handleToggle(idx: number, value: boolean) {
    const next = servers.map((s, i) => i === idx ? { ...s, enabled: value } : s);
    updateServers(next);
  }

  function handleRemove(idx: number) {
    const next = servers.filter((_, i) => i !== idx);
    updateServers(next);
    handleSave(next);
  }

  function handleAdd() {
    setFormError("");
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name) { setFormError("Name is required."); return; }
    if (!command) { setFormError("Command is required."); return; }
    const args = form.args.split(",").map(a => a.trim()).filter(Boolean);
    const entry: McpServerConfig = { name, command, args, enabled: true };
    const next = [...servers, entry];
    updateServers(next);
    handleSave(next);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>MCP SERVERS</SectionTitle>

      {servers.length === 0 && !showForm && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No MCP servers configured.</div>
      )}

      {servers.map((srv, idx) => (
        <div key={idx} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--bg-surface)", borderRadius: "var(--radius)",
          padding: "8px 10px", gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{srv.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {srv.command}{srv.args.length > 0 ? " " + srv.args.join(" ") : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{srv.enabled ? "enabled" : "disabled"}</span>
            <Toggle value={srv.enabled} onChange={(v) => handleToggle(idx, v)} />
            <button
              onClick={() => handleRemove(idx)}
              style={{
                background: "none", border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
                fontFamily: "var(--font-mono)", padding: "3px 8px",
              }}
            >
              remove
            </button>
          </div>
        </div>
      ))}

      {servers.length > 0 && !showForm && (
        <SaveButton onClick={() => handleSave(servers)} />
      )}

      {showForm ? (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 12,
          border: "1px solid var(--accent-dim)",
        }}>
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextInput value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} placeholder="filesystem" />
          </div>
          <div>
            <FieldLabel>Command</FieldLabel>
            <TextInput value={form.command} onChange={(v) => setForm(f => ({ ...f, command: v }))} placeholder="npx" />
          </div>
          <div>
            <FieldLabel>Args (comma-separated)</FieldLabel>
            <TextInput
              value={form.args}
              onChange={(v) => setForm(f => ({ ...f, args: v }))}
              placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
            />
          </div>
          {formError && <div style={{ fontSize: 11, color: "var(--danger)" }}>{formError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              style={{
                background: "var(--accent)", color: "white", border: "none",
                borderRadius: "var(--radius)", padding: "6px 16px",
                fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
              }}
            >
              Add
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(""); }}
              style={{
                background: "var(--bg-chip)", color: "var(--text-muted)", border: "none",
                borderRadius: "var(--radius)", padding: "6px 16px",
                fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          style={{
            alignSelf: "flex-start", background: "var(--bg-chip)", color: "var(--text-muted)",
            border: "1px dashed var(--accent-dim)", borderRadius: "var(--radius)",
            padding: "5px 14px", fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
          }}
        >
          + Add server
        </button>
      )}
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
        <div style={{ height: 1, background: "#1e1e2e" }} />
        <McpServersSection config={config} onSave={onSave} />
      </div>
    </div>
  );
}
