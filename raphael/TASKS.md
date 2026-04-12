# Raphael — Agent Task Handoff

This file is the single source of truth for completing the Raphael implementation.
Read this before doing anything else.

---

## Context

**What is Raphael?**
A cross-platform (Windows/macOS/Linux) Jarvis-inspired personal AI agent desktop app.
Tauri v2 shell (Rust) + React + TypeScript frontend. Three-tier Groq model stack:
- `qwen/qwen3-32b` — orchestrator + tool router
- `meta-llama/llama-3.1-8b-instant` — always-on fast responses
- `meta-llama/llama-3.3-70b-versatile` — fallback for complex tasks

Integrations: Gmail, Google Calendar, X.com (read-only), local files (watched folders).
Memory: graphify knowledge graph (persistent, queryable via MCP server).

**Full spec:** `docs/superpowers/specs/2026-04-12-raphael-design.md`
**Full implementation plan:** `docs/superpowers/plans/2026-04-12-raphael.md`

The plan contains complete code for every task. Always read the relevant task section
from the plan before implementing. Treat it as the source of truth for code.

---

## Repository

- **Monorepo root:** `/Users/s4swata/cwo/rimuruAI`
- **Branch:** `feat/raphael`
- **Project directory:** `rimuruAI/raphael/`
- **Main branch to eventually merge into:** `main`

---

## Current State

### ✅ Completed

**Phase 1 / Task 1 — Scaffold Tauri v2 + React project**
Status: Done and reviewed (spec + code quality).

What exists in `raphael/`:
- `package.json` — Tauri v2, React 18, groq-sdk, vitest, all plugins
- `vite.config.ts` — port 1420, TAURI_ env prefix, vitest node environment
- `tsconfig.json` — strict, bundler moduleResolution, react-jsx
- `index.html` — React entry point
- `src-tauri/Cargo.toml` — Tauri 2 (tray-icon), aes-gcm, rand 0.9, sha2, hex, dirs
- `src-tauri/build.rs` — tauri_build::build()
- `src-tauri/tauri.conf.json` — 420×680 frameless window, hidden on start, tray icon
- `src-tauri/capabilities/default.json` — core:default, global-shortcut, shell:allow-open
- `src-tauri/src/main.rs` — calls raphael_lib::run()
- `src-tauri/src/lib.rs` — stub: registers plugins, invoke_handler for 4 commands
- `src-tauri/src/commands.rs` — stub: get_secret, set_secret, list_files, read_file_content
- `src-tauri/src/secure_store.rs` — empty stub
- `src-tauri/icons/icon.png` — valid 32×32 RGBA PNG
- All source directories: `src/components/`, `src/agent/`, `src/services/`, `src/config/`, `src/store/`, `tests/agent/`

**Verified:** `cargo check` passes. `npm install` succeeds.

---

## Remaining Tasks

Execute these in order. Do not skip ahead. Each phase must be fully complete
before starting the next. The full code for each task is in the plan file at
`docs/superpowers/plans/2026-04-12-raphael.md`.

---

### PHASE 1 — Tauri Foundation (complete tasks 2–3 before moving to Phase 2)

---

#### Task 2 — AES-256-GCM Secure Store (Rust)
**File:** `raphael/src-tauri/src/secure_store.rs`

Replace the empty stub with a full implementation.

Key design:
- On first run, generate a random 32-byte key, save as `.raphael.key` in the app data dir (hex-encoded)
- Derive the actual AES key: `SHA256(raw_key_bytes || b"raphael-ai-v1-salt-2026")`
- `secrets.enc` format: 12-byte nonce || AES-GCM ciphertext of JSON-serialized `HashMap<String, String>`
- `SecureStore::new(data_dir)` — creates dir, ensures key file exists
- `SecureStore::get(key)` — decrypts and reads
- `SecureStore::set(key, value)` — decrypts, mutates, re-encrypts

**Tests (write first, then implement):**
```rust
#[test]
fn test_roundtrip() { /* set then get returns same value */ }

#[test]
fn test_missing_key_returns_none() { /* get on unknown key returns Ok(None) */ }
```

Run: `cd raphael/src-tauri && cargo test`

Commit: `feat(raphael): AES-256-GCM encrypted secret store`

---

#### Task 3 — System tray, global hotkey, Tauri commands
**Files:**
- `raphael/src-tauri/src/commands.rs` — replace stubs with real implementations
- `raphael/src-tauri/src/lib.rs` — add tray setup + hotkey handler

**commands.rs** real implementations:
- `get_secret(key)` — calls `SecureStore::new(data_dir())?.get(&key)`
- `set_secret(key, value)` — calls `SecureStore::new(data_dir())?.set(&key, &value)`
- `list_files(dir, pattern)` — `fs::read_dir(dir)`, returns paths where filename contains pattern
- `read_file_content(path)` — `fs::read_to_string(path)`

Helper: `fn store_dir() -> PathBuf { dirs::data_dir().unwrap_or(PathBuf::from(".")).join("raphael") }`

**lib.rs** additions:
- Import `tauri::{menu::{Menu, MenuItem}, tray::{MouseButton, TrayIconBuilder, TrayIconEvent}, Manager}`
- Import `tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState}`
- In `.setup()`: register hotkey `Super+Shift+Space`, build tray menu (Show + Quit items), set up tray click handler
- `fn toggle_window(app: &tauri::AppHandle)` — show/hide/focus the "main" webview window

Run: `cd raphael/src-tauri && cargo check`

Commit: `feat(raphael): system tray, global hotkey, Tauri commands`

---

### PHASE 2 — UI Shell (complete tasks 4–8 before Phase 3)

---

#### Task 4 — Config types, loader, default config
**Files:**
- `raphael/src/config/types.ts`
- `raphael/src/config/loader.ts`
- `raphael/raphael.config.json`
- `raphael/tests/agent/config.test.ts`

**types.ts** must export:
- `ToolConfig`, `PersonaConfig`, `TrustLevel`, `RaphaelConfig` interfaces
- `DEFAULT_CONFIG: RaphaelConfig` — all 11 tools configured, balanced trust, Jarvis persona, address "sir"
- `applyTrustLevel(config, level)` — supervised=all true, autonomous=all false, balanced=only gmail.sendEmail + calendar.createEvent true

**loader.ts** must export:
- `loadConfig(): Promise<RaphaelConfig>` — reads from `AppConfig` base dir, merges with DEFAULT_CONFIG
- `saveConfig(config): Promise<void>` — writes to `AppConfig` base dir

Note: `loader.ts` uses `@tauri-apps/plugin-fs` which is added in Task 16. For now, stub it:
```typescript
export async function loadConfig(): Promise<RaphaelConfig> { return DEFAULT_CONFIG; }
export async function saveConfig(_config: RaphaelConfig): Promise<void> {}
```

**tests:** Write vitest tests for `applyTrustLevel` (3 cases: supervised, autonomous, balanced).

Run: `cd raphael && npm test`

Commit: `feat(raphael): config types, loader, trust level logic`

---

#### Task 5 — Global CSS and base layout
**Files:**
- `raphael/src/index.css`
- `raphael/src/main.tsx`
- `raphael/src/App.tsx` (stub — full wiring in Task 11)

**index.css** CSS variables:
- `--bg: #0a0a0f`, `--bg-surface: #12121a`, `--bg-chip: #1c1c28`
- `--accent: #6366f1`, `--accent-dim: #3b3d6e`
- `--text: #e8e8f0`, `--text-muted: #6b6b80`
- `--amber: #f59e0b`, `--danger: #ef4444`
- `--font-mono` — JetBrains Mono / Fira Code / Cascadia Code / monospace
- Noise texture overlay via `body::before` with SVG feTurbulence
- Custom scrollbar (4px, accent-dim thumb)
- `@keyframes pulse` for status dot

**main.tsx** — standard React 18 `ReactDOM.createRoot` entry.

**App.tsx** stub — checks `get_secret("groq_api_key")` via Tauri invoke, renders `<Onboarding>` if null, else renders header + `<ChatArea>` + `<InputBar>` placeholder divs. Import stubs that don't exist yet are fine as comments.

Commit: `feat(raphael): base UI theme, layout, app shell`

---

#### Task 6 — Chat state store
**File:** `raphael/src/store/chat.ts`

Export:
- Types: `MessageRole`, `ChatMessage`, `ToolCardState`, `EmailDraftState`, `ChatItem` (discriminated union)
- Actions: `ADD_MESSAGE`, `APPEND_STREAM`, `FINISH_STREAM`, `ADD_TOOL`, `UPDATE_TOOL`, `ADD_EMAIL`, `UPDATE_EMAIL`, `REMOVE`
- `useChatStore()` — returns `{ state, dispatch }` via `useReducer`

APPEND_STREAM appends a chunk to an existing message's content by id.
FINISH_STREAM sets `streaming: false` on a message by id.

Commit: `feat(raphael): chat state store with useReducer`

---

#### Task 7 — ChatArea, MessageBubble, ToolCard, EmailComposer
**Files:**
- `raphael/src/components/MessageBubble.tsx`
- `raphael/src/components/ToolCard.tsx`
- `raphael/src/components/EmailComposer.tsx`
- `raphael/src/components/ChatArea.tsx`

**MessageBubble:** user messages right-aligned in `--bg-chip` chip; assistant messages left-aligned, plain text, no bubble. Streaming messages show a blinking cursor block.

**ToolCard:** shows tool name + status. Colors: accent (running), text-muted (done), danger (error). Shows truncated result when done.

**EmailComposer:** To/Subject inputs + body textarea + Send/Discard buttons. Calls `onChange(patch)`, `onSend()`, `onDiscard()` props.

**ChatArea:** takes `items: ChatItem[]`, renders each as the right component. Auto-scrolls to bottom on new items. Takes email handlers as props.

Commit: `feat(raphael): ChatArea, MessageBubble, ToolCard, EmailComposer`

---

#### Task 8 — InputBar and Onboarding
**Files:**
- `raphael/src/components/InputBar.tsx`
- `raphael/src/components/Onboarding.tsx`

**InputBar:**
- Textarea, Enter=send, Shift+Enter=newline
- When input starts with `/`, show a slash command hint above the bar (`/email`, `/calendar`, `/files`, `/memory`)
- Tab completes the hint
- `disabled` prop grays it out while Raphael is thinking

**Onboarding:** 4-step wizard:
1. Groq API key (validate starts with `gsk_`)
2. Google Client ID + Client Secret
3. X.com Bearer Token (optional — skip button)
4. Watched folders (one per line textarea)

Each step calls `invoke("set_secret", { key, value })`. After step 4, calls `onComplete()`.

Commit: `feat(raphael): InputBar with slash commands, Onboarding wizard`

---

### PHASE 3 — Agent Core (complete tasks 9–11 before Phase 4)

---

#### Task 9 — Groq streaming client and prompts
**Files:**
- `raphael/src/agent/groq.ts`
- `raphael/src/agent/prompts.ts`

**groq.ts:**
- `getGroqClient()` — lazily creates `new Groq({ apiKey, dangerouslyAllowBrowser: true })`
- `streamChat(model, messages, onChunk, onDone)` — streams via `groq.chat.completions.create({ stream: true })`
- `completeJSON(model, messages)` — non-streaming, `temperature: 0`, returns `string`

**prompts.ts:**
- `MODELS` const: `{ orchestrator: "qwen/qwen3-32b", fast: "meta-llama/llama-3.1-8b-instant", powerful: "meta-llama/llama-3.3-70b-versatile" }`
- `ModelTier = keyof typeof MODELS`
- `buildSystemPrompt(tier, persona)`:
  - `"orchestrator"` tier: returns JSON-only routing prompt listing all available tools and the output schema `{ model, tool, params, intent }`
  - `"fast"` tier: short Jarvis persona prompt (snappy, dry wit)
  - `"powerful"` tier: full Jarvis persona with verbosity and synthesis instructions

Commit: `feat(raphael): Groq streaming client and persona prompt builder`

---

#### Task 10 — Orchestrator, router, dispatcher with tests
**Files:**
- `raphael/tests/agent/orchestrator.test.ts`
- `raphael/tests/agent/router.test.ts`
- `raphael/tests/agent/dispatcher.test.ts`
- `raphael/src/agent/orchestrator.ts`
- `raphael/src/agent/router.ts`
- `raphael/src/agent/dispatcher.ts`

Write tests FIRST (TDD), run to confirm they fail, then implement.

**orchestrator.ts:**
- `parseOrchestration(raw: string): OrchestratorResult` — strips ```json fences, JSON.parse, validates shape
- `orchestrate(userMessage, history, persona)` — calls `completeJSON(MODELS.orchestrator, ...)`, returns parsed result

**router.ts:**
- `pickModel(tier: "fast" | "powerful"): string` — returns `MODELS.fast` or `MODELS.powerful`

**dispatcher.ts:**
- `requiresApprovalCheck(tool: string, config: RaphaelConfig): boolean` — reads `config.tools[tool]?.requiresApproval ?? false`
- `ServiceMap` type — one entry per integration with typed methods
- `dispatch(tool, params, services)` — splits `"gmail.listEmails"` into `[service, method]`, calls `services[service][method](params)`, returns `ToolResult`

Tests to write:
- `parseOrchestration`: valid tool call, no-tool response, invalid JSON throws
- `pickModel`: fast→MODELS.fast, powerful→MODELS.powerful
- `requiresApprovalCheck`: gmail.sendEmail→true (balanced), x.getTimeline→false, unknown→false

Run: `cd raphael && npm test` — all tests must pass.

Commit: `feat(raphael): orchestrator, router, dispatcher with tests`

---

#### Task 11 — Wire end-to-end chat loop in App.tsx
**File:** `raphael/src/App.tsx` (replace stub)
**File:** `raphael/src/services/index.ts` (create stub)

**services/index.ts stub:**
```typescript
import { ServiceMap } from "../agent/dispatcher";
export async function createServices(): Promise<ServiceMap> {
  return {
    gmail: { listEmails: async () => [], readEmail: async () => ({}), draftEmail: async (p) => p, sendEmail: async () => ({}) },
    calendar: { listEvents: async () => [], createEvent: async () => ({}), checkAvailability: async () => [] },
    x: { getTimeline: async () => [], getMentions: async () => [], searchTweets: async () => [] },
    files: { searchFiles: async () => [], readFile: async () => ({ path: "", content: "" }) },
    memory: { query: async () => ({}) },
  };
}
```

**App.tsx** full wiring:
1. `useEffect` on mount: invoke `get_secret("groq_api_key")` → if null show `<Onboarding>`, else show chat
2. `useEffect` on mount: `loadConfig()` → setConfig
3. `handleSubmit(text)`:
   - Add user message to chat state
   - Set thinking=true (accent line turns amber)
   - `orchestrate(text, history, config.persona)` → plan
   - If `plan.tool === "gmail.draftEmail"`: add EmailDraft card directly
   - Else if `plan.tool`: add ToolCard (running), check `requiresApprovalCheck` → `window.confirm` if needed, `dispatch(plan.tool, plan.params, services)` → update ToolCard (done/error)
   - Add assistant message (streaming=true), `streamChat(model, messages, onChunk, onDone)`
   - `onChunk` → APPEND_STREAM, `onDone` → FINISH_STREAM
4. Email send handler: call `services.gmail.sendEmail(draft)` then REMOVE the email card
5. Email discard handler: REMOVE the email card

Commit: `feat(raphael): wire end-to-end chat loop`

---

### PHASE 4 — Integrations (complete tasks 12–14 before Phase 5)

---

#### Task 12 — Gmail service
**File:** `raphael/src/services/gmail.ts`

OAuth flow:
1. Check `google_access_token` + `google_token_expiry` from secure store
2. If expired/missing: build PKCE auth URL (code_challenge via SHA-256), call `openUrl(authUrl)` (from `@tauri-apps/plugin-shell`)
3. Prompt user to paste the `code` param from the redirect URL: `const code = prompt("Paste the code from the redirect URL:")`
4. Exchange code for tokens via POST to `https://oauth2.googleapis.com/token`
5. Store access_token + expiry + refresh_token via invoke `set_secret`

Scopes: `https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send`
Redirect URI: `http://localhost:7842/oauth/google`

Methods:
- `listEmails({ maxResults, query })` — list + fetch metadata (Subject, From, Date) for top 5
- `readEmail({ id })` — fetch full message, decode base64url body
- `draftEmail({ to, subject, body })` — returns the params as-is (draft is shown in EmailComposer)
- `sendEmail({ to, subject, body })` — construct RFC 2822 message, base64url encode, POST to `/messages/send`

Update `services/index.ts` to import `gmailService`.

Commit: `feat(raphael): Gmail service with PKCE OAuth`

---

#### Task 13 — Google Calendar service
**File:** `raphael/src/services/calendar.ts`

Reuses the `google_access_token` set by gmail.ts (same OAuth token covers Calendar with correct scopes).
Add `https://www.googleapis.com/auth/calendar` to the Gmail OAuth scopes in Task 12.

Methods:
- `listEvents({ days = 7 })` — fetch primary calendar events for next N days
- `checkAvailability({ date })` — fetch events for a specific date
- `createEvent({ title, start, end, description })` — POST to calendar API with local timezone

Update `services/index.ts`.

Commit: `feat(raphael): Google Calendar service`

---

#### Task 14 — X.com and Files services
**Files:**
- `raphael/src/services/x.ts`
- `raphael/src/services/files.ts`

**x.ts:**
- Read `x_bearer_token` from secure store
- `getTimeline({ maxResults })` — GET `/users/me`, then GET `/users/{id}/timelines/reverse_chronological`
- `getMentions({ maxResults })` — GET `/users/{id}/mentions`
- `searchTweets({ query, maxResults })` — GET `/tweets/search/recent`

**files.ts:**
- `searchFiles({ query, folder? })` — if no folder, read `watched_folders` JSON from secure store, use first entry; call `invoke("list_files", { dir, pattern: query })`
- `readFile({ path })` — call `invoke("read_file_content", { path })`, truncate to 4000 chars

Update `services/index.ts` to import all four real services (gmail, calendar, x, files). Memory stays as stub.

Commit: `feat(raphael): X.com read-only and Files services`

---

### PHASE 5 — Memory (complete tasks 15–16 last)

---

#### Task 15 — graphify memory service and MCP integration
**File:** `raphael/src/services/memory.ts`
**Modify:** `raphael/src/App.tsx`

First, install graphify and initialize the memory graph:
```bash
pip install graphifyy
cd raphael
python3 -m graphify raphael-memory --no-viz
```
This creates `raphael-memory/graph.json` and `raphael-memory/GRAPH_REPORT.md`.

**memory.ts:**
- `startMemoryServer()` — spawns `python3 -m graphify.serve raphael-memory/graph.json --port 7843` via `Command.create` from `@tauri-apps/plugin-shell`, waits 1500ms
- `mcpCall(method, params)` — POSTs to `http://localhost:7843/tools/call`
- `memoryService.query({ question, budget? })` — calls `query_graph`
- `memoryService.path({ from, to })` — calls `shortest_path`
- `memoryService.explain({ concept })` — calls `get_node`
- `ingestConversationTurn(userMsg, assistantMsg)` — writes a markdown file to `raphael-memory/conversations/conv-{timestamp}.md`, spawns `python3 -m graphify raphael-memory --update --no-viz`

**App.tsx additions:**
- Before `orchestrate()`, call `memoryService.query({ question: text, budget: 600 })`, prepend result to message as `[Memory context]\n...\n\n[User message]\n...`
- After streamChat completes, call `ingestConversationTurn(text, fullReply)` (non-fatal, catch errors)

Update `services/index.ts` to import `memoryService`.

Commit: `feat(raphael): graphify MCP memory service, conversation ingestion`

---

#### Task 16 — Add @tauri-apps/plugin-fs and final wiring
**Files:**
- `raphael/package.json` — add `@tauri-apps/plugin-fs`
- `raphael/src-tauri/Cargo.toml` — add `tauri-plugin-fs`
- `raphael/src-tauri/src/lib.rs` — register `tauri_plugin_fs::init()`
- `raphael/src-tauri/capabilities/default.json` — add fs permissions
- `raphael/src/config/loader.ts` — replace stub with real implementation using `@tauri-apps/plugin-fs`

Steps:
```bash
cd raphael && npm install @tauri-apps/plugin-fs
cd src-tauri && cargo add tauri-plugin-fs
```

In `lib.rs`, add `.plugin(tauri_plugin_fs::init())` to the builder chain (before other plugins).

In `capabilities/default.json`, add to permissions array:
```json
"fs:allow-read-text-file",
"fs:allow-write-text-file",
"fs:allow-app-config-read",
"fs:allow-app-config-write"
```

Replace loader.ts stub with real implementation:
```typescript
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import { DEFAULT_CONFIG, RaphaelConfig } from "./types";
const CONFIG_FILE = "raphael.config.json";
export async function loadConfig(): Promise<RaphaelConfig> {
  try {
    const text = await readTextFile(CONFIG_FILE, { baseDir: BaseDirectory.AppConfig });
    return { ...DEFAULT_CONFIG, ...JSON.parse(text) };
  } catch { return DEFAULT_CONFIG; }
}
export async function saveConfig(config: RaphaelConfig): Promise<void> {
  await writeTextFile(CONFIG_FILE, JSON.stringify(config, null, 2), { baseDir: BaseDirectory.AppConfig });
}
```

Run full test suite:
```bash
cd raphael && npm test          # all vitest tests must pass
cd raphael/src-tauri && cargo test   # both Rust tests must pass
cd raphael/src-tauri && cargo check  # no compile errors
```

Commit: `feat(raphael): fs plugin, real config loader, final wiring`

---

## Execution Rules for Agents

1. **Work on branch `feat/raphael`** — never commit to `main` directly
2. **Complete one task fully before starting the next** — no partial implementations
3. **TDD for all logic** — write failing tests first, implement, confirm passing
4. **Each task ends with a git commit** — message format: `feat(raphael): <description>`
5. **`cargo check` must pass after every Rust change**
6. **`npm test` must pass after every TypeScript change**
7. **Never run `tauri dev`** — this opens a GUI and will block; use `cargo check` + `npm test` for verification
8. **The full plan** at `docs/superpowers/plans/2026-04-12-raphael.md` has complete code for every task — read the relevant section before implementing
9. **No internet access needed** — all deps are in package.json / Cargo.toml; `npm install` and `cargo fetch` will resolve them
10. **Rust API note** — this is Tauri v2, not v1. APIs differ significantly. Refer to the plan code, not Tauri v1 docs.

---

## Task Completion Checklist

| Task | Description | Status |
|------|-------------|--------|
| Phase 1 / Task 1 | Scaffold Tauri + React project | ✅ Done |
| Phase 1 / Task 2 | AES-256-GCM Secure Store (Rust) | ⏳ Pending |
| Phase 1 / Task 3 | System tray, global hotkey, commands | ⏳ Pending |
| Phase 2 / Task 4 | Config types, loader, default config | ⏳ Pending |
| Phase 2 / Task 5 | Global CSS and base layout | ⏳ Pending |
| Phase 2 / Task 6 | Chat state store | ⏳ Pending |
| Phase 2 / Task 7 | ChatArea, MessageBubble, ToolCard, EmailComposer | ⏳ Pending |
| Phase 2 / Task 8 | InputBar and Onboarding | ⏳ Pending |
| Phase 3 / Task 9 | Groq streaming client and prompts | ⏳ Pending |
| Phase 3 / Task 10 | Orchestrator, router, dispatcher with tests | ⏳ Pending |
| Phase 3 / Task 11 | Wire end-to-end chat loop | ⏳ Pending |
| Phase 4 / Task 12 | Gmail service | ⏳ Pending |
| Phase 4 / Task 13 | Google Calendar service | ⏳ Pending |
| Phase 4 / Task 14 | X.com and Files services | ⏳ Pending |
| Phase 5 / Task 15 | graphify memory service and MCP | ⏳ Pending |
| Phase 5 / Task 16 | @tauri-apps/plugin-fs + final wiring | ⏳ Pending |
