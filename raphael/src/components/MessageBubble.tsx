import { ChatMessage } from "../store/chat";

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: "85%",
          padding: isUser ? "7px 12px" : "0",
          background: isUser ? "var(--bg-chip)" : "transparent",
          borderRadius: isUser ? "var(--radius)" : 0,
          color: isUser ? "var(--text-muted)" : "var(--text)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message.content}
        {message.streaming && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 13,
              background: "var(--accent)",
              marginLeft: 2,
              animation: "pulse 0.8s infinite",
            }}
          />
        )}
      </div>
    </div>
  );
}