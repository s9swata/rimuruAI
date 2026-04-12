# Voice-to-Text Agent — Design Spec
**Date:** 2026-04-12
**Project:** words-of-world (rimuruAI suite)
**Status:** Approved

---

## Overview

A native macOS menu bar application that captures voice input via a global hotkey, transcribes it using Groq's Whisper-large-v3-turbo API, applies smart text cleanup, and auto-pastes the result into whatever text field is currently focused on screen. Fully self-contained — BYOK (bring your own Groq API key), no backend, no App Store.

---

## Architecture

The app is structured as six isolated units with clear interfaces:

```
┌─────────────────────────────────────────────────────┐
│                   MenuBarApp                        │
│  (AppDelegate + StatusItem + lifecycle)             │
└────────────┬────────────────────────┬───────────────┘
             │                        │
     ┌───────▼──────┐        ┌────────▼────────┐
     │  HotkeyManager│        │  RecorderManager │
     │ (Carbon/AppKit│        │  (AVFoundation)  │
     │  global hook) │        │  records to .m4a │
     └───────┬───────┘        └────────┬─────────┘
             │ triggers                │ audio file
             └──────────┬─────────────┘
                        │
               ┌────────▼────────┐
               │  GroqTranscriber │
               │  (URLSession +   │
               │  whisper-turbo)  │
               └────────┬─────────┘
                        │ raw text
               ┌────────▼────────┐
               │  TextProcessor   │
               │  (smart cleanup) │
               └────────┬─────────┘
                        │ clean text
               ┌────────▼────────┐
               │  PasteInjector   │
               │  (NSPasteboard + │
               │   CGEvent paste) │
               └─────────────────┘
```

**Flow:** Hotkey press → start recording → second hotkey press → stop recording → send to Groq → clean text → paste into focused field.

---

## Components

### MenuBarApp
- `LSUIElement = true` in Info.plist — no Dock icon, menu bar only
- Status icon cycles through three states:
  - **Idle** — microphone outline
  - **Recording** — red filled microphone
  - **Processing** — activity spinner
- Menu items:
  - "Start Recording" (mirrors hotkey)
  - Separator
  - "Preferences" — opens settings panel for hotkey binding and API key entry
  - Separator
  - "Quit"
- Owns and wires all other managers

### HotkeyManager
- Registers a system-wide global hotkey using Carbon's `RegisterEventHotKey`
- Default binding: `⌥Space` (Option + Space)
- Supports two modes (configurable in Preferences):
  - **Toggle mode** — first press starts, second press stops
  - **Push-to-talk mode** — hold to record, release to stop
- Works regardless of which app is frontmost

### RecorderManager
- Captures microphone input using `AVAudioEngine`
- Records to a temporary `.m4a` file in `FileManager.default.temporaryDirectory`
- Requests microphone permission on first use via `AVCaptureDevice.requestAccess`; shows alert with link to System Settings if denied
- Enforces 60-second max recording length (sufficient for dictation; protects against runaway sessions)

### GroqTranscriber
- Sends audio as `multipart/form-data` POST to:
  `https://api.groq.com/openai/v1/audio/transcriptions`
- Parameters: `model=whisper-large-v3-turbo`, `language=en`, `response_format=text`
- API key retrieved from macOS Keychain via the `Security` framework
- Error cases surface as macOS notifications (see Error Handling section)

### TextProcessor
- Capitalizes the first character of the transcript
- Ensures transcript ends with punctuation — appends `.` if none present
- Trims leading/trailing whitespace
- Strips known Whisper boilerplate artifacts (e.g. "Transcribed by OpenAI Whisper")

### PasteInjector
- Saves current `NSPasteboard` contents
- Writes cleaned transcript to pasteboard
- Fires a `⌘V` `CGEvent` to paste into the currently focused input field
- Restores original clipboard contents after 500ms delay
- Requires Accessibility permission; prompts user to grant in System Settings > Privacy & Security > Accessibility on first use

---

## Permissions

| Permission | Purpose | Trigger |
|---|---|---|
| Microphone | Audio capture | First recording attempt |
| Accessibility | CGEvent paste injection | First paste attempt |

Both are requested lazily on first use with a clear explanation dialog.

---

## Storage

| Data | Storage Location |
|---|---|
| Groq API key | macOS Keychain (Security framework) |
| Hotkey binding | `UserDefaults` |
| Push-to-talk preference | `UserDefaults` |
| Temporary audio files | System temp dir — deleted immediately after transcription |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Microphone permission denied | Alert dialog with link to System Settings |
| Accessibility permission denied | Alert dialog with link to System Settings |
| No API key configured | Menu bar badge indicator + prompt to open Preferences |
| Groq API error / network failure | macOS notification: "Transcription failed: \<reason\>" |
| Recording shorter than 0.5s | Silently discard — no paste, no notification |
| Paste into non-text field | No-op — CGEvent fires harmlessly |

---

## Language & Transcription

- Language locked to English (`language=en`) at the API call level for accuracy
- Model: `whisper-large-v3-turbo` on Groq Cloud (free tier)

---

## Distribution

- Distributed as a `.app` bundle built locally with Xcode
- No App Store, no mandatory code signing
- First-run: right-click → Open to bypass Gatekeeper, or user can sign with a free Apple Developer account

---

## Out of Scope

- Multi-language support (future)
- Command mode (spoken punctuation/formatting commands)
- On-device transcription (no Groq dependency)
- Auto-launch at login (can be added manually via Login Items)
