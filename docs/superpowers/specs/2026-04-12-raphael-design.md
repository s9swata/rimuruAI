# Raphael — Design Spec
_Date: 2026-04-12_

## Overview

Raphael is a multi-modal, Jarvis-inspired personal AI agent built for any OS (Windows, macOS, Linux). It lives in the system tray, can be summoned with a hotkey, and acts as a persistent intelligent assistant with access to email, calendar, X.com, local files, and a long-term knowledge graph memory. It runs entirely on Groq Cloud free-tier models. The Tauri + Rust stack was chosen specifically to enable this cross-platform reach while keeping the binary lightweight.

---

## 1. Platform & Stack

- **Shell**: Tauri v2 (Rust for cross-platform system-level concerns, web renderer for UI)
- **Frontend**: React + TypeScript (Vite)
- **Agent logic**: TypeScript (runs in renderer, calls Groq REST API directly)
- **Cross-platform**: Windows, macOS, Linux — Tauri's Rust core abstracts all OS differences
- **API keys**: Stored in OS credential store via Tauri's secure storage APIs (Keychain / Credential Manager / libsecret)
- **No sidecar**: All logic is TypeScript; Rust handles only tray, hotkey, window management, file system access, and credential storage

---

## 2. Model Routing

Three Groq free-tier models, each with a distinct role:

| Model | Role | When used |
|---|---|---|
| `qwen/qwen3-32b` | Orchestrator + tool router | Every message — classifies intent, selects tools, decides model tier |
| `meta-llama/llama-3.1-8b-instant` | Always-on | Quick replies, greetings, simple lookups, low-latency responses |
| `meta-llama/llama-3.3-70b-versatile` | Fallback | Complex reasoning, email drafting, multi-step plans, anything requiring depth |

The orchestrator returns structured JSON: `{ model: "llama-3.3-70b", tools: ["gmail.draft"], params: {...} }`. A TypeScript dispatcher executes the tool call and returns results back to the model for a final response.

---

## 3. UI & UX

### Persistent presence
- System tray icon (minimal glyph — stylized "R" or geometric eye); works on Windows, macOS, and Linux
- States: hollow (idle), filled (active/thinking), amber (waiting for approval)
- Clicking the icon opens the main window

### Main window
- Dimensions: ~420px wide × ~680px tall, centered on screen
- Background: `#0a0a0f` with subtle noise/scanline texture
- Thin accent line at top: electric blue or deep violet
- Summoned/dismissed via user-configurable global hotkey

### Layout (top to bottom)
1. **Header** — "RAPHAEL" in small-caps monospace, breathing status dot, settings icon
2. **Chat area** — scrollable message history
   - User messages: right-aligned, muted dark chip
   - Raphael messages: left-aligned, plain text, streaming with typing cursor animation
   - Tool cards: inline expandable cards showing action status (e.g., "Fetching calendar…"), collapsible once done
   - Email draft cards: editable composer with Send / Discard buttons, appears inline in chat
3. **Input bar** — single-line, expands to multiline; `Enter` sends, `Shift+Enter` newlines; `/` hint shows slash commands (`/email`, `/calendar`, `/files`, `/memory`)

### Onboarding
First launch opens a setup flow: Groq API key, Google OAuth, X.com Bearer token, watched folder paths, hotkey binding. All stored in the OS credential store via Tauri's secure storage APIs (Keychain on macOS, Credential Manager on Windows, libsecret on Linux).

---

## 4. Integrations & Tool System

Each integration is a TypeScript service module. The orchestrator returns a structured tool call; a dispatcher routes it to the correct service.

### Gmail service
- OAuth 2.0 via Google JS library, tokens in keychain
- App stays in "testing" mode (up to 100 users, no review required, free)
- Tools: `listEmails`, `readEmail`, `draftEmail`, `sendEmail`
- Cold email / general email flow: orchestrator calls `draftEmail` → inline editable composer card appears → user edits → approves → `sendEmail` fires

### Google Calendar service
- Shares the same OAuth token as Gmail (single consent screen)
- Tools: `listEvents`, `createEvent`, `checkAvailability`

### X.com service
- Read-only, X API v2 Bearer token stored in keychain
- Tools: `getTimeline`, `getMentions`, `searchTweets`

### Files service
- Watched folders configured at setup, stored in Tauri app config
- Tools: `searchFiles`, `readFile`
- Read-only — Raphael never writes or deletes files
- Raphael can search by filename or grep-style content match, then read and summarize

---

## 5. Tool Permission Config

Tool permissions are driven by `raphael.config.json` in the app config directory. Editable directly — no restart needed (config hot-reloaded at runtime).

```json
{
  "persona": {
    "address": "sir",
    "tone": "jarvis",
    "verbosity": "terse"
  },
  "tools": {
    "gmail.sendEmail":          { "requiresApproval": true },
    "gmail.draftEmail":         { "requiresApproval": false },
    "calendar.createEvent":     { "requiresApproval": true },
    "calendar.listEvents":      { "requiresApproval": false },
    "calendar.checkAvailability": { "requiresApproval": false },
    "x.getTimeline":            { "requiresApproval": false },
    "x.getMentions":            { "requiresApproval": false },
    "x.searchTweets":           { "requiresApproval": false },
    "files.searchFiles":        { "requiresApproval": false },
    "files.readFile":           { "requiresApproval": false },
    "memory.query":             { "requiresApproval": false }
  }
}
```

**Trust Level presets** (accessible via Settings) write to this config file:
- **Supervised**: all side-effecting tools require approval
- **Balanced** (default): sends and creates require approval, reads are silent
- **Full Autonomy**: all tools fire without confirmation

Power users can hand-edit the config for fine-grained control beyond the presets.

---

## 6. Personality System

Raphael's persona is a system prompt layer wrapping every conversation. Character traits:
- Addresses the user as "sir" (configurable via `persona.address` in config)
- Dry wit, occasional sarcasm — never annoying, always purposeful
- Direct and confident — doesn't hedge unless genuinely uncertain
- Terse by default — gets to the point and stops

Model-aware prompt tuning:
- `llama-3.1-8b` gets a short snappy system prompt (fast quips, quick answers)
- `llama-3.3-70b` gets the full persona with richer context (tone matters for drafts)
- `qwen-3-32b` (orchestrator) gets a minimal tool-routing prompt — no personality noise in the decision layer

`persona.tone` options: `jarvis` | `professional` | `friendly`
`persona.verbosity` options: `terse` | `balanced` | `verbose`

---

## 7. Memory & Context — graphify Knowledge Graph

Raphael's memory is a living knowledge graph powered by [graphify](https://github.com/safishamsi/graphify), stored in `raphael-memory/graph.json`. It replaces the flat rolling message window with a persistent, queryable, cross-session knowledge base.

### Graph structure
- Each conversation session becomes a root node
- Topics, entities (people, companies, projects, tasks), and actions become child nodes connected to the session via typed edges (`discussed_in`, `related_to`, `sent_email_to`, `scheduled_with`, `references_file`, etc.)
- Emails, calendar events, and X.com data are ingested via `graphify add` — becoming first-class nodes connected to existing entities
- Watched folder files are indexed into the same graph via `graphify` — a file about a contact links to emails sent to that contact

### Query time
Raphael launches a graphify MCP server on startup:
```bash
python -m graphify.serve raphael-memory/graph.json
```

The orchestrator (`qwen-3-32b`) calls MCP tools before answering:
- `query_graph "what do I know about Acme Corp?"` — focused subgraph
- `shortest_path "John Smith" "Project X"` — traces connections between concepts
- `get_neighbors "email_draft_2026-04-10"` — surfaces related context

The subgraph result is injected as a focused context block before the model prompt — not the raw full graph.

### Growth
The graph grows continuously: every conversation adds new nodes and edges, every email/calendar sync enriches existing nodes, every file indexing pass adds structural relationships. graphify's SHA256 cache ensures re-runs only process changed files.

---

## 8. Project Structure (in monorepo)

```
rimuruAI/
├── words-of-world/       # existing menu bar voice-to-text app
└── raphael/              # this project
    ├── src-tauri/        # Rust — tray, hotkey, window, credential store, file watch (cross-platform)
    ├── src/              # React + TypeScript
    │   ├── components/   # UI components (ChatArea, ToolCard, EmailComposer, etc.)
    │   ├── services/     # Integration modules (gmail, calendar, x, files, memory)
    │   ├── agent/        # Orchestrator, dispatcher, model router
    │   └── config/       # Config loader (raphael.config.json)
    ├── raphael-memory/   # graphify graph output (graph.json, GRAPH_REPORT.md)
    └── raphael.config.json
```

---

## Out of Scope (v1)

- Voice input (planned for later, words-of-world patterns can be reused)
- Outlook / additional email & calendar providers
- X.com write access (post, DM)
- Multi-user / cloud sync
- Mobile
