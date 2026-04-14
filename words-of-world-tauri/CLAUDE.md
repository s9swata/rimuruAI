# WordsOfWorld

A cross-platform voice-to-text transcription app built with Tauri V2 + Svelte.

## What It Does

Converts speech to text using Groq's Whisper API. Users press a hotkey (default: Alt+Space) to record, then the transcription is automatically pasted into the active application.

## Features

- **Voice Recording**: Captures audio from microphone with voice activity detection
- **Transcription**: Sends audio to Groq Whisper API (`whisper-large-v3-turbo`)
- **Auto-Paste**: Injects transcribed text into the focused app via clipboard
- **System Tray**: Background operation with tray menu
- **Global Hotkey**: Works across all applications
- **Settings**: API key, hotkey, and push-to-talk mode configuration

## Tech Stack

- **Frontend**: Svelte + TypeScript
- **Backend**: Rust + Tauri V2
- **Audio**: cpal crate (cross-platform)
- **Plugins**: global-shortcut, clipboard-manager, notification, store, shell

## Key Files

```
words-of-world-tauri/
├── src/                          # Svelte frontend
│   ├── routes/+page.svelte       # Main UI
│   └── lib/
│       ├── components/           # Preferences.svelte, StatusIndicator.svelte
│       └── settings.ts          # Settings state management
├── src-tauri/src/
│   ├── lib.rs                   # Tauri commands & tray setup
│   ├── audio.rs                 # cpal audio recording
│   ├── transcription.rs         # Groq API integration
│   ├── injector.rs              # Cross-platform text injection
│   └── settings.rs              # API key & settings storage
```

## Commands

```bash
cd words-of-world-tauri
npm run tauri dev    # Development
npm run tauri build  # Production build
```

## Configuration

- Default hotkey: `Alt+Space`
- API key stored in:
  - macOS: `~/Library/Application Support/words-of-world/.groq_api_key`
  - Windows: `%APPDATA%\words-of-world\.groq_api_key`
  - Linux: `~/.local/share/words-of-world/.groq_api_key`
- Settings stored in:
  - macOS: `~/Library/Application Support/words-of-world/settings.json`
  - Windows: `%APPDATA%\words-of-world\settings.json`
  - Linux: `~/.local/share/words-of-world/settings.json`
