interface Props {
  tool: string;
  params: Record<string, unknown>;
  onApprove: () => void;
  onDeny: () => void;
}

export default function ApprovalDialog({ tool, params, onApprove, onDeny }: Props) {
  const paramsJson = JSON.stringify(params, null, 2);
  const truncated = paramsJson.length > 400 ? paramsJson.slice(0, 400) + "\n…" : paramsJson;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9000,
      }}
    >
      <div
        style={{
          background: "var(--bg-surface)",
          borderRadius: "var(--radius)",
          padding: "24px 28px",
          width: 420,
          maxWidth: "90vw",
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.2em",
            color: "var(--accent)",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          Tool Approval Required
        </div>

        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--text)",
            marginBottom: 16,
            wordBreak: "break-all",
          }}
        >
          {tool}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>Parameters</div>
          <pre
            style={{
              background: "rgba(0,0,0,0.25)",
              borderRadius: "var(--radius)",
              padding: "10px 12px",
              fontSize: 11,
              color: "var(--text-muted)",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {truncated}
          </pre>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            onClick={onDeny}
            style={{
              padding: "8px 18px",
              borderRadius: "var(--radius)",
              border: "1px solid rgba(255,255,255,0.12)",
              background: "transparent",
              color: "var(--danger, #f55)",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 500,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,80,80,0.1)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            Deny
          </button>
          <button
            onClick={onApprove}
            style={{
              padding: "8px 18px",
              borderRadius: "var(--radius)",
              border: "none",
              background: "var(--accent)",
              color: "#fff",
              fontSize: 13,
              cursor: "pointer",
              fontWeight: 600,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
