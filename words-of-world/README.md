# WordsOfWorld

A macOS menu bar app that transcribes your voice and pastes the text wherever your cursor is. Press a hotkey, speak, release — the words appear.

Powered by [Groq's Whisper API](https://console.groq.com) for fast, accurate transcription.

## Features

- **Global hotkey** — `⌥ Space` starts and stops recording from anywhere
- **Push-to-talk mode** — hold the hotkey to record, release to transcribe
- **Direct paste** — transcribed text is injected into the active input field
- **Menu bar indicator** — icon changes to show idle / recording / processing state
- **Secure API key storage** — key saved to `~/Library/Application Support/com.rimuruai.words-of-world/` with `chmod 600`, no Keychain prompts

## Requirements

- macOS 13 or later
- A [Groq API key](https://console.groq.com) (free tier available)
- Swift 5.10+ (for building from source)

## Installation

### Build and run as an .app bundle (recommended)

```bash
cd words-of-world
make run
```

This builds the binary, wraps it in a signed `.app` bundle, and launches it. The `WordsOfWorld.app` is created in the `words-of-world/` directory.

### Build only (development)

```bash
cd words-of-world
swift build
.build/debug/WordsOfWorld
```

### Other make targets

| Command | Description |
|---------|-------------|
| `make build` | Compile only |
| `make app` | Build and create signed `.app` bundle |
| `make run` | Build, bundle, and launch |
| `make test` | Run the test suite |
| `make clean` | Remove build artifacts and `.app` |

## Setup

1. Launch the app — a microphone icon appears in the menu bar.
2. Click the icon and open **Preferences**.
3. Paste your Groq API key and click **Save**.
4. Grant microphone access and accessibility permissions when prompted (one-time).

## Usage

| Action | How |
|--------|-----|
| Start / stop recording | `⌥ Space` (toggle mode) |
| Push-to-talk | Hold `⌥ Space`, release to transcribe |
| Switch mode | Preferences → Push-to-Talk Mode checkbox |
| Open Preferences | Click menu bar icon → Preferences |
| Quit | Click menu bar icon → Quit |

When recording starts the icon turns red. When the audio is being sent to Groq it turns blue. When the text is ready a blue border briefly highlights the focused input field and the text is pasted.

## Architecture

```
WordsOfWorldApp          Entry point — bootstraps NSApplication
AppDelegate              Central coordinator, owns the recording lifecycle
  ├── MenuBarController  Status item icon and menu, visual state machine
  ├── HotkeyManager      Registers ⌥ Space via Carbon hotkey API
  ├── RecorderManager    AVAudioEngine tap → .m4a temp file
  ├── GroqTranscriber    Multipart POST to Groq Whisper API
  ├── TextProcessor      Strips boilerplate, normalises capitalisation
  ├── PasteInjector      Writes to pasteboard, simulates ⌘V via CGEvent
  │     └── FocusHighlightPanel  Blue border overlay on the active field
  └── PreferencesWindowController  API key input, hotkey recorder, mode toggle
        └── KeychainManager  File-based API key storage (chmod 600)
```

### Data flow

```
⌥ Space pressed
    → HotkeyManager fires .pressed
    → AppDelegate.toggleRecording()
    → RecorderManager installs AVAudioEngine tap
    → audio written to /tmp/recording_<uuid>.m4a

⌥ Space pressed again (or released in push-to-talk mode)
    → RecorderManager stops, returns file URL
    → GroqTranscriber POSTs multipart/form-data to Groq
    → TextProcessor cleans the transcript
    → PasteInjector writes text to pasteboard, shows border, sends ⌘V
    → temp file deleted
```

## Permissions

The app requests two permissions on first launch:

- **Microphone** — required to record audio
- **Accessibility** — required to simulate the ⌘V paste keystroke and draw the focus border overlay

## Project structure

```
words-of-world/
├── Package.swift
├── Makefile
├── WordsOfWorld/
│   ├── WordsOfWorldApp.swift
│   ├── AppDelegate.swift
│   ├── MenuBarController.swift
│   ├── HotkeyManager.swift
│   ├── RecorderManager.swift
│   ├── GroqTranscriber.swift
│   ├── TextProcessor.swift
│   ├── PasteInjector.swift
│   ├── PreferencesWindowController.swift
│   ├── Storage/
│   │   └── KeychainManager.swift
│   ├── Info.plist
│   └── WordsOfWorld.entitlements
└── WordsOfWorldTests/
    └── KeychainManagerTests.swift
```
