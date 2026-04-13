# Dynamic Tool Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Raphael's hardcoded tool system with a data-driven `ToolRegistry` so the agent can discover, register, and execute new HTTP tools at runtime without code changes.

**Architecture:** A `ToolRegistry` class holds all tool definitions (as data) and implementations (as functions). Built-in tools are registered at startup from existing service functions. Custom HTTP tools are persisted in `localStorage` and reloaded each session. A `tools.register` meta-tool lets the agent add new HTTP tools itself. The orchestrator's system prompt is built dynamically from the registry's current state.

**Tech Stack:** TypeScript, Vitest (tests), `localStorage` (custom tool persistence), `fetch` (HTTP tool execution). No new Rust commands needed.

---

## Codebase Context (read before touching anything)

| File | Current role | Changes |
|------|-------------|---------|
| `raphael/src/agent/dispatcher.ts` | `ServiceMap` type + `dispatch(tool,params,services)` | Swap dispatch to use `ToolRegistry` |
| `raphael/src/agent/prompts.ts` | Hardcoded tool list string in system prompt | Accept dynamic tool list from registry |
| `raphael/src/agent/orchestrator.ts` | Calls `buildSystemPrompt("orchestrator",...)` | Pass `registry.toPromptString()` |
| `raphael/src/services/index.ts` | `createServices()` returns `ServiceMap` | Unchanged — feeds into `initRegistry` |
| `raphael/src/App.tsx` | Creates services + calls dispatch per message | Init registry on startup; pass to dispatch |

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `raphael/src/agent/types.ts` | `ToolResult`, `ToolImpl`, `ToolType`, `ToolParameter`, `ToolDefinition` |
| **Create** | `raphael/src/agent/registry.ts` | `ToolRegistry` class + `initRegistry(services)` factory |
| **Create** | `raphael/src/agent/registry.test.ts` | Vitest tests for registry |
| **Modify** | `raphael/src/agent/dispatcher.ts` | Change `dispatch` to accept `ToolRegistry` instead of `ServiceMap` |
| **Modify** | `raphael/src/agent/prompts.ts` | Add `toolList` param to `buildSystemPrompt`; replace hardcoded list |
| **Modify** | `raphael/src/agent/orchestrator.ts` | Accept `ToolRegistry`; pass `toPromptString()` to prompt builder |
| **Modify** | `raphael/src/App.tsx` | Init registry once; pass to `orchestrate` and `dispatch` |

---

## Task 1: Create `types.ts`

**Files:**
- Create: `raphael/src/agent/types.ts`

This file defines the shared data types. Every other file in this plan imports from here — establish it first.

- [ ] **Step 1: Create the file**

Create `raphael/src/agent/types.ts` with this exact content:

```typescript
/** The return value of every tool execution. */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** A function that implements a tool. */
export type ToolImpl = (params: Record<string, unknown>) => Promise<ToolResult>;

/** The two supported tool execution strategies. */
export type ToolType = "builtin" | "http";

/** One parameter in a tool's parameter schema. */
export interface ToolParameter {
  type: "string" | "number" | "boolean";
  description: string;
}

/**
 * A tool definition — describes a tool as pure data.
 *
 * builtin: the executor calls the registered ToolImpl function.
 * http:    the executor calls `url` via fetch with params as JSON body.
 */
export interface ToolDefinition {
  name: string;                              // format: "service.method"
  description: string;
  parameters: Record<string, ToolParameter>;
  type: ToolType;
  url?: string;                              // http only
  method?: "GET" | "POST";                  // http only, default POST
  headers?: Record<string, string>;         // http only, optional extra headers
}
```

- [ ] **Step 2: Verify TypeScript accepts the file**

```bash
cd raphael && npx tsc --noEmit 2>&1 | grep "types.ts" | head -5
```

Expected: no output (no errors in `types.ts`).

- [ ] **Step 3: Commit**

```bash
cd raphael && git add src/agent/types.ts && git commit -m "feat: add ToolDefinition, ToolResult, ToolImpl types"
```

---

## Task 2: Create `registry.ts`

**Files:**
- Create: `raphael/src/agent/registry.ts`

This is the core of the feature. The `ToolRegistry` class holds all tool definitions + implementations, executes tools, and persists custom HTTP tools to `localStorage`. The `initRegistry` factory registers all built-in tools from the current service implementations and the `tools.register` meta-tool.

- [ ] **Step 1: Create the file**

Create `raphael/src/agent/registry.ts` with this exact content:

```typescript
import { ToolDefinition, ToolImpl, ToolResult } from "./types";
import { ServiceMap } from "./dispatcher";

const STORAGE_KEY = "raphael_custom_tools";

export class ToolRegistry {
  private defs = new Map<string, ToolDefinition>();
  private impls = new Map<string, ToolImpl>();

  /**
   * Register a tool definition.
   * For "builtin" tools, provide `impl`.
   * For "http" tools, omit `impl` — the executor handles them generically.
   */
  register(def: ToolDefinition, impl?: ToolImpl): void {
    this.defs.set(def.name, def);
    if (impl) this.impls.set(def.name, impl);
  }

  /** Get a tool definition by name. Returns undefined if not registered. */
  get(name: string): ToolDefinition | undefined {
    return this.defs.get(name);
  }

  /** Return all registered tool definitions as an array. */
  list(): ToolDefinition[] {
    return Array.from(this.defs.values());
  }

  /**
   * Format all tools as a string for inclusion in the LLM system prompt.
   * Each tool gets one line with name, description, and parameter list.
   */
  toPromptString(): string {
    return this.list()
      .map((def) => {
        const paramEntries = Object.entries(def.parameters);
        if (paramEntries.length === 0) {
          return `${def.name}: ${def.description}`;
        }
        const paramStr = paramEntries
          .map(([k, v]) => `${k} (${v.type}): ${v.description}`)
          .join(", ");
        return `${def.name}(${paramStr}): ${def.description}`;
      })
      .join("\n");
  }

  /**
   * Execute a tool by name with the given params.
   * Routes to the registered impl (builtin) or fetch (http).
   */
  async execute(name: string, params: Record<string, unknown>): Promise<ToolResult> {
    const def = this.defs.get(name);
    if (!def) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    if (def.type === "builtin") {
      const impl = this.impls.get(name);
      if (!impl) {
        return { success: false, error: `Builtin tool "${name}" has no implementation registered` };
      }
      try {
        return await impl(params);
      } catch (e) {
        return { success: false, error: String(e) };
      }
    }

    if (def.type === "http") {
      return this.executeHttp(def, params);
    }

    return { success: false, error: `Unsupported tool type: "${def.type}"` };
  }

  private async executeHttp(def: ToolDefinition, params: Record<string, unknown>): Promise<ToolResult> {
    try {
      const resp = await fetch(def.url!, {
        method: def.method ?? "POST",
        headers: { "Content-Type": "application/json", ...(def.headers ?? {}) },
        body: JSON.stringify(params),
      });
      if (!resp.ok) {
        const text = await resp.text();
        return { success: false, error: `HTTP ${resp.status}: ${text}` };
      }
      const data = await resp.json();
      return { success: true, data };
    } catch (e) {
      return { success: false, error: `HTTP tool error: ${String(e)}` };
    }
  }

  /**
   * Persist all custom (http) tools to localStorage.
   * Called automatically by tools.register after adding a new tool.
   */
  save(): void {
    const httpTools = this.list().filter((d) => d.type === "http");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(httpTools));
  }

  /**
   * Load previously saved custom (http) tools from localStorage.
   * Only registers tools whose names are not already taken by builtins.
   * Called at the end of initRegistry.
   */
  load(): void {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const tools: ToolDefinition[] = JSON.parse(raw);
      for (const def of tools) {
        if (!this.defs.has(def.name)) {
          this.defs.set(def.name, def);
        }
      }
    } catch {
      // corrupted storage — silently ignore
    }
  }
}

/**
 * Create and populate a ToolRegistry from the current service implementations.
 *
 * Call once on app startup:
 *   const registry = initRegistry(await createServices());
 *
 * The registry is a plain object — store it in a React ref or module variable.
 */
export function initRegistry(services: ServiceMap): ToolRegistry {
  const r = new ToolRegistry();

  // ── gmail ─────────────────────────────────────────────────────────────
  r.register(
    { name: "gmail.listEmails", description: "List emails in Gmail inbox", parameters: {}, type: "builtin" },
    services.gmail.listEmails,
  );
  r.register(
    {
      name: "gmail.readEmail",
      description: "Read a specific Gmail email by id",
      parameters: { id: { type: "string", description: "Email id" } },
      type: "builtin",
    },
    services.gmail.readEmail,
  );
  r.register(
    {
      name: "gmail.draftEmail",
      description: "Open the email composer with a draft for the user to review before sending",
      parameters: {
        to: { type: "string", description: "Recipient email or name" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
      },
      type: "builtin",
    },
    services.gmail.draftEmail,
  );
  r.register(
    {
      name: "gmail.sendEmail",
      description: "Send an email directly — only when user explicitly says to send",
      parameters: {
        to: { type: "string", description: "Recipient email" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body" },
      },
      type: "builtin",
    },
    services.gmail.sendEmail,
  );

  // ── calendar ──────────────────────────────────────────────────────────
  r.register(
    { name: "calendar.listEvents", description: "List upcoming calendar events", parameters: {}, type: "builtin" },
    services.calendar.listEvents,
  );
  r.register(
    {
      name: "calendar.createEvent",
      description: "Create a new calendar event",
      parameters: {
        title: { type: "string", description: "Event title" },
        start: { type: "string", description: "ISO 8601 start datetime e.g. 2026-04-14T09:00:00Z" },
        end: { type: "string", description: "ISO 8601 end datetime" },
        description: { type: "string", description: "Event description" },
      },
      type: "builtin",
    },
    services.calendar.createEvent,
  );
  r.register(
    {
      name: "calendar.checkAvailability",
      description: "Check calendar availability in a time range",
      parameters: {
        from: { type: "string", description: "ISO 8601 start of range" },
        to: { type: "string", description: "ISO 8601 end of range" },
      },
      type: "builtin",
    },
    services.calendar.checkAvailability,
  );

  // ── x (twitter) ───────────────────────────────────────────────────────
  r.register(
    { name: "x.getTimeline", description: "Get Twitter/X home timeline", parameters: {}, type: "builtin" },
    services.x.getTimeline,
  );
  r.register(
    { name: "x.getMentions", description: "Get Twitter/X mentions", parameters: {}, type: "builtin" },
    services.x.getMentions,
  );
  r.register(
    {
      name: "x.searchTweets",
      description: "Search tweets on Twitter/X",
      parameters: { query: { type: "string", description: "Search query" } },
      type: "builtin",
    },
    services.x.searchTweets,
  );

  // ── files ─────────────────────────────────────────────────────────────
  r.register(
    {
      name: "files.searchFiles",
      description: "Search for files on disk by name or content",
      parameters: { query: { type: "string", description: "Search query" } },
      type: "builtin",
    },
    services.files.searchFiles,
  );
  r.register(
    {
      name: "files.readFile",
      description: "Read the contents of a file",
      parameters: { path: { type: "string", description: "Absolute file path" } },
      type: "builtin",
    },
    services.files.readFile,
  );

  // ── memory ────────────────────────────────────────────────────────────
  r.register(
    { name: "memory.query", description: "Query the user memory/profile", parameters: {}, type: "builtin" },
    services.memory.query,
  );
  r.register(
    {
      name: "memory.saveProfile",
      description: "Save a fact about the user to long-term memory",
      parameters: { info: { type: "string", description: "Fact or preference to remember" } },
      type: "builtin",
    },
    services.memory.saveProfile,
  );

  // ── search ────────────────────────────────────────────────────────────
  r.register(
    {
      name: "search.query",
      description: "Search the web for current events or factual information",
      parameters: { query: { type: "string", description: "Search query" } },
      type: "builtin",
    },
    services.search.query,
  );

  // ── tools.register (meta-tool) ────────────────────────────────────────
  // This tool lets the agent add new HTTP tools to itself at runtime.
  // The impl closes over `r` so it can call r.register() + r.save().
  r.register(
    {
      name: "tools.register",
      description: "Register a new HTTP tool so you can call external APIs and webhooks. Use this to extend your own capabilities. After registering, the tool is immediately available.",
      parameters: {
        name: { type: "string", description: "Tool name in format 'service.method' using only lowercase letters and dots, e.g. 'weather.get'" },
        description: { type: "string", description: "One sentence describing what this tool does" },
        url: { type: "string", description: "The full HTTP endpoint URL to call with the tool params as JSON body" },
        method: { type: "string", description: "HTTP method to use: GET or POST (default: POST)" },
      },
      type: "builtin",
    },
    async (params) => {
      const name = String(params.name ?? "").trim();
      const description = String(params.description ?? "").trim();
      const url = String(params.url ?? "").trim();
      const method = String(params.method ?? "POST").toUpperCase() === "GET" ? "GET" : "POST";

      if (!name) return { success: false, error: "name is required" };
      if (!url) return { success: false, error: "url is required" };
      if (!/^[a-z][a-z0-9]*\.[a-z][a-z0-9]*$/.test(name)) {
        return { success: false, error: `name must be lowercase letters/digits in format 'service.method', got: ${name}` };
      }

      const def: ToolDefinition = {
        name,
        description: description || `HTTP tool: ${url}`,
        parameters: {},
        type: "http",
        url,
        method: method as "GET" | "POST",
      };

      r.register(def);
      r.save();

      return { success: true, data: { registered: name, url, method } };
    },
  );

  // Load any custom HTTP tools saved from a previous session
  r.load();

  return r;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | grep -E "registry\.ts|types\.ts" | head -10
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
cd raphael && git add src/agent/registry.ts && git commit -m "feat: add ToolRegistry class and initRegistry factory"
```

---

## Task 3: Write and run tests for `registry.ts`

**Files:**
- Create: `raphael/src/agent/registry.test.ts`

- [ ] **Step 1: Create the test file**

Create `raphael/src/agent/registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "./registry";
import { ToolDefinition } from "./types";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRegistry(): ToolRegistry {
  return new ToolRegistry();
}

// ── register + get + list ─────────────────────────────────────────────────────

describe("ToolRegistry.register / get / list", () => {
  let r: ToolRegistry;
  beforeEach(() => { r = makeRegistry(); });

  it("registers a builtin and retrieves it by name", () => {
    const impl = async () => ({ success: true as const, data: {} });
    r.register({ name: "test.foo", description: "foo", parameters: {}, type: "builtin" }, impl);
    expect(r.get("test.foo")).toBeDefined();
    expect(r.get("test.foo")!.name).toBe("test.foo");
  });

  it("returns undefined for an unregistered tool", () => {
    expect(r.get("nope.nope")).toBeUndefined();
  });

  it("list returns all registered tools", () => {
    r.register({ name: "a.b", description: "ab", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    r.register({ name: "c.d", description: "cd", parameters: {}, type: "http", url: "https://example.com" });
    expect(r.list()).toHaveLength(2);
    expect(r.list().map(d => d.name)).toContain("a.b");
    expect(r.list().map(d => d.name)).toContain("c.d");
  });

  it("re-registering the same name overwrites", () => {
    r.register({ name: "a.b", description: "first", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    r.register({ name: "a.b", description: "second", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    expect(r.list()).toHaveLength(1);
    expect(r.get("a.b")!.description).toBe("second");
  });
});

// ── toPromptString ────────────────────────────────────────────────────────────

describe("ToolRegistry.toPromptString", () => {
  let r: ToolRegistry;
  beforeEach(() => { r = makeRegistry(); });

  it("includes tool name and description", () => {
    r.register({ name: "weather.get", description: "Get current weather", parameters: {}, type: "http", url: "https://api.example.com" });
    const s = r.toPromptString();
    expect(s).toContain("weather.get");
    expect(s).toContain("Get current weather");
  });

  it("includes parameter names and types", () => {
    r.register({
      name: "search.query",
      description: "Search the web",
      parameters: { query: { type: "string", description: "search term" } },
      type: "builtin",
    }, async () => ({ success: true }));
    const s = r.toPromptString();
    expect(s).toContain("query");
    expect(s).toContain("string");
    expect(s).toContain("search term");
  });

  it("returns empty string when no tools registered", () => {
    expect(r.toPromptString()).toBe("");
  });

  it("lists each tool on its own line", () => {
    r.register({ name: "a.a", description: "A", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    r.register({ name: "b.b", description: "B", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    const lines = r.toPromptString().split("\n");
    expect(lines).toHaveLength(2);
  });
});

// ── execute (builtin) ─────────────────────────────────────────────────────────

describe("ToolRegistry.execute — builtin", () => {
  let r: ToolRegistry;
  beforeEach(() => { r = makeRegistry(); });

  it("calls the registered impl with params", async () => {
    const impl = vi.fn().mockResolvedValue({ success: true, data: { echo: "hi" } });
    r.register({ name: "test.echo", description: "echo", parameters: { msg: { type: "string", description: "message" } }, type: "builtin" }, impl);

    const result = await r.execute("test.echo", { msg: "hi" });
    expect(impl).toHaveBeenCalledWith({ msg: "hi" });
    expect(result.success).toBe(true);
    expect((result.data as { echo: string }).echo).toBe("hi");
  });

  it("returns error for unknown tool", async () => {
    const result = await r.execute("unknown.tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("unknown.tool");
  });

  it("returns error when builtin has no impl", async () => {
    r.register({ name: "ghost.tool", description: "no impl", parameters: {}, type: "builtin" });
    const result = await r.execute("ghost.tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("ghost.tool");
  });

  it("catches impl exceptions and returns error", async () => {
    r.register(
      { name: "bad.tool", description: "throws", parameters: {}, type: "builtin" },
      async () => { throw new Error("boom"); },
    );
    const result = await r.execute("bad.tool", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("boom");
  });
});

// ── execute (http) ────────────────────────────────────────────────────────────

describe("ToolRegistry.execute — http", () => {
  let r: ToolRegistry;
  beforeEach(() => { r = makeRegistry(); });

  it("calls fetch with the tool url and JSON body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ temperature: 22 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    r.register({
      name: "weather.get",
      description: "Get weather",
      parameters: { city: { type: "string", description: "city name" } },
      type: "http",
      url: "https://api.example.com/weather",
      method: "POST",
    });

    const result = await r.execute("weather.get", { city: "London" });
    expect(result.success).toBe(true);
    expect((result.data as { temperature: number }).temperature).toBe(22);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/weather",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ city: "London" }) }),
    );
    vi.unstubAllGlobals();
  });

  it("returns error when fetch response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    }));
    r.register({ name: "secret.get", description: "needs auth", parameters: {}, type: "http", url: "https://api.example.com/secret" });

    const result = await r.execute("secret.get", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("401");
    vi.unstubAllGlobals();
  });

  it("returns error when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network failure")));
    r.register({ name: "net.fail", description: "will fail", parameters: {}, type: "http", url: "https://offline.example.com" });

    const result = await r.execute("net.fail", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("network failure");
    vi.unstubAllGlobals();
  });
});

// ── save / load ───────────────────────────────────────────────────────────────

describe("ToolRegistry.save / load", () => {
  it("saves http tools to localStorage and loads them back", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });

    const r1 = new ToolRegistry();
    r1.register({
      name: "custom.tool",
      description: "A custom tool",
      parameters: { x: { type: "string", description: "input" } },
      type: "http",
      url: "https://example.com/custom",
      method: "POST",
    });
    r1.save();

    const r2 = new ToolRegistry();
    r2.load();

    expect(r2.get("custom.tool")).toBeDefined();
    expect(r2.get("custom.tool")!.url).toBe("https://example.com/custom");

    vi.unstubAllGlobals();
  });

  it("does not overwrite builtins when loading custom tools with the same name", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });

    // Seed localStorage with a tool that conflicts with a builtin name
    store["raphael_custom_tools"] = JSON.stringify([
      { name: "search.query", description: "HIJACK", parameters: {}, type: "http", url: "https://evil.com" },
    ]);

    const r = new ToolRegistry();
    // Register the real builtin first
    const realImpl = async () => ({ success: true as const, data: "real" });
    r.register({ name: "search.query", description: "Real search", parameters: {}, type: "builtin" }, realImpl);
    r.load(); // should NOT overwrite

    expect(r.get("search.query")!.description).toBe("Real search");

    vi.unstubAllGlobals();
  });

  it("silently ignores corrupted localStorage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "NOT VALID JSON {{{",
      setItem: () => {},
    });

    const r = new ToolRegistry();
    expect(() => r.load()).not.toThrow();

    vi.unstubAllGlobals();
  });

  it("save only persists http tools, not builtins", () => {
    let saved = "";
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (_k: string, v: string) => { saved = v; },
    });

    const r = new ToolRegistry();
    r.register({ name: "builtin.tool", description: "builtin", parameters: {}, type: "builtin" }, async () => ({ success: true }));
    r.register({ name: "http.tool", description: "http", parameters: {}, type: "http", url: "https://example.com" });
    r.save();

    const parsed: ToolDefinition[] = JSON.parse(saved);
    expect(parsed.every(d => d.type === "http")).toBe(true);
    expect(parsed.some(d => d.name === "builtin.tool")).toBe(false);

    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run tests and confirm all pass**

```bash
cd raphael && npx vitest run src/agent/registry.test.ts 2>&1 | tail -20
```

Expected output:
```
 ✓ src/agent/registry.test.ts (18)
   ✓ ToolRegistry.register / get / list (4)
   ✓ ToolRegistry.toPromptString (4)
   ✓ ToolRegistry.execute — builtin (4)
   ✓ ToolRegistry.execute — http (3)
   ✓ ToolRegistry.save / load (4)

 Test Files  1 passed (1)
 Tests  18 passed (18)
```

If any test fails: read the error message, fix `registry.ts` to make it pass, re-run. Do not proceed to the next task until all 18 tests pass.

- [ ] **Step 3: Commit**

```bash
cd raphael && git add src/agent/registry.test.ts && git commit -m "test: add full test suite for ToolRegistry"
```

---

## Task 4: Update `dispatcher.ts` — use `ToolRegistry`

**Files:**
- Modify: `raphael/src/agent/dispatcher.ts`

Currently `dispatch(tool, params, services: ServiceMap)` routes via a static map. Replace it with `dispatch(tool, params, registry: ToolRegistry)` which delegates to `registry.execute()`. Keep `requiresApprovalCheck` and `ServiceMap` exports — they're still used elsewhere.

- [ ] **Step 1: Read the current file**

Read `raphael/src/agent/dispatcher.ts`. It currently looks like:

```typescript
import { RaphaelConfig } from "../config/types";

export function requiresApprovalCheck(tool: string, config: RaphaelConfig): boolean { ... }

export interface ToolResult { ... }

export type ServiceMap = { gmail: {...}; calendar: {...}; ... };

export async function dispatch(tool, params, services: ServiceMap): Promise<ToolResult> { ... }
```

- [ ] **Step 2: Replace `dispatcher.ts` with this exact content**

```typescript
import { RaphaelConfig } from "../config/types";
import { ToolResult } from "./types";
import { ToolRegistry } from "./registry";

export { ToolResult };

export function requiresApprovalCheck(tool: string, config: RaphaelConfig): boolean {
  return config.tools[tool]?.requiresApproval ?? false;
}

/**
 * ServiceMap — kept for backward compatibility with createServices() return type.
 * initRegistry() accepts this type to register builtin implementations.
 */
export type ServiceMap = {
  gmail: {
    listEmails: (params: Record<string, unknown>) => Promise<ToolResult>;
    readEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
    draftEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
    sendEmail: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  calendar: {
    listEvents: (params: Record<string, unknown>) => Promise<ToolResult>;
    createEvent: (params: Record<string, unknown>) => Promise<ToolResult>;
    checkAvailability: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  x: {
    getTimeline: (params: Record<string, unknown>) => Promise<ToolResult>;
    getMentions: (params: Record<string, unknown>) => Promise<ToolResult>;
    searchTweets: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  files: {
    searchFiles: (params: Record<string, unknown>) => Promise<ToolResult>;
    readFile: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  memory: {
    query: (params: Record<string, unknown>) => Promise<ToolResult>;
    saveProfile: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
  search: {
    query: (params: Record<string, unknown>) => Promise<ToolResult>;
  };
};

/**
 * Execute a tool by name using the registry.
 * This replaces the old ServiceMap-based dispatch.
 */
export async function dispatch(
  tool: string,
  params: Record<string, unknown>,
  registry: ToolRegistry,
): Promise<ToolResult> {
  return registry.execute(tool, params);
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | head -20
```

Expected: errors only about `App.tsx` (it still passes `services` to `dispatch` — fixed in Task 7). No errors in `dispatcher.ts` itself.

- [ ] **Step 4: Commit**

```bash
cd raphael && git add src/agent/dispatcher.ts && git commit -m "feat: update dispatch to accept ToolRegistry instead of ServiceMap"
```

---

## Task 5: Update `prompts.ts` — dynamic tool list

**Files:**
- Modify: `raphael/src/agent/prompts.ts`

`buildSystemPrompt` currently hardcodes the tool list as a string literal. Add an optional `toolList` parameter. When provided (for the orchestrator tier), substitute it in. When absent (fast/powerful tiers), the tool list is irrelevant so nothing changes.

- [ ] **Step 1: Read the current file**

Read `raphael/src/agent/prompts.ts` lines 1–53. The orchestrator prompt contains:
```
Available tools: gmail.listEmails, gmail.readEmail, ...
```

- [ ] **Step 2: Replace `prompts.ts` with this exact content**

```typescript
import { PersonaConfig } from "../config/types";

export const MODELS = {
  orchestrator: "qwen/qwen3-32b",
  fast:         "llama-3.1-8b-instant",
  powerful:     "llama-3.3-70b-versatile",
} as const;

export type ModelTier = keyof typeof MODELS;

/**
 * Build the system prompt for a given model tier.
 *
 * @param tier        - "orchestrator" | "fast" | "powerful"
 * @param persona     - user's configured persona
 * @param profileContext - saved profile facts about the user
 * @param toolList    - optional: output of registry.toPromptString(). Only used
 *                      for the orchestrator tier. If omitted, falls back to a
 *                      static fallback message.
 */
export function buildSystemPrompt(
  tier: ModelTier,
  persona: PersonaConfig,
  profileContext: string,
  toolList?: string,
): string {
  const { address, tone, verbosity } = persona;

  if (tier === "orchestrator") {
    const tools = toolList && toolList.trim().length > 0
      ? toolList
      : "(no tools registered)";

    return `You are Raphael's orchestration layer. Analyze the user's message and respond with ONLY valid JSON.

Available tools:
${tools}

Response format:
{
  "model": "fast" | "powerful",
  "tool": "<tool_name>" | null,
  "params": { ...tool params } | null,
  "intent": "<brief description>"
}

Rules:
- Use "fast" for greetings, simple questions, status checks.
- Use "powerful" for drafting emails, complex reasoning, multi-step tasks.
- If no tool is needed, set tool and params to null.
- For gmail.draftEmail and gmail.sendEmail, params must include to, subject, body.
- For memory.saveProfile, params must include: { "info": "<fact to save>" }. Use when user shares preferences or personal details. NEVER save passwords or sensitive credentials.
- For search.query, params must include: { "query": "<search string>" }. Use for current events or factual questions.
- For tools.register, params must include: { "name": "service.method", "description": "...", "url": "https://..." }. Use this to extend your own capabilities when asked to integrate a new service.
- Use gmail.draftEmail to create drafts. Use gmail.sendEmail ONLY when the user explicitly says "send it" or "send the email".

User Profile Context:
${profileContext || "No profile information saved yet."}`;
  }

  const toneLine = tone === "jarvis"
    ? `You are Raphael — a dry-witted, supremely competent AI assistant. Address the user as "${address}". Slight sarcasm is welcome; incompetence is not. Never hedge unless genuinely uncertain. Get to the point and stop.`
    : tone === "professional"
    ? `You are Raphael, a professional AI assistant. Address the user as "${address}". Be direct and efficient.`
    : `You are Raphael, a warm and helpful AI assistant. Address the user as "${address}".`;

  const verbLine = verbosity === "terse"
    ? "Keep responses short and direct. No preamble. No trailing summaries."
    : verbosity === "verbose"
    ? "Be thorough and detailed in your responses."
    : "Balance brevity with completeness.";

  const extendedProfile = profileContext
    ? `\n\nUser Profile Context:\n${profileContext}\n`
    : "";

  if (tier === "fast") {
    return `${toneLine} ${verbLine} You are handling a quick query — be snappy.${extendedProfile}`;
  }

  return `${toneLine}\n\n${verbLine}\n\nWhen presenting results from tools, synthesize them naturally — don't just dump raw data.${extendedProfile}`;
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | grep "prompts.ts" | head -5
```

Expected: no output. The optional `toolList?` parameter means existing callers without it still compile.

- [ ] **Step 4: Commit**

```bash
cd raphael && git add src/agent/prompts.ts && git commit -m "feat: buildSystemPrompt accepts dynamic toolList param for orchestrator"
```

---

## Task 6: Update `orchestrator.ts` — pass registry to prompt

**Files:**
- Modify: `raphael/src/agent/orchestrator.ts`

`orchestrate()` currently calls `buildSystemPrompt("orchestrator", persona, profileContext)` with no tool list. Add a `registry` parameter so it can call `registry.toPromptString()` to populate the prompt dynamically.

- [ ] **Step 1: Replace `orchestrator.ts` with this exact content**

```typescript
import { generateObject } from "ai";
import { z } from "zod";
import { MODELS, buildSystemPrompt } from "./prompts";
import { PersonaConfig } from "../config/types";
import { getGroqProvider } from "./groq";
import { ToolRegistry } from "./registry";

export interface OrchestratorResult {
  model: "fast" | "powerful";
  tool: string | null;
  params: Record<string, unknown> | null;
  intent: string;
}

/**
 * Analyze the user's message and decide which tool (if any) to call.
 *
 * @param userMessage   - latest message from the user
 * @param history       - prior conversation turns
 * @param persona       - user's configured persona
 * @param profileContext - saved profile facts about the user
 * @param registry      - the live ToolRegistry; used to build the tool list in the prompt
 */
export async function orchestrate(
  userMessage: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  persona: PersonaConfig,
  profileContext: string,
  registry: ToolRegistry,
): Promise<OrchestratorResult> {
  console.log("[Orchestrator] Starting orchestration (via Vercel AI SDK)...");

  const groq = await getGroqProvider();
  const toolList = registry.toPromptString();
  const systemPrompt = buildSystemPrompt("orchestrator", persona, profileContext, toolList);

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content })),
    { role: "user", content: userMessage },
  ];

  try {
    console.log("[Orchestrator] Calling generateObject...");

    const { object } = await generateObject({
      model: groq(MODELS.orchestrator),
      providerOptions: { groq: { structuredOutputs: false } },
      messages,
      schema: z.object({
        model: z.enum(["fast", "powerful"]).describe("Which model tier to use for the user response"),
        tool: z.string().nullable().describe("The name of the tool to execute, or null if no tool needed"),
        params: z.record(z.string(), z.unknown()).nullable().describe("The parameters to pass into the tool, or null"),
        intent: z.string().describe("A brief description of what you are doing in response to the user query"),
      }),
    });

    console.log("[Orchestrator] Parsed result:", object);
    return object;
  } catch (e) {
    console.error("[Orchestrator] Error generating object:", e);
    throw e;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd raphael && npx tsc --noEmit 2>&1 | grep "orchestrator.ts" | head -5
```

Expected: no output in `orchestrator.ts`. There will be an error in `App.tsx` because `orchestrate()` now requires a 5th argument — fixed in the next task.

- [ ] **Step 3: Commit**

```bash
cd raphael && git add src/agent/orchestrator.ts && git commit -m "feat: orchestrate accepts ToolRegistry for dynamic tool list in prompt"
```

---

## Task 7: Update `App.tsx` — wire registry

**Files:**
- Modify: `raphael/src/App.tsx`

This is the final wiring task. Three changes:
1. Init the registry once on app startup (in `useEffect`) and store in a `ref`.
2. Pass `registry` to `orchestrate()` (new 5th argument).
3. Pass `registry` to `dispatch()` instead of `services`.
4. Use `registry.execute` for the email-send in `onEmailSend` (removes the second `createServices()` call).

- [ ] **Step 1: Add the registry import**

In `raphael/src/App.tsx`, find the imports block at the top. Add these two lines after the existing imports:

```typescript
import { initRegistry } from "./agent/registry";
import { ToolRegistry } from "./agent/registry";
```

Then find:
```typescript
import { createServices } from "./services";
```
Keep it — `createServices` is still used to feed `initRegistry`.

- [ ] **Step 2: Add registry ref inside the `App` component**

Find the line:
```typescript
  const loadFromGist = useCalendarStore((s) => s.loadFromGist);
```

Add these lines immediately after it:
```typescript
  const registryRef = useRef<ToolRegistry | null>(null);
```

- [ ] **Step 3: Initialize the registry in the startup `useEffect`**

Find the existing `useEffect` that starts with:
```typescript
  useEffect(() => {
    invoke<string | null>("get_secret", { key: "groq_api_key" })
```

Add registry initialization inside that same `useEffect`, after the existing `invoke("load_profile")` call. The full updated `useEffect` should look like:

```typescript
  useEffect(() => {
    invoke<string | null>("get_secret", { key: "groq_api_key" })
      .then((key) => {
        console.log("Groq key found:", !!key);
        setReady(!!key);
      })
      .catch((e) => {
        console.error("Failed to get secret:", e);
        setReady(false);
      });
    loadConfig()
      .then(setConfig)
      .catch((e) => console.error("Failed to load config:", e));

    invoke<string>("load_profile")
      .then(setProfileContent)
      .catch((e) => console.error("Failed to load profile:", e));

    createServices()
      .then((services) => {
        registryRef.current = initRegistry(services);
        console.log("[App] ToolRegistry initialized with", registryRef.current.list().length, "tools");
      })
      .catch((e) => console.error("Failed to init registry:", e));
  }, []);
```

- [ ] **Step 4: Update `handleSubmit` — remove createServices, pass registry**

Find inside `handleSubmit`:

```typescript
      const services = await createServices();
      const result = await dispatch(plan.tool, plan.params ?? {}, services);
```

Replace with:
```typescript
      const registry = registryRef.current;
      if (!registry) {
        chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "error", result: "Registry not ready" });
        setThinking(false);
        return;
      }
      const result = await dispatch(plan.tool, plan.params ?? {}, registry);
```

- [ ] **Step 5: Update the `orchestrate` call — add registry as 5th argument**

Find:
```typescript
      const plan = await orchestrate(text, history, config.persona, profileContent);
```

Replace with:
```typescript
      const plan = await orchestrate(text, history, config.persona, profileContent, registryRef.current ?? initRegistry({} as any));
```

Wait — passing `{} as any` as a fallback is ugly and fragile. Better: guard earlier and wait for the registry. Replace with:

```typescript
      if (!registryRef.current) {
        const errId = crypto.randomUUID();
        chatDispatch({ type: "ADD_MESSAGE", msg: { id: errId, role: "assistant", content: "Still initializing — please try again in a moment." } });
        setThinking(false);
        return;
      }
      const plan = await orchestrate(text, history, config.persona, profileContent, registryRef.current);
```

Place this guard at the **top** of the `try` block inside `handleSubmit`, before the `orchestrate` call.

- [ ] **Step 6: Update `onEmailSend` — use registry instead of createServices**

Find in the `ChatArea` props:
```typescript
        onEmailSend={async (id) => {
          const emailItem = state.items.find((i) => i.type === "email" && (i.data as { id: string }).id === id);
          if (!emailItem || emailItem.type !== "email") return;
          const services = await createServices();
          await services.gmail.sendEmail(emailItem.data as unknown as Record<string, unknown>);
          chatDispatch({ type: "REMOVE", id });
        }}
```

Replace with:
```typescript
        onEmailSend={async (id) => {
          const emailItem = state.items.find((i) => i.type === "email" && (i.data as { id: string }).id === id);
          if (!emailItem || emailItem.type !== "email") return;
          if (registryRef.current) {
            await registryRef.current.execute("gmail.sendEmail", emailItem.data as Record<string, unknown>);
          }
          chatDispatch({ type: "REMOVE", id });
        }}
```

- [ ] **Step 7: Remove unused `createServices` import if it's no longer called directly**

After the changes above, `createServices` is only called inside the `useEffect` to feed `initRegistry`. The import is still needed. Do NOT remove it.

Remove the unused `import { ServiceMap }` if it was ever added to App.tsx (it shouldn't have been, but check).

- [ ] **Step 8: Verify TypeScript compiles with zero errors**

```bash
cd raphael && npx tsc --noEmit 2>&1
```

Expected: zero errors. If there are errors, read them carefully — they tell you exactly what line and what's wrong. Fix each one before continuing.

- [ ] **Step 9: Commit**

```bash
cd raphael && git add src/App.tsx && git commit -m "feat: wire ToolRegistry into App — init on startup, pass to orchestrate and dispatch"
```

---

## Task 8: Run all existing tests

**Files:** (none changed — just verify)

- [ ] **Step 1: Run all tests**

```bash
cd raphael && npx vitest run 2>&1 | tail -20
```

Expected:
```
 ✓ src/agent/registry.test.ts (18)
 ✓ src/calendar/store.test.ts (...)
 ✓ src/calendar/gist.test.ts (...)

 Test Files  3 passed (3)
 Tests  N passed (N)
```

If any test fails: read the error, fix the cause in the relevant source file, re-run. Do not proceed until all tests pass.

- [ ] **Step 2: Full frontend build**

```bash
cd raphael && npx vite build 2>&1 | tail -10
```

Expected:
```
✓ built in X.XXs
```

- [ ] **Step 3: Commit**

```bash
cd raphael && git add -A && git commit -m "chore: all tests pass after tool registry integration"
```

---

## Task 9: Manual smoke test

This task cannot be automated — it verifies the live app behavior.

- [ ] **Step 1: Start the dev app**

```bash
cd raphael && npm run dev
```

Wait for the Tauri window to open.

- [ ] **Step 2: Verify existing tools still work**

Type: `search for the latest news about Rust programming language`

Expected: the search tool runs, results appear in the chat. If it fails, check the Logs panel (bottom-right button) for errors.

- [ ] **Step 3: Verify tools.register meta-tool works**

Type: `register a new tool called "joke.get" that calls https://official-joke-api.appspot.com/random_joke using GET method to get a random joke`

Expected: Raphael calls `tools.register` with name `joke.get`, url `https://official-joke-api.appspot.com/random_joke`, method `GET`. The tool card shows success.

- [ ] **Step 4: Verify the new tool is usable immediately**

Type: `tell me a joke`

Expected: Raphael calls `joke.get`, the joke API returns a joke, Raphael presents it.

- [ ] **Step 5: Verify persistence across restart**

Close the app. Reopen it. Type: `tell me a joke` again.

Expected: `joke.get` is still registered and works. It was restored from `localStorage`.

- [ ] **Step 6: Final commit**

```bash
cd raphael && git add -A && git commit -m "feat: dynamic tool registry complete — agent can self-extend with HTTP tools"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|-------------|------|
| ToolDefinition type as data | Task 1 |
| Dynamic ToolRegistry class | Task 2 |
| Tests for registry | Task 3 |
| Generic executor (builtin + http) | Task 2 (inside ToolRegistry.execute) |
| Register builtin tools from existing services | Task 2 (initRegistry) |
| `tools.register` meta-tool | Task 2 (inside initRegistry) |
| Persist custom HTTP tools to localStorage | Task 2 (save/load) |
| Dynamic orchestrator prompt | Tasks 5 + 6 |
| Wire everything in App.tsx | Task 7 |
| Verify all tests pass | Task 8 |
| Manual smoke test | Task 9 |

**No placeholders found.**

**Type consistency check:**
- `ToolResult` defined in `types.ts`, re-exported from `dispatcher.ts` — consistent.
- `ToolRegistry` created in `registry.ts`, imported in `dispatcher.ts`, `orchestrator.ts`, `App.tsx` — consistent.
- `initRegistry(services: ServiceMap)` — `ServiceMap` defined in `dispatcher.ts`, used in `registry.ts` import — consistent.
- `dispatch(tool, params, registry: ToolRegistry)` — matches the call in `App.tsx` — consistent.
- `orchestrate(..., registry: ToolRegistry)` — matches the call in `App.tsx` — consistent.
- `buildSystemPrompt(tier, persona, profileContext, toolList?)` — `toolList` is optional so existing calls without it still compile — consistent.
