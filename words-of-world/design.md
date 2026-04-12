# WordsOfWorld Design Document

Last updated: 2026-04-12

## Architecture Overview

WordsOfWorld is a macOS menu bar application that provides voice-to-text capabilities using Groq's Whisper API.

## System Architecture (from Graph Analysis)

### Core Components

| Component | Community | Description |
|-----------|----------|-------------|
| `AppDelegate` | Voice-to-Text Feature | Central hub with 11 edges - main coordinator |
| `Voice-to-Text Implementation Plan` | Voice-to-Text Feature | Feature roadmap, 10 edges |
| `Voice-to-Text Design Spec` | Voice-to-Text Feature | Design specification, 9 edges |
| `KeychainManager` | Keychain Infrastructure | Keychain storage, 7 edges |
| `KeychainManagerTests` | Keychain Manager Tests | Unit tests |
| `MenuBarController` | UI State & Recording | Menu bar UI state |
| `PasteInjector` | UI State & Recording | Text injection |
| `RecordingState` | UI State & Recording | Recording state management |

### Community Structure

1. **Voice-to-Text Feature** (Cohesion: 0.5)
   - AppDelegate, GroqTranscriber, HotkeyManager, PreferencesWindowController, RecorderManager, TextProcessor, Voice-to-Text Design Spec, Voice-to-Text Implementation Plan

2. **Keychain Infrastructure** (Cohesion: 0.4)
   - KeychainManager, KeychainError, KeychainManagerTests, Groq Whisper API, macOS Keychain

3. **UI State & Recording** (Cohesion: 0.67)
   - MenuBarController, PasteInjector, RecordingState

4. **AppDelegate Class** (Cohesion: 0.5)
   - AppDelegate, NSApplicationDelegate, NSObject

## Key Relationships

### Extracted (Confirmed)
- `words_of_world_app` → `app_delegate` (instantiates)
- `keychain_manager` → `keychain_error` (implements)
- `keychain_manager_tests` → `keychain_manager` (tests)
- `voice_to_text_implementation_plan` → `voice_to_text_design_spec` (references)
- `groq_transcriber` → `groq_api` (calls)

### Inferred (Need Verification)
- `app_delegate` → `menu_bar_controller` (coordinates UI)
- `app_delegate` → `hotkey_manager` (registers hotkeys)
- `app_delegate` → `recorder_manager` (controls recording)
- `app_delegate` → `groq_transcriber` (transcribes audio)
- `app_delegate` → `text_processor` (processes output)
- `app_delegate` → `paste_injector` (injects text)
- `app_delegate` → `keychain_manager` (stores credentials)
- `app_delegate` → `preferences_window_controller` (shows preferences)
- `keychain_manager` → `groq_api` (uses credentials)

## Knowledge Gaps

### Isolated Nodes (Need Connections)
- `WordsOfWorld Package` - Package.swift
- `WordsOfWorldApp` - App entry point
- `KeychainError` - Error type
- `KeychainManagerTests` - Test class
- `macOS Keychain` - macOS integration

### Recommendations
1. Connect `WordsOfWorldApp` directly to `AppDelegate` for proper app lifecycle
2. Add error handling paths from `KeychainError` to UI components
3. Expand test coverage for `KeychainManager` edge cases

## Data Flow

```
User Input (Hotkey)
    ↓
HotkeyManager
    ↓
RecorderManager (records audio)
    ↓
GroqTranscriber → Groq Whisper API (transcribes)
    ↓
TextProcessor (processes text)
    ↓
PasteInjector (injects into active app)
    ↓
KeychainManager (stores API key securely)
```

## Security

- API keys stored in macOS Keychain via `KeychainManager`
- `KeychainError` handles load/save failures gracefully

## Testing

- `KeychainManagerTests` covers:
  - Save/load roundtrip
  - Save overwrites previous key
  - Delete removes key
  - Throws when no key exists