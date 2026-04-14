# WordsOfWorld Tauri V2 Migration Plan

## Overview
Convert WordsOfWorld from a macOS-only Swift app to a cross-platform Tauri V2 application supporting macOS, Windows, and Linux.

---

## Core Features (Preserved)

| Feature | Description |
|---------|-------------|
| Voice Recording | Audio capture with Voice Activity Detection (VAD) |
| Transcription | Groq Whisper API integration |
| Text Processing | Boilerplate removal, capitalization, punctuation |
| Text Injection | Paste into active application |
| Menu Bar / System Tray | Status indicator with controls |
| Preferences | API key, hotkey configuration |
| Global Hotkey | Start/stop recording from any app |

---

## Architecture

### Frontend (Svelte + TypeScript)
- `src/lib/components/` - UI components
- `src/lib/stores/` - State management
- `src/routes/` - Page routes

### Backend (Rust + Tauri)
- `src-tauri/src/` - Rust source
- `src-tauri/src/commands/` - Tauri commands
- `src-tauri/src/audio/` - Audio recording
- `src-tauri/src/vad/` - Voice activity detection

### Tauri Plugins Required
| Plugin | Purpose |
|--------|---------|
| `@tauri-apps/plugin-global-shortcut` | Global hotkey registration |
| `@tauri-apps/plugin-clipboard-manager` | Clipboard read/write |
| `@tauri-apps/plugin-notification` | System notifications |
| `@tauri-apps/plugin-store` | Secure settings storage |
| `@tauri-apps/plugin-shell` | Execute paste command |

---

## Migration Strategy

### Phase 1: Project Setup
1. Initialize Tauri V2 project with Svelte
2. Configure plugins in `Cargo.toml` and `tauri.conf.json`
3. Set up logging and error handling

### Phase 2: Backend Commands (Rust)
| Command | Description |
|---------|-------------|
| `start_recording` | Begin audio capture |
| `stop_recording` | End capture, return file path |
| `transcribe` | Send audio to Groq API |
| `inject_text` | Paste text into active app |
| `get_api_key` / `set_api_key` | Secure storage |
| `check_permissions` | Mic, accessibility |

### Phase 3: Audio Recording
- Replace AVFoundation with `cpal` or `rodio` crates
- Implement VAD using energy-based detection
- Save as temporary audio file

### Phase 4: Text Injection
- Platform-specific:
  - **macOS**: `CGEvent` (existing) or Accessibility API
  - **Windows**: `SendInput` via `windows-rs`
  - **Linux**: `xdotool` or `xlib`

### Phase 5: UI Implementation
- System tray with icon states (idle, recording, processing)
- Preferences window for API key and hotkey
- Hotkey recorder component

### Phase 6: Platform-Specific Handling
| Platform | Audio API | Clipboard | Paste Method |
|----------|-----------|-----------|--------------|
| macOS | CoreAudio | NSPasteboard | CGEvent |
| Windows | WASAPI | Windows clipboard | SendInput |
| Linux | PulseAudio/X11 | X clipboard | xdotool |

---

## API Integration (Unchanged)

The Groq Whisper API logic remains identical:
- Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3-turbo`
- Multipart form upload with audio data

---

## Security
- API key stored via `@tauri-apps/plugin-store` (encrypted)
- File permissions: 0600 equivalent
- No hardcoded credentials

---

## File Structure
```
words-of-world/
├── src/                      # Frontend (Svelte)
│   ├── lib/
│   │   ├── components/
│   │   │   ├── TrayIcon.svelte
│   │   │   ├── Preferences.svelte
│   │   │   └── StatusMenu.svelte
│   │   ├── stores/
│   │   │   └── app.ts
│   │   └── api/
│   │       └── tauri.ts
│   ├── routes/
│   │   └── +page.svelte
│   └── app.html
├── src-tauri/               # Backend (Rust)
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── audio.rs
│   │   │   ├── transcription.rs
│   │   │   ├── injector.rs
│   │   │   └── settings.rs
│   │   ├── audio/
│   │   │   ├── mod.rs
│   │   │   └── vad.rs
│   │   └── platform/
│   │       ├── mod.rs
│   │       ├── macos.rs
│   │       ├── windows.rs
│   │       └── linux.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── svelte.config.js
├── tsconfig.json
└── vite.config.ts
```

---

## Implementation Order

1. **Scaffold Tauri project**
   ```bash
   npm create tauri-app@latest
   ```

2. **Add plugins**
   ```bash
   npm install @tauri-apps/plugin-global-shortcut
   npm install @tauri-apps/plugin-clipboard-manager
   npm install @tauri-apps/plugin-notification
   npm install @tauri-apps/plugin-store
   ```

3. **Implement Rust commands**
   - Audio recording with VAD
   - Groq API transcription
   - Cross-platform text injection
   - Settings management

4. **Build Svelte UI**
   - System tray integration
   - Preferences form
   - Status display

5. **Test on all platforms**
   - macOS, Windows, Linux

---

## Known Challenges

| Challenge | Solution |
|-----------|----------|
| Cross-platform VAD | Use `silence` crate or custom energy-based detection |
| Text injection security | Each OS requires different permissions |
| Global hotkey conflicts | Allow user to customize hotkey |
| Audio format compatibility | Convert to WAV before sending to API |
| Accessibility permissions | Guide user to enable in system settings |

---

## Validation Checklist

- [ ] Recording starts/stops on hotkey press
- [ ] VAD correctly detects speech vs silence
- [ ] Transcription completes via Groq API
- [ ] Text is injected into focused app
- [ ] Preferences save and load correctly
- [ ] System tray shows correct state
- [ ] Works on macOS, Windows, Linux
