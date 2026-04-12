# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-screen slide-in settings panel accessible from a gear icon in the header, covering API keys, persona, permissions, and hotkey — all persisted to `~/Library/Application Support/raphael/config.json`.

**Architecture:** Two new Tauri Rust commands (`load_config`, `save_config`) read/write a JSON file on disk. `config/loader.ts` is updated to call these instead of returning stubs. `SettingsPanel.tsx` is a self-contained overlay component with four sections; secrets are read/written via the existing `get_secret`/`set_secret` Tauri commands. App.tsx gets a gear button and shows/hides the panel.

**Tech Stack:** Rust (Tauri v2), React + TypeScript, Zustand pattern already established, CSS variables from `index.css`

---

## File Map

| File | Change |
|------|--------|
| `raphael/src-tauri/src/commands.rs` | Add `load_config`, `save_config` commands |
| `raphael/src-tauri/src/lib.rs` | Register new commands in `invoke_handler` |
| `raphael/src/config/loader.ts` | Replace stubs with real Tauri calls |
| `raphael/src/components/SettingsPanel.tsx` | New — full settings UI (4 sections) |
| `raphael/src/index.css` | Add `@keyframes slideIn` animation |
| `raphael/src/App.tsx` | Gear icon in header, show/hide SettingsPanel |

---

## Task 1: Add `load_config` and `save_config` Tauri commands

**Files:**
- Modify: `raphael/src-tauri/src/commands.rs`
- Modify: `raphael/src-tauri/src/lib.rs`

- [ ] **Step 1: Add commands to `commands.rs`**

Open `raphael/src-tauri/src/commands.rs`. Add these two functions at the bottom of the file (before the final closing of any module, after the existing `send_email` command):

```rust
#[tauri::command]
pub fn load_config() -> Result<String, String> {
    let path = store_dir().join("config.json");
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_config(json: String) -> Result<(), String> {
    let dir = store_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("config.json"), json).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register in `lib.rs`**

Open `raphael/src-tauri/src/lib.rs`. Find the `.invoke_handler(tauri::generate_handler![...])` block and add the two new commands:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_secret,
    commands::set_secret,
    commands::list_files,
    commands::read_file_content,
    commands::get_logs,
    commands::clear_logs,
    commands::send_email,
    commands::load_config,
    commands::save_config,
])
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/s4swata/cwo/rimuruAI/raphael/src-tauri && cargo check 2>&1 | tail -3
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/s4swata/cwo/rimuruAI && git add raphael/src-tauri/src/commands.rs raphael/src-tauri/src/lib.rs && git commit -m "feat(settings): add load_config and save_config Tauri commands"
```

---

## Task 2: Update `config/loader.ts` to persist to disk

**Files:**
- Modify: `raphael/src/config/loader.ts`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `raphael/src/config/loader.ts` with:

```ts
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_CONFIG, RaphaelConfig } from "./types";

export async function loadConfig(): Promise<RaphaelConfig> {
  try {
    const json = await invoke<string>("load_config");
    if (!json) return DEFAULT_CONFIG;
    const parsed = JSON.parse(json) as Partial<RaphaelConfig>;
    // Merge with DEFAULT_CONFIG so new keys added in future releases always have defaults
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      persona: { ...DEFAULT_CONFIG.persona, ...(parsed.persona ?? {}) },
      tools: { ...DEFAULT_CONFIG.tools, ...(parsed.tools ?? {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: RaphaelConfig): Promise<void> {
  await invoke("save_config", { json: JSON.stringify(config, null, 2) });
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/s4swata/cwo/rimuruAI/raphael && npx tsc --noEmit 2>&1 | head -5
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/s4swata/cwo/rimuruAI && git add raphael/src/config/loader.ts && git commit -m "feat(settings): wire config loader to disk via Tauri commands"
```

---

## Task 3: Build `SettingsPanel` component

**Files:**
- Create: `raphael/src/components/SettingsPanel.tsx`

- [ ] **Step 1: Create the file**

Create `raphael/src/components/SettingsPanel.tsx` with the complete contents below:

```tsx
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
  options: T[]; value: T; onChange: (v: T) => void;
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
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /Users/s4swata/cwo/rimuruAI/raphael && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/s4swata/cwo/rimuruAI && git add raphael/src/components/SettingsPanel.tsx && git commit -m "feat(settings): SettingsPanel component with API keys, persona, permissions, hotkey"
```

---

## Task 4: Add slide-in animation to CSS + gear icon + wire SettingsPanel into App.tsx

**Files:**
- Modify: `raphael/src/index.css`
- Modify: `raphael/src/App.tsx`

- [ ] **Step 1: Add `slideIn` keyframe to `index.css`**

Open `raphael/src/index.css`. Append at the bottom of the file:

```css
@keyframes slideIn {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
```

(Note: if a `pulse` keyframe already exists in the file, skip adding it again.)

- [ ] **Step 2: Add SettingsPanel import and state to `App.tsx`**

Open `raphael/src/App.tsx`. Add the import after the existing component imports:

```ts
import SettingsPanel from "./components/SettingsPanel";
```

Inside the `App` component body, add state for showing the panel (place it after the existing `useState` declarations):

```ts
const [showSettings, setShowSettings] = useState(false);
```

- [ ] **Step 3: Replace the header bar JSX in `App.tsx`**

Find this block in the JSX:

```tsx
<div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e1e2e" }}>
  <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>RAPHAEL</span>
  <div style={{ width: 8, height: 8, borderRadius: "50%", background: thinking ? "#f59e0b" : "var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
</div>
```

Replace it with:

```tsx
<div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e1e2e" }}>
  <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>RAPHAEL</span>
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
    <button
      onClick={() => setShowSettings(true)}
      style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px" }}
      title="Settings"
    >
      ⚙
    </button>
    <div style={{ width: 8, height: 8, borderRadius: "50%", background: thinking ? "#f59e0b" : "var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
  </div>
</div>
```

- [ ] **Step 4: Render SettingsPanel in the JSX**

Inside the main return `<div>`, add the panel just before the closing `</div>` tag:

```tsx
{showSettings && (
  <SettingsPanel
    config={config}
    onClose={() => setShowSettings(false)}
    onSave={(updated) => { setConfig(updated); setShowSettings(false); }}
  />
)}
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd /Users/s4swata/cwo/rimuruAI/raphael && npx tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

```bash
cd /Users/s4swata/cwo/rimuruAI/raphael && npx vitest run 2>&1 | tail -5
```

Expected: all 26 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/s4swata/cwo/rimuruAI && git add raphael/src/index.css raphael/src/App.tsx && git commit -m "feat(settings): gear icon in header, SettingsPanel wired into App"
```

---

## Self-Review

**Spec coverage:**
- API Keys section (Groq, Gmail address, Gmail app password, GitHub PAT) ✓ Task 3
- Persona section (address, tone, verbosity) ✓ Task 3
- Permissions section (trust level + per-tool toggles) ✓ Task 3
- Hotkey section ✓ Task 3
- Config persists to JSON file ✓ Tasks 1 & 2
- Slide-in animation ✓ Task 4
- Gear icon in header ✓ Task 4
- Secrets managed via SecureStore ✓ Task 3 (`ApiKeysSection`)

**Placeholder scan:** All code blocks are complete. No TBDs.

**Type consistency:**
- `RaphaelConfig`, `TrustLevel`, `applyTrustLevel` imported from `../config/types` in SettingsPanel — matches definitions in `config/types.ts`
- `saveConfig` imported from `../config/loader` — matches signature `saveConfig(config: RaphaelConfig): Promise<void>` defined in Task 2
- `onSave: (config: RaphaelConfig) => void` prop matches `setConfig` in App.tsx (which is `React.Dispatch<React.SetStateAction<RaphaelConfig>>`, assignable to the prop type)
