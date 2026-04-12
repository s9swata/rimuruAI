# Raphael

A personal AI assistant that lives in your menu bar. Built with Tauri, React, and Groq.

## Features

- **Menu Bar Presence** — Summon with `Super+Shift+Space` (configurable)
- **AI Chat** — Powered by Groq (Llama 3.1 8B for fast, Llama 3.3 70B for powerful)
- **Email** — Draft and send emails via Gmail SMTP
- **Calendar** — View and create events, sync with GitHub Gist
- **Web Search** — Search the web via Serper API for current information
- **Tool Execution** — Run file operations, memory queries, and more
- **Secure Storage** — All API keys encrypted locally with AES-256-GCM

## Architecture

```
raphael/
├── src/
│   ├── agent/           # AI orchestration (orchestrator, dispatcher, prompts, router)
│   ├── components/      # React UI (ChatArea, SettingsPanel, CalendarView, etc.)
│   ├── services/        # Tool implementations (gmail, calendar, search)
│   ├── calendar/        # Calendar state and GitHub Gist sync
│   ├── config/          # Config types and loader
│   ├── store/           # Zustand state management
│   └── App.tsx          # Main app entry
└── src-tauri/           # Rust backend (Tauri, SMTP, secure storage, web search)
```

## Tools Available

| Tool | Description |
|------|-------------|
| `gmail.draftEmail` | Draft an email (opens compose UI) |
| `gmail.sendEmail` | Send an email directly |
| `calendar.listEvents` | List upcoming events |
| `calendar.createEvent` | Create a new calendar event |
| `calendar.checkAvailability` | Check if time slots are free |
| `search.query` | Search the web for current information |
| `files.searchFiles` | Search files on disk |
| `files.readFile` | Read file contents |
| `memory.query` | Query stored memories |

## Setup

```bash
# Install dependencies
cd raphael
npm install

# Run in development mode
npm run dev
```

## Configuration

Access settings via the ⚙️ icon in the header:

- **API Keys** — Groq, Gmail, GitHub PAT, Serper
- **Persona** — How Raphael addresses you (sir, ma'am, etc.), tone, verbosity
- **Permissions** — Per-tool approval settings, trust level
- **Hotkey** — Global shortcut to summon Raphael

## Tech Stack

- **Frontend**: React 18, TypeScript, Zustand, Vite
- **Backend**: Tauri 2, Rust
- **AI**: Groq API (Llama 3.1, Llama 3.3)
- **Storage**: Encrypted local secrets, JSON config
- **Email**: Gmail SMTP with app passwords
- **Search**: Serper API

## Development

```bash
# Build frontend only
npm run build:frontend

# Build Tauri app
npm run build

# Run tests
npm run test
```