import { useEffect, useRef } from "react";
import { ShellCardState } from "../store/chat";

interface Props {
  card: ShellCardState;
}

export default function ShellCard({ card }: Props) {
  const logsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsRef.current) {
      logsRef.current.scrollTop = logsRef.current.scrollHeight;
    }
  }, [card.lines]);

  const borderColor =
    card.status === "error"
      ? "var(--danger)"
      : card.status === "done"
        ? "var(--text-muted)"
        : "var(--accent)";

  const statusIcon =
    card.status === "running" ? "⟳" : card.status === "done" ? "✓" : "✗";

  return (
    <div
      style={{
        margin: "6px 0",
        padding: "8px 12px",
        background: "var(--bg-surface)",
        borderLeft: `2px solid ${borderColor}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        fontSize: 12,
      }}
    >
      <div style={{ color: borderColor, marginBottom: card.lines.length > 0 ? 6 : 0, display: "flex", gap: 6 }}>
        <span style={{ animation: card.status === "running" ? "spin 1s linear infinite" : undefined }}>
          {statusIcon}
        </span>
        <span style={{ fontFamily: "monospace" }}>$ {card.command}</span>
        {card.exitCode !== undefined && card.status !== "running" && (
          <span style={{ marginLeft: "auto", opacity: 0.5 }}>exit {card.exitCode}</span>
        )}
      </div>
      {card.lines.length > 0 && (
        <div
          ref={logsRef}
          style={{
            fontFamily: "monospace",
            fontSize: 11,
            maxHeight: 200,
            overflowY: "auto",
            color: "var(--text-muted)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            paddingTop: 2,
          }}
        >
          {card.lines.map((line, i) => (
            <div
              key={i}
              style={{ color: line.startsWith("[stderr]") ? "#f87171" : undefined }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
