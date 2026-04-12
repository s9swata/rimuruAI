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
            color: "var(--text-muted)",
            fontSize: 11,
            maxHeight: 80,
            overflow: "auto",
          }}
        >
          {card.result}
        </div>
      )}
    </div>
  );
}