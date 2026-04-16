import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Onboarding from "./components/Onboarding";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import CalendarView from "./components/CalendarView";
import SettingsPanel from "./components/SettingsPanel";
import ApprovalDialog from "./components/ApprovalDialog";
import { useChatStore, ADD_SHELL, APPEND_SHELL_LINE, FINISH_SHELL } from "./store/chat";
import { useCalendarStore } from "./calendar/store";
import { loadConfig } from "./config/loader";
import { RaphaelConfig, DEFAULT_CONFIG } from "./config/types";
import { orchestrate } from "./agent/orchestrator";
import { pickModel } from "./agent/router";
import { dispatch, requiresApprovalCheck } from "./agent/dispatcher";
import { streamChat } from "./agent/groq";
import { buildSystemPrompt } from "./agent/prompts";
import { createServices } from "./services";
import { initRegistry, ToolRegistry, bootstrapResourceTools } from "./agent/registry";
import type { FileAttachment } from "./components/FileAttachmentList";

function DebugPanel() {
  const [logs, setLogs] = useState<string[]>([]);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (show) {
      // Collect console logs
      const interval = setInterval(() => {
        const logsJson = localStorage.getItem("raphael_logs") || "[]";
        try {
          setLogs(JSON.parse(logsJson));
        } catch {}
      }, 500);
      return () => clearInterval(interval);
    }
  }, [show]);

  if (!show) {
    return (
      <button
        onClick={() => setShow(true)}
        style={{ position: "fixed", top: 8, left: 8, opacity: 0.3, fontSize: 10, padding: "2px 4px", zIndex: 1000 }}
      >
        Logs
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", padding: 20, overflow: "auto", zIndex: 9999, color: "#0f0", fontSize: 11 }}>
      <button onClick={() => setShow(false)} style={{ marginBottom: 10 }}>Close</button>
      <button onClick={() => localStorage.setItem("raphael_logs", "[]")} style={{ marginLeft: 10 }}>Clear</button>
      <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {logs.map((l, i) => (
          <div key={i} style={{ color: l.includes("error") || l.includes("Error") ? "#f55" : l.includes("warn") ? "#ff5" : "#0f0" }}>
            {l}
          </div>
        ))}
      </pre>
    </div>
  );
}

// Inject console.log into localStorage for DebugPanel
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => {
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  originalLog(...args);
  const logs = JSON.parse(localStorage.getItem("raphael_logs") || "[]");
  logs.push(`[LOG] ${msg}`);
  if (logs.length > 100) logs.shift();
  localStorage.setItem("raphael_logs", JSON.stringify(logs));
};
console.error = (...args) => {
  const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  originalError(...args);
  const logs = JSON.parse(localStorage.getItem("raphael_logs") || "[]");
  logs.push(`[ERROR] ${msg}`);
  if (logs.length > 100) logs.shift();
  localStorage.setItem("raphael_logs", JSON.stringify(logs));
};

// Slash command fast-path — bypass orchestrator for known intents
function parseSlashCommand(text: string): { tool: string; params: Record<string, unknown> } | null {
  const t = text.trim();
  if (/^\/(?:email|mail)\b/i.test(t)) return { tool: "gmail.listEmails", params: {} };
  if (/^\/(?:calendar|cal)\b/i.test(t)) return { tool: "calendar.listEvents", params: {} };
  const memMatch = t.match(/^\/memory\s+(.+)/i);
  if (memMatch) return { tool: "memory.query", params: { query: memMatch[1] } };
  const searchMatch = t.match(/^\/search\s+(.+)/i);
  if (searchMatch) return { tool: "search.query", params: { query: searchMatch[1] } };
  const runMatch = t.match(/^\/run\s+(.+)/i);
  if (runMatch) return { tool: "shell.run", params: { command: runMatch[1] } };
  if (/^\/resources\s+list\b/i.test(t)) return { tool: "resources.listManifests", params: {} };
  const resourcesFindMatch = t.match(/^\/resources\s+find\s+(.+)/i);
  if (resourcesFindMatch) return { tool: "resources.find", params: { query: resourcesFindMatch[1] } };
  return null;
}

export default function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [config, setConfig] = useState<RaphaelConfig>(DEFAULT_CONFIG);
  const [thinking, setThinking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [profileContent, setProfileContent] = useState<string>("");
  const [startupMemory, setStartupMemory] = useState<string>("");
  const [pendingApproval, setPendingApproval] = useState<{ cardId: string; tool: string; params: Record<string, unknown> } | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState(0);
  const approvalResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const submittingRef = useRef(false);
  const hasDocumentsRef = useRef(false);
  const { state, dispatch: chatDispatch } = useChatStore();
  const loadFromGist = useCalendarStore((s) => s.loadFromGist);
  const registryRef = useRef<ToolRegistry | null>(null);

  useEffect(() => {
    // Ready if either Gemini key (preferred) or Groq key (legacy) is set
    Promise.all([
      invoke<string | null>("get_secret", { key: "gemini_api_key" }),
      invoke<string | null>("get_secret", { key: "groq_api_key" }),
    ])
      .then(([gemini, groq]) => {
        console.log("Gemini key:", !!gemini, "Groq key:", !!groq);
        setReady(!!(gemini || groq));
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
      .then(async (services) => {
        const registry = initRegistry(services);

        // shell.run — agent-invocable tool that runs a shell command and streams output to the UI
        registry.register(
          {
            name: "shell.run",
            description: "Run a shell command on the user's machine and stream its output. Use for file operations, running scripts, checking system state, or any terminal task.",
            parameters: {
              command: { type: "string", description: "The shell command to run, e.g. 'ls -la' or 'git status'" },
              cwd: { type: "string", description: "Working directory for the command. Defaults to user home dir if omitted." },
            },
            type: "builtin",
          },
          async (params) => {
            const command = String(params.command ?? "").trim();
            if (!command) return { success: false, error: "command is required" };
            const cwd = params.cwd ? String(params.cwd) : undefined;

            const cardId = crypto.randomUUID();
            chatDispatch({ type: ADD_SHELL, card: { id: cardId, command, status: "running", lines: [] } });

            try {
              const procId = await invoke<string>("spawn_process", { program: "sh", args: ["-c", command], cwd: cwd ?? null });
              const collectedLines: string[] = [];

              return await new Promise<{ success: boolean; data?: unknown; error?: string }>((resolve) => {
                const unlistenOutput = listen<{ id: string; line: string; is_stderr: boolean }>(
                  "process-output",
                  (event) => {
                    if (event.payload.id !== procId) return;
                    collectedLines.push(event.payload.line);
                    chatDispatch({
                      type: APPEND_SHELL_LINE,
                      id: cardId,
                      line: event.payload.line,
                      isStderr: event.payload.is_stderr,
                    });
                  },
                );

                const unlistenExit = listen<{ id: string; code: number | null }>(
                  "process-exit",
                  (event) => {
                    if (event.payload.id !== procId) return;
                    chatDispatch({ type: FINISH_SHELL, id: cardId, exitCode: event.payload.code });
                    Promise.all([unlistenOutput, unlistenExit]).then((fns) => fns.forEach((f) => f()));
                    const output = collectedLines.join("\n").slice(0, 4000);
                    if (event.payload.code === 0 || event.payload.code === null) {
                      resolve({ success: true, data: { exitCode: event.payload.code, output } });
                    } else {
                      resolve({ success: false, error: `Exit ${event.payload.code}\n${output}` });
                    }
                  },
                );
              });
            } catch (e) {
              chatDispatch({ type: FINISH_SHELL, id: cardId, exitCode: -1 });
              return { success: false, error: String(e) };
            }
          },
        );

        registryRef.current = registry;

        // Restore dynamically defined resource tools from previous sessions
        await bootstrapResourceTools(registry, services);

        console.log("[App] ToolRegistry initialized with", registryRef.current.list().length, "tools");

        // Load recent memory context for session continuity
        try {
          const memResult = await registry.execute("memory.query", { query: "recent context" });
          if (memResult.success && memResult.data) {
            const memStr = typeof memResult.data === "string"
              ? memResult.data
              : JSON.stringify(memResult.data);
            setStartupMemory(memStr.slice(0, 2000));
          }
        } catch {
          // memory unavailable — not fatal
        }
      })
      .catch((e) => console.error("Failed to init registry:", e));
  }, []);

  useEffect(() => {
    loadFromGist().catch((e) => console.error("Calendar load error:", e));
  }, [loadFromGist]);

  const history = state.items
    .filter((i) => i.type === "message" && !((i.data as { content: string }).content.startsWith("Error:")))
    .map((i) => ({ role: (i.data as { role: string }).role as "user" | "assistant", content: (i.data as { content: string }).content }));

  const handleSubmit = useCallback(async (text: string, attachments?: FileAttachment[]) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    console.log("[App] handleSubmit called, attachments:", attachments?.length);
    const userMsgId = crypto.randomUUID();
    chatDispatch({ type: "ADD_MESSAGE", msg: { id: userMsgId, role: "user", content: text } });
    setThinking(true);

    try {
      if (!registryRef.current) {
        const errId = crypto.randomUUID();
        chatDispatch({ type: "ADD_MESSAGE", msg: { id: errId, role: "assistant", content: "Still initializing — please try again in a moment." } });
        setThinking(false);
        return;
      }

      const MAX_TOOL_ITERS = 3;
      let toolContext = "";
      const combinedProfile = [profileContent, startupMemory].filter(Boolean).join("\n\n---\n\n");

      // Handle file attachments - analyze them first
      let fileAnalysisContext = "";
      console.log("[App] Processing attachments:", attachments?.length, attachments?.map(a => ({ id: a.id, name: a.file.name })));
      setPendingAttachments(attachments?.length || 0);
      
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          console.log("[App] Analyzing file:", attachment.file.name, "id:", attachment.id);
          chatDispatch({ type: "ADD_TOOL", card: { id: attachment.id, tool: "files.analyzeDocument", status: "running" } });
          
          try {
            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve) => {
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.split(",")[1]);
              };
              reader.readAsDataURL(attachment.file);
            });
            
            const base64 = await base64Promise;
            const mimeType = attachment.file.type;
            const fileName = attachment.file.name;
            
            const result = await registryRef.current.execute("files.analyzeDocument", {
              fileData: base64,
              fileName,
              mimeType,
            });

            setPendingAttachments(prev => prev - 1);
            console.log("[App] analyzeDocument result:", result);
            if (result.success) {
              const fileData = result.data as { chunksStored?: number; error?: string } | undefined;
              if (fileData && !fileData.error && fileData.chunksStored && fileData.chunksStored > 0) {
                hasDocumentsRef.current = true;
                fileAnalysisContext += `\n\n[File "${fileName}" has been processed and stored. ${fileData.chunksStored} chunks are searchable. Use files.queryDocument to answer questions about it.]`;
                chatDispatch({ type: "UPDATE_TOOL", id: attachment.id, status: "done", result: "Analysis complete" });
              } else if (fileData?.error) {
                fileAnalysisContext += `\n\n[File "${fileName}" processing failed: ${fileData.error}]`;
                chatDispatch({ type: "UPDATE_TOOL", id: attachment.id, status: "error", result: fileData.error });
              } else {
                chatDispatch({ type: "UPDATE_TOOL", id: attachment.id, status: "done", result: "Analysis complete" });
              }
            } else {
              chatDispatch({ type: "UPDATE_TOOL", id: attachment.id, status: "error", result: result.error });
            }
          } catch (e) {
            setPendingAttachments(prev => prev - 1);
            chatDispatch({ type: "UPDATE_TOOL", id: attachment.id, status: "error", result: String(e) });
          }
        }
      } else {
        setPendingAttachments(0);
      }

      // Slash command fast-path
      const slashCmd = parseSlashCommand(text);
      const justUploadedFiles = fileAnalysisContext.includes("chunks are searchable");
      const hasStoredDocs = hasDocumentsRef.current;
      let lastPlan = slashCmd
        ? { model: "fast" as const, tool: slashCmd.tool, params: slashCmd.params, intent: `slash: ${slashCmd.tool}` }
        : justUploadedFiles
        ? { model: "powerful" as const, tool: "files.queryDocument", params: { question: text }, intent: "query uploaded document" }
        : await orchestrate(
            text,
            history,
            config.persona,
            combinedProfile,
            registryRef.current,
            hasStoredDocs
              ? `Previously uploaded documents are searchable via files.queryDocument. Use it only if the user is asking about a document.`
              : (fileAnalysisContext || undefined),
            config.providerPriority,
            config.rateLimitConfig,
            config.modelSelection,
          ).catch((e) => {
            console.error("Orchestrator failed, falling back to fast model:", e);
            return { model: "fast" as const, tool: null, params: null, intent: "direct response" };
          });

      for (let iter = 0; iter < MAX_TOOL_ITERS && lastPlan.tool; iter++) {
        const plan = lastPlan;
        const planTool = plan.tool!;
        const cardId = crypto.randomUUID();
        chatDispatch({ type: "ADD_TOOL", card: { id: cardId, tool: planTool, status: "running" } });

        let iterContext = "";

        if (planTool === "gmail.draftEmail") {
          const draft = plan.params as unknown as { to?: string; subject?: string; body?: string };
          chatDispatch({ type: "ADD_EMAIL", draft: { id: crypto.randomUUID(), to: draft.to ?? "", subject: draft.subject ?? "", body: draft.body ?? "" } });
          chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "done", result: "Draft ready for review" });
          iterContext = `Email composer opened. To: "${draft.to ?? ""}", Subject: "${draft.subject ?? ""}", Body: "${draft.body ?? ""}". The compose window is visible — tell the user to review and hit Send.`;
          toolContext = toolContext ? toolContext + "\n\n" + iterContext : iterContext;
          break;
        } else {
          const needsApproval = requiresApprovalCheck(planTool, config);
          if (needsApproval) {
            const toolName = planTool;
            const ok = await new Promise<boolean>((resolve) => {
              approvalResolveRef.current = resolve;
              setPendingApproval({ cardId, tool: toolName, params: (plan.params ?? {}) as Record<string, unknown> });
            });
            if (!ok) {
              chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "error", result: "Cancelled by user" });
              setThinking(false);
              return;
            }
          }
          const registry = registryRef.current;
          console.log("[App] Dispatching tool:", planTool, "params:", JSON.stringify(plan.params));
          const result = await dispatch(planTool, plan.params ?? {}, registry);
          console.log("[App] Tool result:", JSON.stringify(result));
          if (result.success) {
            // For shell.run with empty output, give the model an explicit signal
            // instead of an empty string that causes hallucination from history.
            if (planTool === "shell.run") {
              const d = result.data as { exitCode?: number; output?: string };
              const out = d.output?.trim() ?? "";
              iterContext = out.length > 0
                ? `Command ran successfully (exit 0).\n\nOutput:\n${out}`
                : `Command ran successfully (exit 0). No output was produced — this is normal for commands like venv creation, mv, mkdir, etc.`;
            } else {
              iterContext = JSON.stringify(result.data, null, 2);
              // Normalize empty list results to a human-readable signal
              if (iterContext === "[]" || iterContext === "null") {
                iterContext = `${planTool} returned no results.`;
              }
            }
            chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "done", result: iterContext.slice(0, 120) });
            if (planTool === "memory.saveProfile") {
              invoke<string>("load_profile").then(setProfileContent).catch(console.error);
            }
          } else {
            chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "error", result: result.error });
            iterContext = `TOOL_FAILED: ${planTool}\nError: ${result.error}\nDo not retry the same tool with the same params. Either try a different approach or set tool: null and explain the error to the user.`;
          }
        }

        toolContext = toolContext ? toolContext + "\n\n" + iterContext : iterContext;

        // Re-orchestrate for potential chaining (unless we've hit the last iteration)
        if (iter < MAX_TOOL_ITERS - 1) {
          lastPlan = await orchestrate(text, history, config.persona, combinedProfile, registryRef.current, iterContext, config.providerPriority, config.rateLimitConfig, config.modelSelection).catch((e) => {
            console.error("Re-orchestration failed, stopping chain:", e);
            return { model: "fast" as const, tool: null, params: null, intent: "direct response" };
          });
        }
      }

      const model = pickModel(lastPlan.model);
      const systemPrompt = buildSystemPrompt(lastPlan.model === "fast" ? "fast" : "powerful", config.persona, combinedProfile);

      const isDocQuery = justUploadedFiles || lastPlan.tool === "files.queryDocument";
      const contextMsg = toolContext
        ? `Tool result:\n${toolContext.slice(0, 8000)}\n\nUser's request: "${text}"\n\nAnswer the user's request precisely using only the information above. Follow their exact instructions — if they ask for 3 questions give exactly 3, if they ask for the first question give only the first, do not add extras.`
        : text;

      // Doc queries: drop history — chunks are self-contained context
      // Everything else: keep last 4 messages to save tokens
      const historySlice = isDocQuery ? [] : history.slice(-4);

      const replyId = crypto.randomUUID();
      chatDispatch({ type: "ADD_MESSAGE", msg: { id: replyId, role: "assistant", content: "", streaming: true } });

      try {
        await streamChat(
          model,
          [
            { role: "system", content: systemPrompt },
            ...historySlice,
            { role: "user", content: contextMsg },
          ],
          (chunk) => chatDispatch({ type: "APPEND_STREAM", id: replyId, chunk }),
          () => chatDispatch({ type: "FINISH_STREAM", id: replyId }),
          config.providerPriority,
          config.rateLimitConfig,
          config.modelSelection,
          lastPlan.model,
        );
      } catch (streamErr) {
        // Remove the empty streaming bubble and show a real error message
        chatDispatch({ type: "REMOVE", id: replyId });
        throw streamErr;
      }
    } catch (e) {
      console.error("Chat error:", e);
      const errId = crypto.randomUUID();
      chatDispatch({ type: "ADD_MESSAGE", msg: { id: errId, role: "assistant", content: `Error: ${String(e)}` } });
    } finally {
      setThinking(false);
      submittingRef.current = false;
    }
  }, [config, history, chatDispatch, profileContent, startupMemory]);

if (ready === null) return null;
  if (!ready) return <Onboarding onComplete={() => setReady(true)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <DebugPanel />
      <div style={{ height: 2, background: thinking ? "#f59e0b" : "var(--accent)", flexShrink: 0, transition: "background 0.3s" }} />
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e1e2e" }}>
        <img src="/raphael_logo.png" alt="Raphael" style={{ height: 28, objectFit: "contain" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setShowSettings(true)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            title="Settings"
          >
            ⚙️
          </button>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: thinking ? "#f59e0b" : "var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
        </div>
      </div>
      <div style={{ borderBottom: "1px solid #1e1e2e", flexShrink: 0, maxHeight: 300, overflowY: "auto" }}>
        <CalendarView />
      </div>
      <ChatArea
        items={state.items}
        onEmailChange={(id, patch) => chatDispatch({ type: "UPDATE_EMAIL", id, patch })}
        onEmailSend={async (id) => {
          const emailItem = state.items.find((i) => i.type === "email" && (i.data as { id: string }).id === id);
          if (!emailItem || emailItem.type !== "email") return;
          if (registryRef.current) {
            await registryRef.current.execute("gmail.sendEmail", emailItem.data as unknown as Record<string, unknown>);
          }
          chatDispatch({ type: "REMOVE", id });
        }}
        onEmailDiscard={(id) => chatDispatch({ type: "REMOVE", id })}
      />
      <InputBar 
        onSubmit={handleSubmit} 
        disabled={thinking}
        pendingAttachments={pendingAttachments}
      />
      {showSettings && (
        <SettingsPanel
          config={config}
          onClose={() => setShowSettings(false)}
          onSave={(updatedConfig) => {
            setConfig(updatedConfig);
            setShowSettings(false);
          }}
        />
      )}
      {pendingApproval && (
        <ApprovalDialog
          tool={pendingApproval.tool}
          params={pendingApproval.params}
          onApprove={() => {
            setPendingApproval(null);
            approvalResolveRef.current?.(true);
            approvalResolveRef.current = null;
          }}
          onDeny={() => {
            setPendingApproval(null);
            approvalResolveRef.current?.(false);
            approvalResolveRef.current = null;
          }}
        />
      )}
    </div>
  );
}