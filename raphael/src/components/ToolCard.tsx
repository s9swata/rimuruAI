import { ToolCardState } from "../store/chat";

interface Props {
  card: ToolCardState;
}

export default function ToolCard({ card }: Props) {
  const color =
    card.status === "error"
      ? "var(--danger)"
      : card.status === "done"
        ? "var(--text-muted)"
        : "var(--accent)";

  return (
    <div
      style={{
        margin: "6px 0",
        padding: "8px 12px",
        background: "var(--bg-surface)",
        borderLeft: `2px solid ${color}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        fontSize: 12,
      }}
    >
      <div style={{ color, marginBottom: card.result ? 4 : 0 }}>
        {card.status === "running" ? "⟳ " : card.status === "done" ? "✓ " : "✗ "}
        {card.tool}
      </div>
      {card.result && (
        <div
          style={{
            borderTop: card.status === "error" ? "1px solid rgba(var(--danger-rgb, 220,50,50), 0.25)" : undefined,
            paddingTop: card.status === "error" ? 6 : 0,
            marginTop: card.status === "error" ? 4 : 0,
            color: card.status === "error" ? "rgba(var(--danger-rgb, 220,50,50), 0.85)" : "var(--text-muted)",
            fontSize: 11,
            maxHeight: card.status === "error" ? undefined : 120,
            overflow: card.status === "error" ? "visible" : "auto",
            fontFamily: card.status === "error" ? "monospace" : undefined,
            whiteSpace: card.status === "error" ? "pre-wrap" : undefined,
            wordBreak: card.status === "error" ? "break-word" : undefined,
          }}
        >
          {card.result}
        </div>
      )}
    </div>
  );
}