# Settings Page Design

## Goal
A full-screen slide-in settings panel that lets the user manage all configuration from one place: API keys, persona, permissions, and hotkey.

## Architecture

### Config persistence
- Non-secret config (persona, trustLevel, tools, hotkey) → `~/Library/Application Support/raphael/config.json` via Tauri commands `load_config` / `save_config`
- Secrets (groq_api_key, gmail_address, gmail_app_password, github_pat) → existing SecureStore via `get_secret` / `set_secret`
- `config/loader.ts` stubs replaced with real Tauri calls; `DEFAULT_CONFIG` used as fallback when no file exists yet

### Access
- Gear icon (⚙) in the App header bar (right side, next to the pulse dot)
- Clicking opens `SettingsPanel` as a full-screen overlay that slides in over the chat
- Close button (×) in the panel header dismisses it; config is saved on every section's Save button

## Components

### `SettingsPanel` (`src/components/SettingsPanel.tsx`)
Four sections rendered as a scrollable single page:

**1. API Keys**
- Groq API Key (password input + Save)
- Gmail Address (text input + Save)
- Gmail App Password (password input + Save)
- GitHub PAT (password input + Save, labelled optional)
- Each field reads current value from SecureStore on mount (masked), saves on its own Save button

**2. Persona**
- Address — text input (how Raphael addresses the user, e.g. "sir")
- Tone — segmented control: Jarvis / Professional / Friendly
- Verbosity — segmented control: Terse / Balanced / Verbose
- Single Save button for the whole section; updates in-memory config and writes to JSON file

**3. Permissions**
- Trust Level — segmented control: Supervised / Balanced / Autonomous
  - Changing trust level applies `applyTrustLevel()` which bulk-sets all tool approvals
- Per-tool toggles (requiresApproval on/off) for all 11 tools, grouped by service (Gmail, Calendar, X, Files, Memory)
  - Shown as toggle switches labelled with the tool name
- Single Save button writes to JSON file

**4. Hotkey**
- Text input showing current hotkey string (e.g. `Super+Shift+Space`)
- Save button writes to JSON file
- Note: changing the hotkey requires app restart to take effect (shown as hint text)

## Data Flow

```
App mounts → loadConfig() → calls Tauri load_config → reads JSON file (or DEFAULT_CONFIG)
           → passes config + setConfig to SettingsPanel

SettingsPanel Save → updates local state → calls saveConfig() → calls Tauri save_config → writes JSON file
                  → calls setConfig(newConfig) in App to apply immediately
```

## Tauri Commands

### `load_config() -> Result<String, String>`
Reads `{data_dir}/raphael/config.json`. Returns the JSON string. If the file doesn't exist, returns an empty string (frontend falls back to DEFAULT_CONFIG).

### `save_config(json: String) -> Result<(), String>`
Writes `json` to `{data_dir}/raphael/config.json`, creating the directory if needed.

## Files

| File | Change |
|------|--------|
| `src/components/SettingsPanel.tsx` | New — settings UI |
| `src-tauri/src/commands.rs` | Add `load_config`, `save_config` |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/config/loader.ts` | Replace stubs with Tauri calls |
| `src/App.tsx` | Gear icon, SettingsPanel show/hide, pass config+setConfig |

## Non-Goals
- No settings export/import
- No per-session overrides
- No undo/reset to defaults button
