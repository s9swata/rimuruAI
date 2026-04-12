import { useState, KeyboardEvent, useRef } from "react";

const SLASH_COMMANDS = ["/email", "/calendar", "/files", "/memory"];

interface Props { onSubmit: (text: string) => void; disabled?: boolean; }

export default function InputBar({ onSubmit, disabled }: Props) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value;
    setValue(v);
    const word = v.split(/\s/).pop() ?? "";
    if (word.startsWith("/")) {
      const match = SLASH_COMMANDS.find((c) => c.startsWith(word));
      setHint(match ?? null);
    } else {
      setHint(null);
    }
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && !disabled) {
        onSubmit(trimmed);
        setValue("");
        setHint(null);
      }
    }
    if (e.key === "Tab" && hint) {
      e.preventDefault();
      const parts = value.split(/\s/);
      parts[parts.length - 1] = hint;
      setValue(parts.join(" ") + " ");
      setHint(null);
    }
  }

  return (
    <div style={{ padding: "8px 16px 12px", borderTop: "1px solid #1e1e2e", position: "relative" }}>
      {hint && (
        <div style={{
          position: "absolute", bottom: "100%", left: 16,
          background: "var(--bg-surface)", border: "1px solid var(--accent-dim)",
          borderRadius: "var(--radius)", padding: "4px 10px",
          fontSize: 11, color: "var(--accent)",
        }}>
          {hint} <span style={{ color: "var(--text-muted)" }}>↹ to complete</span>
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        disabled={disabled}
        placeholder="Ask Raphael anything…"
        rows={1}
        style={{
          width: "100%", background: "var(--bg-surface)", color: "var(--text)",
          border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
          padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 13,
          resize: "none", outline: "none", lineHeight: 1.5,
          opacity: disabled ? 0.5 : 1,
        }}
      />
    </div>
  );
}