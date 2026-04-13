import { ToolDefinition, ToolImpl, ToolResult } from "./types";
import { ServiceMap } from "./dispatcher";
import { invoke } from "@tauri-apps/api/core";

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
      const isGet = def.method === "GET";
      const body = isGet ? undefined : JSON.stringify(params);
      
      const data = await invoke<unknown>("http_fetch", {
        params: {
          url: def.url,
          method: def.method ?? "POST",
          body: body,
        },
      });
      
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
    {
      name: "memory.query",
      description: "Search the knowledge graph for entities and relationships related to a topic. Returns a synthesized text summary of relevant graph context.",
      parameters: {
        query: { type: "string", description: "Plain text query, e.g. 'What is Priya's job?' or 'machine learning projects'" },
      },
      type: "builtin",
    },
    services.memory.query,
  );
  r.register(
    {
      name: "memory.saveProfile",
      description: "Save a personal fact or preference about the user to the flat profile (PROFILE.md). Use for simple biographical facts.",
      parameters: { info: { type: "string", description: "Fact or preference to remember, e.g. 'User prefers dark mode'" } },
      type: "builtin",
    },
    services.memory.saveProfile,
  );
  r.register(
    {
      name: "memory.store",
      description: "Store facts and relationships into the central memory graph. Use this when you learn something worth remembering.",
      parameters: {
        text: { type: "string", description: "The factual text to append to the memory log. E.g. 'User likes dark mode' or 'Priya works at Google'." },
      },
      type: "builtin",
    },
    services.memory.store,
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
