# rimuruAI

A collection of AI-powered productivity tools for macOS.

## Projects

### [raphael](./raphael)

A personal AI assistant that lives in your menu bar. Summon with a hotkey, chat with Groq-powered AI, send emails, manage calendar events, and search the web. Built with Tauri, React, and Rust.

### [words-of-world](./words-of-world)

A menu bar voice-to-text app. Press a hotkey, speak, and your words are transcribed and pasted directly into whatever you are typing — powered by Groq's Whisper API.

## Structure

```
rimuruAI/
├── raphael/         # AI assistant (Tauri + React + Rust)
└── words-of-world/  # Voice-to-text app (Swift)
```

## Requirements

- macOS 13 or later
- Swift 5.10+ (for words-of-world)
- Node.js 18+ (for raphael)
