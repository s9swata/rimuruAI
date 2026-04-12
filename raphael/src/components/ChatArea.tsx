import { useEffect, useRef } from "react";
import { ChatItem } from "../store/chat";
import MessageBubble from "./MessageBubble";
import ToolCard from "./ToolCard";
import EmailComposer from "./EmailComposer";

interface Props {
  items: ChatItem[];
  onEmailChange: (id: string, patch: any) => void;
  onEmailSend: (id: string) => void;
  onEmailDiscard: (id: string) => void;
}

export default function ChatArea({
  items,
  onEmailChange,
  onEmailSend,
  onEmailDiscard,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
      {items.map((item) => {
        if (item.type === "message")
          return <MessageBubble key={item.data.id} message={item.data} />;
        if (item.type === "tool") return <ToolCard key={item.data.id} card={item.data} />;
        if (item.type === "email")
          return (
            <EmailComposer
              key={item.data.id}
              draft={item.data}
              onChange={(patch) => onEmailChange(item.data.id, patch)}
              onSend={() => onEmailSend(item.data.id)}
              onDiscard={() => onEmailDiscard(item.data.id)}
            />
          );
        return null;
      })}
      <div ref={bottomRef} />
    </div>
  );
}