# Raphael — Service Integration Reference

## What is real vs stubbed

| Service | Status |
|---------|--------|
| Gmail — send email | **Real** — Rust `send_email` command via SMTP |
| Gmail — list / read / draft | Stub (returns empty data) |
| Calendar — list / create / checkAvailability | **Real** — local Zustand store + GitHub Gist sync |
| X (Twitter) | Stub |
| Files | Stub |
| Memory | Stub |

## Gmail SMTP

### How it works
`services/index.ts` calls the Tauri command `send_email` which uses the Rust `lettre` crate to send via `smtp.gmail.com:587`.

### Credentials
Stored via `set_secret` during Onboarding:
- `gmail_address` — the user's full Gmail address
- `gmail_app_password` — a 16-character Google App Password (not the account password)

The `send_email` Rust command fetches `gmail_app_password` from SecureStore internally — it is never passed over the IPC boundary.

### Getting an App Password
1. Enable 2-Step Verification on the account
2. Go to myaccount.google.com → Security → App Passwords
3. Name it "Raphael", copy the 16-character code

---

## Calendar — GitHub Gist Sync

### How it works
Events are stored in a Zustand store (`src/calendar/store.ts`). On every mutation, the store serializes to JSON and PATCHes a private GitHub Gist (`raphael-calendar.json`). On app startup, the store reads from the Gist to restore state.

### Credentials
- `github_pat` — GitHub Personal Access Token with `gist` scope (set in Onboarding, optional)
- `github_gist_id` — auto-created on first run, saved via `set_secret`

If `github_pat` is not set, the calendar works locally only (data is lost on restart).

### Key files
- `src/calendar/types.ts` — `CalendarEvent` and `CalendarState` types
- `src/calendar/gist.ts` — `readGist`, `writeGist`, `createGist`
- `src/calendar/store.ts` — Zustand store + `calendarService` object consumed by the dispatcher
- `src/components/CalendarView.tsx` — calendar UI
