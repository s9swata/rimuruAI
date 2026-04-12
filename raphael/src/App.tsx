import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import Onboarding from "./components/Onboarding";
import ChatArea from "./components/ChatArea";
import InputBar from "./components/InputBar";

export default function App() {
  const [ready, setReady] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<string | null>("get_secret", { key: "groq_api_key" }).then((key) => {
      setReady(!!key);
    });
  }, []);

  if (ready === null) return null;

  if (!ready) return <Onboarding onComplete={() => setReady(true)} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <div style={{ height: 2, background: "var(--accent)", flexShrink: 0 }} />
      <div style={{
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid #1e1e2e",
      }}>
        <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>RAPHAEL</span>
        <StatusDot />
      </div>
      <ChatArea />
      <InputBar />
    </div>
  );
}

function StatusDot() {
  return (
    <div style={{
      width: 8, height: 8, borderRadius: "50%",
      background: "var(--accent)",
      animation: "pulse 2s ease-in-out infinite",
    }} />
  );
}