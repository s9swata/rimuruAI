import { ToolDefinition, ToolImpl, ToolResult, ToolParameter } from "./types";
import { ServiceMap, ResourceManifest } from "./dispatcher";
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

  // ── memory (MCP server-memory) ────────────────────────────────────────
  r.register(
    {
      name: "memory.query",
      description: "Search the personal memory graph for facts about specific entities (people, projects, organizations). Do NOT use this to recall the user's core preferences (which are already in your system prompt).",
      parameters: {
        query: { type: "string", description: "Entity search query, e.g. 'Ravi' or 'Google'" },
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
      description: "Store a fact into the personal memory graph. Use this when the user tells you something worth remembering — a person, project, organization, or event.",
      parameters: {
        text: { type: "string", description: "The factual statement to remember. E.g. 'Sarah works at Acme Corp'." },
        entityName: { type: "string", description: "Optional: the name of the entity this fact is about (e.g. 'Sarah'). Auto-generated if omitted." },
        entityType: { type: "string", description: "Optional: category of entity — 'person', 'project', 'organization', 'event'. Defaults to 'fact'." },
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

  // ── resources (service tools) ─────────────────────────────────────────
  r.register(
    {
      name: "resources.listManifests",
      description: "List all defined resource types. Use to check if a resource type already exists before defining a new one.",
      parameters: {},
      type: "builtin",
    },
    async () => {
      try {
        const data = await services.resources.listManifests();
        return { success: true, data };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  );
  r.register(
    {
      name: "resources.find",
      description: "Find items in a resource type by search query. Requires resource_type to be specified.",
      parameters: {
        resource_type: { type: "string", description: "The resource type to search in" },
        query: { type: "string", description: "Search query" },
      },
      type: "builtin",
    },
    async (params) => {
      try {
        const resource_type = String(params.resource_type ?? "").trim();
        const query = String(params.query ?? "").trim();
        if (!resource_type) return { success: false, error: "resource_type is required" };
        const data = await services.resources.find(resource_type, query);
        return { success: true, data };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  );

  // ── resources.define (meta-tool) ─────────────────────────────────────
  // Lets the agent define new resource types and immediately bootstraps their tools.
  r.register(
    {
      name: "resources.define",
      description: "Create a new resource type the agent can store and retrieve. Use when user needs to persistently track a new kind of data (contacts, notes, tasks, bookmarks, etc). After defining, the resource tools are immediately available.",
      parameters: {
        manifest: { type: "string", description: "JSON-encoded ResourceManifest object with resource_type, description, fields, and tools" },
      },
      type: "builtin",
    },
    async (params) => {
      try {
        const manifest = (
          typeof params.manifest === "string"
            ? JSON.parse(params.manifest)
            : params.manifest
        ) as ResourceManifest;
        const result = await services.resources.define(manifest);
        registerManifestTools(r, result, services);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
  );

  // Load any custom HTTP tools saved from a previous session
  r.load();

  return r;
}

// ── Resource tool bootstrapper ────────────────────────────────────────────────

/**
 * Build the parameter schema for a resource tool operation.
 */
function buildParamsSchema(manifest: ResourceManifest, op: string): Record<string, ToolParameter> {
  switch (op) {
    case "find":
      return { query: { type: "string", description: "Search query string" } };
    case "upsert": {
      const schema: Record<string, ToolParameter> = {};
      for (const field of manifest.fields) {
        const fieldType = field.field_type === "number"
          ? "number"
          : field.field_type === "boolean"
          ? "boolean"
          : "string";
        schema[field.name] = { type: fieldType as "string" | "number" | "boolean", description: `${field.name} field` };
      }
      return schema;
    }
    case "list":
      return {};
    case "delete":
      return { id: { type: "string", description: "ID of the item to delete" } };
    default:
      return {};
  }
}

/**
 * Register all tools defined in a ResourceManifest into the given registry.
 */
export function registerManifestTools(registry: ToolRegistry, manifest: ResourceManifest, services: ServiceMap): void {
  for (const tool of manifest.tools) {
    registry.register(
      {
        name: tool.name,
        description: tool.description,
        parameters: buildParamsSchema(manifest, tool.op),
        type: "builtin",
      },
      async (params: Record<string, unknown>) => {
        try {
          switch (tool.op) {
            case "find":
              return { success: true, data: await services.resources.find(manifest.resource_type, params.query as string) };
            case "upsert":
              return { success: true, data: await services.resources.upsert(manifest.resource_type, params) };
            case "list":
              return { success: true, data: await services.resources.list(manifest.resource_type) };
            case "delete":
              return { success: true, data: await services.resources.delete(manifest.resource_type, params.id as string) };
            default:
              return { success: false, error: `Unknown op: ${tool.op}` };
          }
        } catch (e) {
          return { success: false, error: String(e) };
        }
      },
    );
  }
}

/**
 * Load all previously defined resource manifests from the backend and register
 * their tools into the registry. Call once after initRegistry on app startup.
 */
export async function bootstrapResourceTools(registry: ToolRegistry, services: ServiceMap): Promise<void> {
  try {
    const manifests = await services.resources.listManifests();
    for (const manifest of manifests) {
      registerManifestTools(registry, manifest, services);
    }
    if (manifests.length > 0) {
      console.log(`[ResourceBootstrap] Registered tools for ${manifests.length} resource type(s)`);
    }
  } catch {
    // No resources defined yet, or backend unavailable — silently continue
  }
}
