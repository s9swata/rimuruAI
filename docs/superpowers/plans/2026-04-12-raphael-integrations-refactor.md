# Raphael Integrations Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Google OAuth with Gmail SMTP (app password) for email sending, and replace the Google Calendar stub with a real in-app calendar synced to a free GitHub Gist.

**Architecture:** Email sending moves entirely to the Rust backend via the `lettre` crate — the frontend calls a new Tauri command `send_email`. The calendar is a local Zustand store (same pattern as the chat store) that syncs its JSON state to a private GitHub Gist on every write and reads from it on startup. No backend server is required for either feature.

**Tech Stack:** Rust `lettre 0.11` (SMTP), GitHub Gist REST API (calendar cloud sync), Zustand (calendar local state), Vitest (tests), React (calendar UI)

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `src/calendar/types.ts` | `CalendarEvent` type and `CalendarState` type |
| `src/calendar/store.ts` | Zustand store — add / update / remove events, load / save |
| `src/calendar/gist.ts` | Read and write calendar JSON to a GitHub Gist |
| `src/components/CalendarView.tsx` | Month/list calendar UI shown in the chat area |
| `src/calendar/store.test.ts` | Unit tests for the calendar store |
| `src/calendar/gist.test.ts` | Unit tests for the Gist sync functions |

### Modified files
| Path | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add `lettre` dependency |
| `src-tauri/src/commands.rs` | Add `send_email` Tauri command |
| `src-tauri/src/lib.rs` | Register `send_email` in `invoke_handler` |
| `src/services/index.ts` | Wire `sendEmail` to Tauri command; wire calendar methods to the Zustand store |
| `src/components/Onboarding.tsx` | Replace Google OAuth step with Gmail credentials step; add GitHub PAT step |
| `raphael/docs/integration.md` | Update to reflect new approach |

---

## Part A — Gmail SMTP

### Task 1: Add `lettre` to Cargo.toml

**Files:**
- Modify: `raphael/src-tauri/Cargo.toml`

- [ ] **Step 1: Add the dependency**

Open `raphael/src-tauri/Cargo.toml`. Add to `[dependencies]`:

```toml
lettre = { version = "0.11", default-features = false, features = [
  "smtp-transport",
  "rustls-tls",
  "builder",
  "hostname",
] }
```

- [ ] **Step 2: Verify it compiles**

```bash
cd raphael/src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors (first run downloads crates, may take ~30 s).

- [ ] **Step 3: Commit**

```bash
git add raphael/src-tauri/Cargo.toml raphael/src-tauri/Cargo.lock
git commit -m "chore(deps): add lettre for SMTP email sending"
```

---

### Task 2: Add `send_email` Tauri command

**Files:**
- Modify: `raphael/src-tauri/src/commands.rs`
- Modify: `raphael/src-tauri/src/lib.rs`

- [ ] **Step 1: Add the command to `commands.rs`**

Add these imports at the top of `commands.rs`:

```rust
use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
```

Add the command at the bottom of `commands.rs` (before the last `}`):

```rust
#[tauri::command]
pub fn send_email(
    from: String,
    to: String,
    subject: String,
    body: String,
    app_password: String,
) -> Result<(), String> {
    log_to_file(&format!("send_email: from={} to={} subject={}", from, to, subject));

    let email = Message::builder()
        .from(from.parse().map_err(|e| format!("Invalid from address: {e}"))?)
        .to(to.parse().map_err(|e| format!("Invalid to address: {e}"))?)
        .subject(&subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body)
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(from.clone(), app_password);

    let mailer = SmtpTransport::relay("smtp.gmail.com")
        .map_err(|e| e.to_string())?
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| format!("SMTP error: {e}"))?;
    log_to_file("send_email: success");
    Ok(())
}
```

- [ ] **Step 2: Register the command in `lib.rs`**

In `raphael/src-tauri/src/lib.rs`, find the `invoke_handler` block and add `commands::send_email`:

```rust
.invoke_handler(tauri::generate_handler![
    commands::get_secret,
    commands::set_secret,
    commands::list_files,
    commands::read_file_content,
    commands::get_logs,
    commands::clear_logs,
    commands::send_email,
])
```

- [ ] **Step 3: Verify it compiles**

```bash
cd raphael/src-tauri && cargo check 2>&1 | tail -5
```

Expected: `Finished` with no errors.

- [ ] **Step 4: Commit**

```bash
git add raphael/src-tauri/src/commands.rs raphael/src-tauri/src/lib.rs
git commit -m "feat(smtp): add send_email Tauri command via lettre"
```

---

### Task 3: Wire `sendEmail` in the frontend service

**Files:**
- Modify: `raphael/src/services/index.ts`

- [ ] **Step 1: Replace the `sendEmail` stub**

Open `raphael/src/services/index.ts`. Replace the entire file with:

```ts
import { invoke } from "@tauri-apps/api/core";
import { ServiceMap, ToolResult } from "../agent/dispatcher";
import { calendarService } from "../calendar/store";

export async function createServices(): Promise<ServiceMap> {
  return {
    gmail: {
      listEmails: async () => ({ success: true, data: [] }),
      readEmail: async () => ({ success: true, data: {} }),
      draftEmail: async (p) => ({ success: true, data: p }),
      sendEmail: async (p) => {
        const params = p as { to?: string; subject?: string; body?: string };
        try {
          const from = await invoke<string | null>("get_secret", { key: "gmail_address" });
          const appPassword = await invoke<string | null>("get_secret", { key: "gmail_app_password" });
          if (!from || !appPassword) {
            return { success: false, error: "Gmail credentials not configured. Please complete onboarding." };
          }
          await invoke("send_email", {
            from,
            to: params.to ?? "",
            subject: params.subject ?? "(no subject)",
            body: params.body ?? "",
            appPassword,
          });
          return { success: true, data: { sent: true } };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    },
    calendar: calendarService,
    x: {
      getTimeline: async () => ({ success: true, data: [] }),
      getMentions: async () => ({ success: true, data: [] }),
      searchTweets: async () => ({ success: true, data: [] }),
    },
    files: {
      searchFiles: async () => ({ success: true, data: [] }),
      readFile: async () => ({ success: true, data: { path: "", content: "" } }),
    },
    memory: {
      query: async () => ({ success: true, data: {} }),
    },
  };
}
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (calendar store does not exist yet — ignore `Cannot find module '../calendar/store'` for now, it will be fixed in Part B).

- [ ] **Step 3: Commit**

```bash
git add raphael/src/services/index.ts
git commit -m "feat(smtp): wire sendEmail service to Tauri send_email command"
```

---

### Task 4: Update Onboarding — replace Google OAuth with Gmail credentials

**Files:**
- Modify: `raphael/src/components/Onboarding.tsx`

- [ ] **Step 1: Rewrite the Onboarding component**

Replace the entire contents of `raphael/src/components/Onboarding.tsx` with:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props { onComplete: () => void; }

type Step = "groq" | "gmail" | "github" | "done";

export default function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("groq");
  const [groqKey, setGroqKey] = useState("");
  const [gmailAddress, setGmailAddress] = useState("");
  const [gmailAppPassword, setGmailAppPassword] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [error, setError] = useState("");

  async function saveGroq() {
    if (!groqKey.startsWith("gsk_")) { setError("Groq keys start with gsk_"); return; }
    await invoke("set_secret", { key: "groq_api_key", value: groqKey });
    setError(""); setStep("gmail");
  }

  async function saveGmail() {
    if (!gmailAddress.includes("@")) { setError("Enter a valid Gmail address"); return; }
    if (!gmailAppPassword) { setError("App password required"); return; }
    await invoke("set_secret", { key: "gmail_address", value: gmailAddress });
    await invoke("set_secret", { key: "gmail_app_password", value: gmailAppPassword });
    setError(""); setStep("github");
  }

  async function saveGithub() {
    if (githubPat) {
      await invoke("set_secret", { key: "github_pat", value: githubPat });
    }
    setStep("done");
  }

  const container: React.CSSProperties = {
    height: "100vh", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", padding: 32, gap: 16,
  };

  if (step === "done") return (
    <div style={container}>
      <div style={{ color: "var(--accent)", fontSize: 14 }}>RAPHAEL ONLINE</div>
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>At your service, sir.</div>
      <button onClick={onComplete} style={btnStyle}>Begin</button>
    </div>
  );

  return (
    <div style={container}>
      <div style={{ color: "var(--accent)", letterSpacing: "0.2em", fontSize: 11 }}>
        {step === "groq"   && "STEP 1 / 3 — GROQ API KEY"}
        {step === "gmail"  && "STEP 2 / 3 — GMAIL CREDENTIALS"}
        {step === "github" && "STEP 3 / 3 — GITHUB (CALENDAR SYNC)"}
      </div>

      {step === "groq" && <>
        <SecretInput label="Groq API Key" value={groqKey} onChange={setGroqKey} />
        <HelpText>Get your key at console.groq.com</HelpText>
        <button onClick={saveGroq} style={btnStyle}>Next</button>
      </>}

      {step === "gmail" && <>
        <SecretInput label="Gmail Address" value={gmailAddress} onChange={setGmailAddress} />
        <SecretInput label="Gmail App Password" value={gmailAppPassword} onChange={setGmailAppPassword} />
        <HelpText>
          myaccount.google.com → Security → 2-Step Verification → App Passwords
        </HelpText>
        <button onClick={saveGmail} style={btnStyle}>Next</button>
      </>}

      {step === "github" && <>
        <SecretInput label="GitHub Personal Access Token (optional)" value={githubPat} onChange={setGithubPat} />
        <HelpText>
          github.com → Settings → Developer settings → Personal access tokens → gist scope only.
          Leave blank to store calendar locally only.
        </HelpText>
        <button onClick={saveGithub} style={btnStyle}>Finish</button>
      </>}

      {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
    </div>
  );
}

function SecretInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ width: "100%" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <input type="password" value={value} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", background: "var(--bg-surface)", color: "var(--text)",
          border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
          padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }} />
    </div>
  );
}

function HelpText({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{children}</div>;
}

const btnStyle: React.CSSProperties = {
  background: "var(--accent)", color: "white", border: "none",
  borderRadius: "var(--radius)", padding: "8px 24px",
  fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
};
```

- [ ] **Step 2: Check TypeScript**

```bash
cd raphael && npx tsc --noEmit 2>&1 | grep -i onboarding
```

Expected: no errors for Onboarding.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/components/Onboarding.tsx
git commit -m "feat(onboarding): replace Google OAuth with Gmail SMTP credentials + GitHub PAT"
```

---

## Part B — In-App Calendar with GitHub Gist Sync

### Task 5: Define calendar types

**Files:**
- Create: `raphael/src/calendar/types.ts`

- [ ] **Step 1: Write the failing test**

Create `raphael/src/calendar/store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { CalendarEvent } from "./types";

describe("CalendarEvent type", () => {
  it("accepts a valid event shape", () => {
    const event: CalendarEvent = {
      id: "abc-123",
      title: "Standup",
      start: "2026-04-12T10:00:00Z",
      end: "2026-04-12T10:30:00Z",
      description: "",
    };
    expect(event.id).toBe("abc-123");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd raphael && npx vitest run src/calendar/store.test.ts 2>&1 | tail -10
```

Expected: `Cannot find module './types'`

- [ ] **Step 3: Create `types.ts`**

Create `raphael/src/calendar/types.ts`:

```ts
export interface CalendarEvent {
  id: string;
  title: string;
  start: string;   // ISO 8601 string e.g. "2026-04-12T10:00:00Z"
  end: string;     // ISO 8601 string
  description: string;
}

export interface CalendarState {
  events: CalendarEvent[];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd raphael && npx vitest run src/calendar/store.test.ts 2>&1 | tail -5
```

Expected: `1 passed`

- [ ] **Step 5: Commit**

```bash
git add raphael/src/calendar/types.ts raphael/src/calendar/store.test.ts
git commit -m "feat(calendar): define CalendarEvent and CalendarState types"
```

---

### Task 6: Build the GitHub Gist sync module

**Files:**
- Create: `raphael/src/calendar/gist.ts`
- Create: `raphael/src/calendar/gist.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `raphael/src/calendar/gist.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readGist, writeGist } from "./gist";
import { CalendarState } from "./types";

const EMPTY_STATE: CalendarState = { events: [] };
const GIST_ID = "abc123";
const PAT = "ghp_test";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => mockFetch.mockReset());

describe("readGist", () => {
  it("returns parsed events from gist file content", async () => {
    const state: CalendarState = {
      events: [{ id: "1", title: "Test", start: "2026-04-12T10:00:00Z", end: "2026-04-12T11:00:00Z", description: "" }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        files: { "raphael-calendar.json": { content: JSON.stringify(state) } },
      }),
    });

    const result = await readGist(GIST_ID, PAT);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Test");
  });

  it("returns empty state when gist file is missing", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: {} }),
    });
    const result = await readGist(GIST_ID, PAT);
    expect(result).toEqual(EMPTY_STATE);
  });

  it("throws when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Not Found" });
    await expect(readGist(GIST_ID, PAT)).rejects.toThrow("Gist fetch failed: 404");
  });
});

describe("writeGist", () => {
  it("PATCHes the gist with serialized state", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    await writeGist(GIST_ID, PAT, EMPTY_STATE);

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.github.com/gists/${GIST_ID}`,
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ Authorization: `Bearer ${PAT}` }),
        body: expect.stringContaining('"events"'),
      }),
    );
  });

  it("throws when PATCH fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 422, text: async () => "Unprocessable" });
    await expect(writeGist(GIST_ID, PAT, EMPTY_STATE)).rejects.toThrow("Gist write failed: 422");
  });
});

describe("createGist", () => {
  it("POSTs and returns the new gist id", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "newid999" }) });
    const { createGist } = await import("./gist");
    const id = await createGist(PAT, EMPTY_STATE);
    expect(id).toBe("newid999");
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
cd raphael && npx vitest run src/calendar/gist.test.ts 2>&1 | tail -5
```

Expected: `Cannot find module './gist'`

- [ ] **Step 3: Implement `gist.ts`**

Create `raphael/src/calendar/gist.ts`:

```ts
import { CalendarState } from "./types";

const FILENAME = "raphael-calendar.json";
const API = "https://api.github.com/gists";

export async function readGist(gistId: string, pat: string): Promise<CalendarState> {
  const res = await fetch(`${API}/${gistId}`, {
    headers: { Authorization: `Bearer ${pat}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`Gist fetch failed: ${res.status}`);
  const data = await res.json();
  const file = data.files?.[FILENAME];
  if (!file) return { events: [] };
  try {
    return JSON.parse(file.content) as CalendarState;
  } catch {
    return { events: [] };
  }
}

export async function writeGist(gistId: string, pat: string, state: CalendarState): Promise<void> {
  const res = await fetch(`${API}/${gistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ files: { [FILENAME]: { content: JSON.stringify(state, null, 2) } } }),
  });
  if (!res.ok) throw new Error(`Gist write failed: ${res.status}`);
}

export async function createGist(pat: string, state: CalendarState): Promise<string> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: "Raphael Calendar",
      public: false,
      files: { [FILENAME]: { content: JSON.stringify(state, null, 2) } },
    }),
  });
  if (!res.ok) throw new Error(`Gist create failed: ${res.status}`);
  const data = await res.json();
  return data.id as string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd raphael && npx vitest run src/calendar/gist.test.ts 2>&1 | tail -5
```

Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add raphael/src/calendar/gist.ts raphael/src/calendar/gist.test.ts
git commit -m "feat(calendar): GitHub Gist sync module with read/write/create"
```

---

### Task 7: Build the calendar Zustand store

**Files:**
- Create: `raphael/src/calendar/store.ts`

- [ ] **Step 1: Add store tests to `store.test.ts`**

Append these tests to `raphael/src/calendar/store.test.ts` (keep the existing type test, add below it):

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useCalendarStore, calendarService } from "./store";

// Prevent actual Tauri invoke + Gist calls in tests
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("./gist", () => ({
  readGist: vi.fn().mockResolvedValue({ events: [] }),
  writeGist: vi.fn().mockResolvedValue(undefined),
  createGist: vi.fn().mockResolvedValue("gist-123"),
}));

beforeEach(() => useCalendarStore.getState().reset());

describe("calendarStore", () => {
  it("adds an event", () => {
    const { addEvent, events } = useCalendarStore.getState();
    addEvent({ id: "1", title: "Standup", start: "2026-04-12T10:00:00Z", end: "2026-04-12T10:30:00Z", description: "" });
    expect(useCalendarStore.getState().events).toHaveLength(1);
  });

  it("removes an event by id", () => {
    const store = useCalendarStore.getState();
    store.addEvent({ id: "2", title: "Review", start: "2026-04-13T14:00:00Z", end: "2026-04-13T15:00:00Z", description: "" });
    store.removeEvent("2");
    expect(useCalendarStore.getState().events).toHaveLength(0);
  });

  it("updates an event", () => {
    const store = useCalendarStore.getState();
    store.addEvent({ id: "3", title: "Old", start: "2026-04-14T09:00:00Z", end: "2026-04-14T10:00:00Z", description: "" });
    store.updateEvent("3", { title: "New" });
    expect(useCalendarStore.getState().events[0].title).toBe("New");
  });
});

describe("calendarService", () => {
  it("listEvents returns success with events array", async () => {
    useCalendarStore.getState().addEvent({ id: "4", title: "Lunch", start: "2026-04-12T12:00:00Z", end: "2026-04-12T13:00:00Z", description: "" });
    const result = await calendarService.listEvents({});
    expect(result.success).toBe(true);
    expect(Array.isArray((result.data as { events: unknown[] }).events)).toBe(true);
  });

  it("createEvent adds to store and returns success", async () => {
    const result = await calendarService.createEvent({ title: "Sprint", start: "2026-04-15T09:00:00Z", end: "2026-04-15T10:00:00Z", description: "" });
    expect(result.success).toBe(true);
    expect(useCalendarStore.getState().events.some(e => e.title === "Sprint")).toBe(true);
  });

  it("checkAvailability returns busy slots", async () => {
    useCalendarStore.getState().addEvent({ id: "5", title: "Busy", start: "2026-04-16T10:00:00Z", end: "2026-04-16T11:00:00Z", description: "" });
    const result = await calendarService.checkAvailability({ from: "2026-04-16T00:00:00Z", to: "2026-04-16T23:59:59Z" });
    expect(result.success).toBe(true);
    expect((result.data as { busy: unknown[] }).busy).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd raphael && npx vitest run src/calendar/store.test.ts 2>&1 | tail -10
```

Expected: failures on the store imports.

- [ ] **Step 3: Implement `store.ts`**

Create `raphael/src/calendar/store.ts`:

```ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { CalendarEvent } from "./types";
import { readGist, writeGist, createGist } from "./gist";
import { ToolResult } from "../agent/dispatcher";

interface CalendarStore {
  events: CalendarEvent[];
  addEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => void;
  reset: () => void;
  loadFromGist: () => Promise<void>;
}

export const useCalendarStore = create<CalendarStore>((set, get) => ({
  events: [],

  addEvent: (event) => {
    set((s) => ({ events: [...s.events, event] }));
    syncToGist(get().events);
  },

  removeEvent: (id) => {
    set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
    syncToGist(get().events);
  },

  updateEvent: (id, patch) => {
    set((s) => ({ events: s.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    syncToGist(get().events);
  },

  reset: () => set({ events: [] }),

  loadFromGist: async () => {
    const pat = await invoke<string | null>("get_secret", { key: "github_pat" });
    if (!pat) return; // no PAT — local only
    let gistId = await invoke<string | null>("get_secret", { key: "github_gist_id" });
    if (!gistId) {
      gistId = await createGist(pat, { events: [] });
      await invoke("set_secret", { key: "github_gist_id", value: gistId });
    }
    const state = await readGist(gistId, pat);
    set({ events: state.events });
  },
}));

async function syncToGist(events: CalendarEvent[]) {
  try {
    const pat = await invoke<string | null>("get_secret", { key: "github_pat" });
    if (!pat) return;
    const gistId = await invoke<string | null>("get_secret", { key: "github_gist_id" });
    if (!gistId) return;
    await writeGist(gistId, pat, { events });
  } catch (e) {
    console.error("[Calendar] Gist sync failed:", e);
  }
}

export const calendarService = {
  listEvents: async (_params: Record<string, unknown>): Promise<ToolResult> => {
    const { events } = useCalendarStore.getState();
    return { success: true, data: { events } };
  },

  createEvent: async (params: Record<string, unknown>): Promise<ToolResult> => {
    const event: CalendarEvent = {
      id: crypto.randomUUID(),
      title: String(params.title ?? "Untitled"),
      start: String(params.start ?? new Date().toISOString()),
      end: String(params.end ?? new Date().toISOString()),
      description: String(params.description ?? ""),
    };
    useCalendarStore.getState().addEvent(event);
    return { success: true, data: { eventId: event.id } };
  },

  checkAvailability: async (params: Record<string, unknown>): Promise<ToolResult> => {
    const { events } = useCalendarStore.getState();
    const from = params.from ? new Date(String(params.from)) : new Date(0);
    const to = params.to ? new Date(String(params.to)) : new Date(8640000000000000);
    const busy = events
      .filter((e) => new Date(e.end) > from && new Date(e.start) < to)
      .map((e) => ({ start: e.start, end: e.end }));
    return { success: true, data: { busy } };
  },
};
```

- [ ] **Step 4: Run all calendar tests**

```bash
cd raphael && npx vitest run src/calendar/ 2>&1 | tail -10
```

Expected: all tests pass (around 10 total).

- [ ] **Step 5: Commit**

```bash
git add raphael/src/calendar/store.ts raphael/src/calendar/store.test.ts
git commit -m "feat(calendar): Zustand store with add/remove/update and GitHub Gist sync"
```

---

### Task 8: Build the CalendarView UI component

**Files:**
- Create: `raphael/src/components/CalendarView.tsx`

- [ ] **Step 1: Create the component**

Create `raphael/src/components/CalendarView.tsx`:

```tsx
import { useState } from "react";
import { useCalendarStore } from "../calendar/store";
import { CalendarEvent } from "../calendar/types";

export default function CalendarView() {
  const { events, addEvent, removeEvent } = useCalendarStore();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", start: "", end: "", description: "" });
  const [error, setError] = useState("");

  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));

  function formatDateTime(iso: string) {
    try {
      return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  }

  function handleAdd() {
    if (!form.title.trim()) { setError("Title required"); return; }
    if (!form.start) { setError("Start time required"); return; }
    if (!form.end) { setError("End time required"); return; }
    if (new Date(form.end) <= new Date(form.start)) { setError("End must be after start"); return; }
    addEvent({ id: crypto.randomUUID(), title: form.title, start: new Date(form.start).toISOString(), end: new Date(form.end).toISOString(), description: form.description });
    setForm({ title: "", start: "", end: "", description: "" });
    setShowAdd(false);
    setError("");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--bg-surface)", color: "var(--text)",
    border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
    padding: "6px 10px", fontFamily: "var(--font-mono)", fontSize: 11, outline: "none",
  };

  return (
    <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", color: "var(--accent)" }}>CALENDAR</span>
        <button onClick={() => setShowAdd((v) => !v)} style={{ background: "none", border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)", color: "var(--text-muted)", padding: "3px 10px", fontSize: 11, cursor: "pointer" }}>
          {showAdd ? "Cancel" : "+ Event"}
        </button>
      </div>

      {showAdd && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px", background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--accent-dim)" }}>
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={inputStyle} />
          <input type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={inputStyle} />
          <input type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} style={inputStyle} />
          <input placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} style={inputStyle} />
          {error && <div style={{ color: "var(--danger)", fontSize: 11 }}>{error}</div>}
          <button onClick={handleAdd} style={{ alignSelf: "flex-end", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", padding: "5px 16px", fontSize: 11, cursor: "pointer" }}>
            Save
          </button>
        </div>
      )}

      {sorted.length === 0 && !showAdd && (
        <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: "16px 0" }}>
          No events. Hit + Event to add one.
        </div>
      )}

      {sorted.map((event: CalendarEvent) => (
        <div key={event.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 10px", background: "var(--bg-surface)", borderRadius: "var(--radius)", border: "1px solid var(--accent-dim)" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{event.title}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {formatDateTime(event.start)} → {formatDateTime(event.end)}
            </div>
            {event.description && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{event.description}</div>}
          </div>
          <button onClick={() => removeEvent(event.id)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Check TypeScript**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add raphael/src/components/CalendarView.tsx
git commit -m "feat(calendar): CalendarView component with event list and add form"
```

---

### Task 9: Wire CalendarView into App and load calendar on startup

**Files:**
- Modify: `raphael/src/App.tsx`

- [ ] **Step 1: Import and wire**

In `raphael/src/App.tsx`, add these two imports near the top:

```ts
import CalendarView from "./components/CalendarView";
import { useCalendarStore } from "./calendar/store";
```

Inside the `App` component, after the existing `useEffect` that loads config, add a second `useEffect` to load calendar data from Gist:

```ts
const loadFromGist = useCalendarStore((s) => s.loadFromGist);

useEffect(() => {
  loadFromGist().catch((e) => console.error("Calendar load error:", e));
}, [loadFromGist]);
```

Then add `<CalendarView />` inside the main layout, between the header bar and `<ChatArea />`:

```tsx
<div style={{ borderBottom: "1px solid #1e1e2e", flexShrink: 0, maxHeight: 300, overflowY: "auto" }}>
  <CalendarView />
</div>
```

- [ ] **Step 2: Check TypeScript**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run all tests**

```bash
cd raphael && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add raphael/src/App.tsx
git commit -m "feat(calendar): load calendar from Gist on startup, show CalendarView in layout"
```

---

### Task 10: Update `integration.md`

**Files:**
- Modify: `raphael/docs/integration.md`

- [ ] **Step 1: Rewrite the doc**

Replace the entire contents of `raphael/docs/integration.md` with:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add raphael/docs/integration.md
git commit -m "docs: update integration.md to reflect SMTP + Gist calendar"
```

---

## Self-Review

**Spec coverage:**
- Gmail SMTP via lettre ✓ (Tasks 1–4)
- App password credentials ✓ (Task 4 Onboarding)
- Remove Google OAuth ✓ (Task 4 — old OAuth step replaced)
- Custom in-app calendar ✓ (Tasks 5–9)
- Free cloud storage (GitHub Gist) ✓ (Tasks 6–7)
- Calendar UI ✓ (Task 8)
- Docs updated ✓ (Task 10)

**No placeholders:** All code steps contain complete, runnable code.

**Type consistency:** `CalendarEvent` defined in Task 5 `types.ts`, imported identically in Tasks 6, 7, 8. `calendarService` exported from `store.ts` (Task 7) and consumed in `services/index.ts` (Task 3, which imports `"../calendar/store"`). `ToolResult` imported from `"../agent/dispatcher"` consistently throughout.
