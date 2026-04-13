# Integrate `@modelcontextprotocol/server-memory` into Raphael

The user wants to use the official `@modelcontextprotocol/server-memory` MCP server to handle personal chat memory, while reserving Graphify locally for a `query_codebase` tool.

## Architectural Challenge
The `@modelcontextprotocol/server-memory` runs as a Node process via `npx` and communicates using the MCP `stdio` (Standard I/O) transport layer. 
The standard `StdioClientTransport` from `@modelcontextprotocol/sdk` uses `node:child_process` natively, which is utterly incompatible with a Tauri React WebView.

**The Frontend Solution:**
Tauri v2's `@tauri-apps/plugin-shell` actually supports spawning processes and emitting raw STDOUT data, as well as exposing a `child.write("...")` method to inject STDIN strings! We can write a custom TypeScript mapping layer to bridge Tauri's shell plugin to Vercel AI SDK's MCP Client interface.

## Proposed Changes

### Phase 1: Tauri Permissions (`src-tauri/capabilities/default.json`)
To securely allow the frontend React app to spawn `npx` and attach to its stdio, we must configure Tauri's shell permissions.
- [MODIFY] `capabilities/default.json` -> Add explicit permission to execute the `npx` binary with arguments.

### Phase 2: Tauri Transport Bridge (`src/agent/TauriStdioClientTransport.ts`)
We will implement an MCP standard `Transport` class natively in the frontend bypassing Node dependencies.
- Use `Command.create("npx", ["-y", "@modelcontextprotocol/server-memory"])`.
- Map `command.on("out", (line) => ...)` to route to `this.onmessage(JSON.parse(line))`.
- Map `this.send(...)` to call `await child.write(JSON.stringify(msg) + "\n")`.

### Phase 3: Agent Tool Registration (`src/agent/index.ts` & `registry.ts`)
- Rename current local `memory.store` and `memory.query` backend bridges to a new feature name (e.g., `graphify.codebase_query`) so Graphify remains untouched for code scanning.
- Initialize `createMCPClient({ transport: new TauriStdioClientTransport(...) })`.
- Fetch tools dynamically and spread them into the `Groq` agent's tool registry.

## Open Questions
> [!NOTE]
> Does this approach look scalable to you? By writing our own `TauriStdioClientTransport.ts`, we completely avoid writing complex Rust bindings and achieve our goal natively in the React lifecycle. We strictly sandbox the permissions to ONLY run `npx` for safety.

## Verification Plan
1. Test launching `npx` from the React console over Tauri shell.
2. Verify the MCP client can successfully call `mcpClient.tools()` and load `create_entities` and `add_observations` tools.
3. Test a conversation where the agent successfully stores and retrieves a memory logically using the new MCP system.
