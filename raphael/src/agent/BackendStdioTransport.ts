/**
 * BackendStdioTransport
 *
 * Implements the @modelcontextprotocol/sdk `Transport` interface by proxying
 * JSON-RPC stdio through the Rust shell execution module instead of relying
 * on Node.js `child_process` (which is unavailable in a Tauri WebView).
 *
 * Flow:
 *   start()  → invoke("spawn_process", { program, args })  → gets back a UUID
 *   send()   → invoke("write_to_process", { id, payload })
 *   Rust     → emits "process-output" Tauri events line-by-line
 *   here     → parses each line as JSON-RPC and calls this.onmessage()
 *   close()  → invoke("kill_process", { id })
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// ─── Event payloads (mirror the Rust structs in shell_exec.rs) ───────────────

interface ProcessOutputPayload {
  id: string;
  line: string;
  is_stderr: boolean;
}

interface ProcessExitPayload {
  id: string;
  code: number | null;
}

// ─── Transport Options ────────────────────────────────────────────────────────

export interface BackendStdioTransportOptions {
  /** The executable to run, e.g. "npx" */
  program: string;
  /** Arguments to pass. e.g. ["-y", "@modelcontextprotocol/server-memory"] */
  args: string[];
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class BackendStdioTransport implements Transport {
  // MCP SDK callbacks — set by the Client before calling start()
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sessionId?: string;

  private readonly _program: string;
  private readonly _args: string[];

  /** UUID assigned by the Rust process registry on spawn */
  private _processId: string | null = null;

  /** Unlisten functions returned by listen() — cleaned up on close() */
  private _unlisten: UnlistenFn[] = [];

  constructor(options: BackendStdioTransportOptions) {
    this._program = options.program;
    this._args = options.args;
  }

  // ── Transport.start() ─────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this._processId !== null) {
      throw new Error("BackendStdioTransport: already started");
    }

    // 1. Spawn the process via Rust, get back its registry UUID
    this._processId = await invoke<string>("spawn_process", {
      program: this._program,
      args: this._args,
      cwd: null,
      usePty: false,
    });

    const pid = this._processId;

    // 2. Listen for stdout/stderr lines from Rust
    const unlistenOutput = await listen<ProcessOutputPayload>(
      "process-output",
      (event) => {
        const payload = event.payload;

        // Only handle events for our process
        if (payload.id !== pid) return;

        if (payload.is_stderr) {
          // Log stderr prominently - npm/npx errors often appear here
          console.error("[BackendStdioTransport] stderr:", payload.line);
          // Check for common errors and surface them
          if (payload.line.includes("not found") || payload.line.includes("ENOENT")) {
            console.error("[BackendStdioTransport] COMMAND NOT FOUND - check PATH in spawn_process");
          }
          return;
        }

        const raw = payload.line.trim();
        if (!raw) return;

        // Each stdout line from an MCP stdio server is a complete JSON-RPC message
        try {
          const message = JSON.parse(raw) as JSONRPCMessage;
          this.onmessage?.(message);
        } catch (e) {
          this.onerror?.(
            new Error(
              `BackendStdioTransport: failed to parse JSON-RPC message: ${raw}\n${e}`
            )
          );
        }
      }
    );

    // 3. Listen for process exit
    const unlistenExit = await listen<ProcessExitPayload>(
      "process-exit",
      (event) => {
        if (event.payload.id !== pid) return;
        this._processId = null;
        this.onclose?.();
      }
    );

    this._unlisten.push(unlistenOutput, unlistenExit);
  }

  // ── Transport.send() ──────────────────────────────────────────────────────

  async send(
    message: JSONRPCMessage,
    _options?: TransportSendOptions
  ): Promise<void> {
    if (this._processId === null) {
      throw new Error("BackendStdioTransport: not started or already closed");
    }

    const payload = JSON.stringify(message);

    await invoke("write_to_process", {
      id: this._processId,
      payload,
    });
  }

  // ── Transport.close() ─────────────────────────────────────────────────────

  async close(): Promise<void> {
    // Stop listening to Tauri events
    for (const fn of this._unlisten) {
      fn();
    }
    this._unlisten = [];

    // Kill the child process if still alive
    if (this._processId !== null) {
      try {
        await invoke("kill_process", { id: this._processId });
      } catch {
        // Process may have already exited — ignore
      }
      this._processId = null;
    }

    this.onclose?.();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Returns true if the underlying process is currently running. */
  get isRunning(): boolean {
    return this._processId !== null;
  }

  /** The current process UUID, or null if not running. */
  get processId(): string | null {
    return this._processId;
  }
}
