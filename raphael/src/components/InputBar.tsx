import { useState, KeyboardEvent, useRef } from "react";
import FileUpload, { type FileUploadProps } from "./FileUpload";
import { FileAttachmentList, type FileAttachment } from "./FileAttachmentList";

const SLASH_COMMANDS = ["/email", "/calendar", "/files", "/memory"];

interface Props {
  onSubmit: (text: string, files?: FileAttachment[]) => void;
  disabled?: boolean;
  onFilesSelected?: (files: File[]) => void;
  pendingAttachments?: number;
}

export default function InputBar({ onSubmit, disabled, onFilesSelected, pendingAttachments = 0 }: Props) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [showFileUpload, setShowFileUpload] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const ref = useRef<HTMLTextAreaElement>(null);

  const isUploading = pendingAttachments > 0 || attachments.some(a => a.status === "uploading" || a.status === "pending");
  const canSubmit = !disabled && value.trim() && !isUploading;

  const handleFilesSelected: FileUploadProps["onFilesSelected"] = (files) => {
    console.log("[InputBar] Files selected:", files.map(f => f.name));
    const newAttachments: FileAttachment[] = files.map((file) => ({
      id: `${Date.now()}-${file.name}`,
      file,
      status: "ready",
    }));
    setAttachments((prev) => [...prev, ...newAttachments]);
    onFilesSelected?.(files);
    setShowFileUpload(false);
  };

  const handleRemoveFile = (id: string) => {
    setAttachments((prev) => prev.filter((f) => f.id !== id));
  };

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
      if (trimmed && canSubmit) {
        onSubmit(trimmed, attachments.length > 0 ? attachments : undefined);
        setValue("");
        setHint(null);
        setAttachments([]);
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
      {showFileUpload && (
        <div style={{
          position: "absolute", bottom: "100%", left: 16, right: 16,
          background: "var(--bg-surface)", border: "1px solid var(--accent-dim)",
          borderRadius: "var(--radius)", padding: "12px",
          marginBottom: 8,
        }}>
          <FileUpload onFilesSelected={handleFilesSelected} />
        </div>
      )}
      {attachments.length > 0 && (
        <FileAttachmentList files={attachments} onRemove={handleRemoveFile} />
      )}
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
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <button
          onClick={() => setShowFileUpload(!showFileUpload)}
          disabled={disabled}
          title="Attach file"
          style={{
            background: "none", border: "none", color: "var(--text-muted)",
            cursor: disabled ? "not-allowed" : "pointer", fontSize: 18,
            padding: "8px 4px", opacity: disabled ? 0.5 : 1,
          }}
        >
          {isUploading ? (
            <span style={{ 
              display: "inline-block", 
              width: 18, 
              height: 18, 
              border: "2px solid var(--accent)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }} />
          ) : (
            "📎"
          )}
        </button>
        {isUploading && (
          <div style={{
            fontSize: 10,
            color: "var(--accent)",
            padding: "8px 4px",
            animation: "pulse 1.5s ease-in-out infinite",
          }}>
            Analyzing file...
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          disabled={disabled || isUploading}
          placeholder={isUploading ? "Analyzing file..." : "Ask Raphael anything…"}
          rows={1}
          style={{
            flex: 1, background: "var(--bg-surface)", color: "var(--text)",
            border: `1px solid ${isUploading ? "var(--accent)" : "var(--accent-dim)"}`, borderRadius: "var(--radius)",
            padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 13,
            resize: "none", outline: "none", lineHeight: 1.5,
            opacity: disabled || isUploading ? 0.7 : 1,
          }}
        />
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>
    </div>
  );
}
