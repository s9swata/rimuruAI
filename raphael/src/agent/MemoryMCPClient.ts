/**
 * MemoryMCPClient — singleton wrapper around the official server-memory MCP server.
 *
 * Uses BackendStdioTransport to connect over the Rust shell execution module.
 * Call `get()` to retrieve (and lazily initialize) the client instance.
 * Call `close()` during app teardown to kill the background npx process.
 */

import { createMCPClient } from "@ai-sdk/mcp";
import type { MCPClient } from "@ai-sdk/mcp";
import { invoke } from "@tauri-apps/api/core";
import { BackendStdioTransport } from "./BackendStdioTransport";
import { ToolResult } from "./types";

// ─── Singleton state ──────────────────────────────────────────────────────────

let _client: MCPClient | null = null;
let _transport: BackendStdioTransport | null = null;
let _initPromise: Promise<MCPClient> | null = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the shared MCPClient, initializing it on first call.
 * Subsequent calls return the cached instance immediately.
 */
export async function getMemoryClient(): Promise<MCPClient> {
  if (_client) return _client;

  // Guard against multiple concurrent callers racing during cold start
  if (_initPromise) return _initPromise;

  _initPromise = _init();
  try {
    _client = await _initPromise;
    return _client;
  } finally {
    _initPromise = null;
  }
}

/**
 * Cleanly shuts down the memory server process.
 * Call this in app teardown (e.g. React useEffect cleanup).
 */
export async function closeMemoryClient(): Promise<void> {
  if (_client) {
    try { await _client.close(); } catch { /* already closed */ }
    _client = null;
  }
  if (_transport) {
    try { await _transport.close(); } catch { /* already closed */ }
    _transport = null;
  }
}

// ─── Tool execution helpers ───────────────────────────────────────────────────

/**
 * Call a tool on the memory MCP server by name.
 * Returns a ToolResult compatible with the Raphael ToolRegistry contract.
 */
export async function callMemoryTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const client = await getMemoryClient();
    const toolSet = await client.tools();

    // Cast through unknown to bypass the strict ToolExecuteFunction signature
    // (which requires 2 args). We only ever pass args — options are optional in practice.
    type AnyTool = { execute: (args: Record<string, unknown>, ...rest: unknown[]) => Promise<unknown> };
    const tool = (toolSet as unknown as Record<string, AnyTool>)[toolName];
    if (!tool) {
      const available = Object.keys(toolSet).join(", ");
      return {
        success: false,
        error: `Memory tool '${toolName}' not found. Available: ${available}`,
      };
    }

    const result = await tool.execute(args);
    return { success: true, data: result };
  } catch (e) {
    console.error(`[MemoryMCPClient] callMemoryTool(${toolName}) failed:`, e);
    return { success: false, error: String(e) };
  }
}

/**
 * Returns the list of all tool names exposed by the memory server.
 * Useful for dynamically registering tools in the ToolRegistry.
 */
export async function listMemoryToolNames(): Promise<string[]> {
  try {
    const client = await getMemoryClient();
    const listed = await client.listTools();
    return listed.tools.map((t) => t.name);
  } catch (e) {
    console.error("[MemoryMCPClient] listMemoryToolNames failed:", e);
    return [];
  }
}

// ─── Internal ────────────────────────────────────────────────────────────────

async function _init(): Promise<MCPClient> {
  console.log("[MemoryMCPClient] Starting @modelcontextprotocol/server-memory via Rust...");

  // Resolve the app data directory from Rust so we get the correct
  // platform-native path (e.g. ~/Library/Application Support/raphael on macOS)
  // without hardcoding OS-specific conventions in TypeScript.
  let storagePath: string;
  try {
    const storeDir = await invoke<string>("get_store_dir");
    // Use a forward slash even on Windows — npx / Node handle both
    storagePath = `${storeDir}/memory_store.json`;
  } catch (e) {
    // Fallback: shouldn't happen in a running Tauri app, but be defensive.
    console.warn("[MemoryMCPClient] Could not get store dir from Rust, using fallback:", e);
    storagePath = "memory_store.json";
  }

  console.log(`[MemoryMCPClient] Persisting knowledge graph to: ${storagePath}`);

  _transport = new BackendStdioTransport({
    program: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory", "--storage-path", storagePath],
  });

  const client = await createMCPClient({
    transport: _transport,
    name: "raphael-memory",
    version: "1.0.0",
    onUncaughtError: (e) => {
      console.error("[MemoryMCPClient] Uncaught error from MCP server:", e);
    },
  });

  const info = client.serverInfo;
  console.log(
    `[MemoryMCPClient] Connected to ${info.name ?? "memory-server"} v${info.version ?? "?"}`
  );

  const listed = await client.listTools();
  console.log(
    "[MemoryMCPClient] Available tools:",
    listed.tools.map((t) => t.name).join(", ")
  );

  return client;
}
