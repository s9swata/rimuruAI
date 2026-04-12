import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Onboarding from "./components/Onboarding";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import CalendarView from "./components/CalendarView";
import SettingsPanel from "./components/SettingsPanel";
import { useChatStore } from "./store/chat";
import { useCalendarStore } from "./calendar/store";
import { loadConfig } from "./config/loader";
import { RaphaelConfig, DEFAULT_CONFIG } from "./config/types";
import { orchestrate } from "./agent/orchestrator";
import { pickModel } from "./agent/router";
import { dispatch, requiresApprovalCheck } from "./agent/dispatcher";
import { streamChat } from "./agent/groq";
import { buildSystemPrompt } from "./agent/prompts";
import { createServices } from "./services";

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
        style={{ position: "fixed", bottom: 4, right: 4, opacity: 0.3, fontSize: 10, padding: "2px 4px" }}
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

export default function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [config, setConfig] = useState<RaphaelConfig>(DEFAULT_CONFIG);
  const [thinking, setThinking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const { state, dispatch: chatDispatch } = useChatStore();
  const loadFromGist = useCalendarStore((s) => s.loadFromGist);

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
  }, []);

  useEffect(() => {
    loadFromGist().catch((e) => console.error("Calendar load error:", e));
  }, [loadFromGist]);

  const history = state.items
    .filter((i) => i.type === "message")
    .map((i) => ({ role: i.data.role as "user" | "assistant", content: i.data.content }));

  const handleSubmit = useCallback(async (text: string) => {
    const userMsgId = crypto.randomUUID();
    chatDispatch({ type: "ADD_MESSAGE", msg: { id: userMsgId, role: "user", content: text } });
    setThinking(true);

    try {
      const plan = await orchestrate(text, history, config.persona);

      let toolContext = "";
      if (plan.tool) {
        const cardId = crypto.randomUUID();
        chatDispatch({ type: "ADD_TOOL", card: { id: cardId, tool: plan.tool, status: "running" } });

        if (plan.tool === "gmail.draftEmail" || plan.tool === "gmail.sendEmail") {
          const draft = plan.params as unknown as { to?: string; subject?: string; body?: string };
          chatDispatch({ type: "ADD_EMAIL", draft: { id: crypto.randomUUID(), to: draft.to ?? "", subject: draft.subject ?? "", body: draft.body ?? "" } });
          chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "done", result: "Draft ready for review" });
          toolContext = `Email composer opened. To: "${draft.to ?? ""}", Subject: "${draft.subject ?? ""}", Body: "${draft.body ?? ""}". The compose window is visible — tell the user to review and hit Send.`;
        } else {
          const needsApproval = requiresApprovalCheck(plan.tool, config);
          if (needsApproval) {
            const ok = window.confirm(`Raphael wants to execute: ${plan.tool}\n\nProceed?`);
            if (!ok) {
              chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "error", result: "Cancelled by user" });
              setThinking(false);
              return;
            }
          }
          const services = await createServices();
          const result = await dispatch(plan.tool, plan.params ?? {}, services);
          if (result.success) {
            toolContext = JSON.stringify(result.data, null, 2).slice(0, 1000);
            chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "done", result: toolContext.slice(0, 120) });
          } else {
            chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "error", result: result.error });
            toolContext = `Tool error: ${result.error}`;
          }
        }
      }

      const replyId = crypto.randomUUID();
      const model = pickModel(plan.model);
      const systemPrompt = buildSystemPrompt(plan.model === "fast" ? "fast" : "powerful", config.persona);
      const contextMsg = toolContext ? `Tool result:\n${toolContext}\n\nNow respond to the user naturally.` : text;

      chatDispatch({ type: "ADD_MESSAGE", msg: { id: replyId, role: "assistant", content: "", streaming: true } });

      await streamChat(
        model,
        [
          { role: "system", content: systemPrompt },
          ...history.slice(-8),
          { role: "user", content: contextMsg },
        ],
        (chunk) => chatDispatch({ type: "APPEND_STREAM", id: replyId, chunk }),
        () => chatDispatch({ type: "FINISH_STREAM", id: replyId }),
      );
    } catch (e) {
      console.error("Chat error:", e);
      const errId = crypto.randomUUID();
      chatDispatch({ type: "ADD_MESSAGE", msg: { id: errId, role: "assistant", content: `Error: ${String(e)}` } });
    } finally {
      setThinking(false);
    }
  }, [config, history, chatDispatch]);

if (ready === null) return null;
  if (!ready) return <Onboarding onComplete={() => setReady(true)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <DebugPanel />
      <div style={{ height: 2, background: thinking ? "#f59e0b" : "var(--accent)", flexShrink: 0, transition: "background 0.3s" }} />
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e1e2e" }}>
        <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>RAPHAEL</span>
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
          const services = await createServices();
          await services.gmail.sendEmail(emailItem.data as unknown as Record<string, unknown>);
          chatDispatch({ type: "REMOVE", id });
        }}
        onEmailDiscard={(id) => chatDispatch({ type: "REMOVE", id })}
      />
      <InputBar onSubmit={handleSubmit} disabled={thinking} />
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
    </div>
  );
}