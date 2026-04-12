import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import Onboarding from "./components/Onboarding";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";
import { useChatStore } from "./store/chat";
import { loadConfig } from "./config/loader";
import { RaphaelConfig, DEFAULT_CONFIG } from "./config/types";
import { orchestrate } from "./agent/orchestrator";
import { pickModel } from "./agent/router";
import { dispatch, requiresApprovalCheck } from "./agent/dispatcher";
import { streamChat } from "./agent/groq";
import { buildSystemPrompt } from "./agent/prompts";
import { createServices } from "./services";

export default function App() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [config, setConfig] = useState<RaphaelConfig>(DEFAULT_CONFIG);
  const [thinking, setThinking] = useState(false);
  const { state, dispatch: chatDispatch } = useChatStore();

  useEffect(() => {
    invoke<string | null>("get_secret", { key: "groq_api_key" }).then((key) => {
      setReady(!!key);
    });
    loadConfig().then(setConfig);
  }, []);

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

        if (plan.tool === "gmail.draftEmail") {
          const draft = plan.params as unknown as { to?: string; subject?: string; body?: string };
          chatDispatch({ type: "ADD_EMAIL", draft: { id: crypto.randomUUID(), to: draft.to ?? "", subject: draft.subject ?? "", body: draft.body ?? "" } });
          chatDispatch({ type: "UPDATE_TOOL", id: cardId, status: "done", result: "Draft ready for review" });
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
      <div style={{ height: 2, background: thinking ? "#f59e0b" : "var(--accent)", flexShrink: 0, transition: "background 0.3s" }} />
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #1e1e2e" }}>
        <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>RAPHAEL</span>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: thinking ? "#f59e0b" : "var(--accent)", animation: "pulse 2s ease-in-out infinite" }} />
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
    </div>
  );
}