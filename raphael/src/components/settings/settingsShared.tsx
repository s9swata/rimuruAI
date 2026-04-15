import React, { useState } from "react";

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.2em", color: "var(--accent)", marginBottom: 12 }}>
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{children}</div>;
}

export function TextInput({ value, onChange, type = "text", placeholder }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: "var(--bg-surface)", color: "var(--text)",
        border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
        padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none",
      }}
    />
  );
}

export function Segment<T extends string>({ options, value, onChange }: {
  options: readonly T[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 2, background: "var(--bg-chip)", borderRadius: "var(--radius)", padding: 3 }}>
      {options.map((opt) => (
        <button key={opt} onClick={() => onChange(opt)} style={{
          flex: 1, padding: "4px 0", fontSize: 11, border: "none", cursor: "pointer",
          borderRadius: 6, fontFamily: "var(--font-mono)", textTransform: "capitalize",
          background: value === opt ? "var(--accent)" : "transparent",
          color: value === opt ? "white" : "var(--text-muted)",
          transition: "background 0.15s",
        }}>
          {opt}
        </button>
      ))}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%", background: "var(--bg-surface)", color: "var(--text)",
        border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
        padding: "7px 10px", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none",
        resize: "vertical", boxSizing: "border-box",
      }}
    />
  );
}

export function keyCount(text: string) {
  const n = text.split("\n").map(k => k.trim()).filter(Boolean).length;
  return n > 1 ? <span style={{ fontSize: 10, color: "var(--accent)", marginLeft: 6 }}>{n} keys</span> : null;
}

export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{
      width: 32, height: 18, borderRadius: 9, border: "none", cursor: "pointer",
      background: value ? "var(--accent)" : "var(--accent-dim)",
      position: "relative", transition: "background 0.2s", flexShrink: 0,
    }}>
      <span style={{
        position: "absolute", top: 3, left: value ? 17 : 3,
        width: 12, height: 12, borderRadius: "50%", background: "white",
        transition: "left 0.2s",
      }} />
    </button>
  );
}

export function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      alignSelf: "flex-start", background: "var(--accent)", color: "white", border: "none",
      borderRadius: "var(--radius)", padding: "6px 20px",
      fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", marginTop: 4,
    }}>
      Save
    </button>
  );
}

type TabId = string;

interface Tab {
  id: TabId;
  label: string;
  icon?: string;
}

export function Tabs<T extends TabId>({ tabs, activeTab, onChange }: {
  tabs: Tab[]; activeTab: T; onChange: (tab: T) => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 2, background: "var(--bg-chip)", borderRadius: "var(--radius)",
      padding: 4, borderBottom: "1px solid var(--accent-dim)", marginBottom: 16,
    }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id as T)}
          style={{
            flex: 1, padding: "8px 4px", fontSize: 10, border: "none", cursor: "pointer",
            borderRadius: "var(--radius)", fontFamily: "var(--font-mono)", textTransform: "uppercase",
            letterSpacing: "0.05em",
            background: activeTab === tab.id ? "var(--bg-surface)" : "transparent",
            color: activeTab === tab.id ? "var(--text)" : "var(--text-muted)",
            transition: "all 0.15s",
          }}
        >
          {tab.icon && <span style={{ marginRight: 4 }}>{tab.icon}</span>}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Accordion({ title, children, defaultOpen = false }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "transparent", border: "none", cursor: "pointer", padding: "8px 0",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{title}</span>
        <span style={{
          fontSize: 10, color: "var(--text-muted)", transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
        }}>
          ▶
        </span>
      </button>
      {isOpen && (
        <div style={{ padding: "8px 0", animation: "fadeIn 0.15s ease-out" }}>
          {children}
        </div>
      )}
    </div>
  );
}