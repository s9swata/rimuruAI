import { EmailDraftState } from "../store/chat";

interface Props {
  draft: EmailDraftState;
  onChange: (patch: Partial<EmailDraftState>) => void;
  onSend: () => void;
  onDiscard: () => void;
}

export default function EmailComposer({
  draft,
  onChange,
  onSend,
  onDiscard,
}: Props) {
  return (
    <div
      style={{
        margin: "8px 0",
        padding: 12,
        background: "var(--bg-surface)",
        borderRadius: "var(--radius)",
        border: "1px solid var(--accent-dim)",
      }}
    >
      <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 8 }}>
        EMAIL DRAFT
      </div>
      <Field label="To" value={draft.to} onChange={(v) => onChange({ to: v })} />
      <Field
        label="Subject"
        value={draft.subject}
        onChange={(v) => onChange({ subject: v })}
      />
      <textarea
        value={draft.body}
        onChange={(e) => onChange({ body: e.target.value })}
        rows={6}
        style={{
          width: "100%",
          background: "var(--bg)",
          color: "var(--text)",
          border: "1px solid var(--accent-dim)",
          borderRadius: "var(--radius)",
          padding: "6px 8px",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          resize: "vertical",
          outline: "none",
        }}
      />
      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 8,
          justifyContent: "flex-end",
        }}
      >
        <button onClick={onDiscard} style={btnStyle("var(--bg-chip)")}>
          Discard
        </button>
        <button onClick={onSend} style={btnStyle("var(--accent)")}>
          Send
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span
        style={{
          fontSize: 10,
          color: "var(--text-muted)",
          marginRight: 6,
        }}
      >
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--accent-dim)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          width: "calc(100% - 60px)",
          outline: "none",
          padding: "2px 4px",
        }}
      />
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "var(--text)",
    border: "none",
    borderRadius: "var(--radius)",
    padding: "6px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    cursor: "pointer",
  };
}