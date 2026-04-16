export interface FileAttachment {
  id: string;
  file: File;
  status: "pending" | "uploading" | "ready" | "error";
  progress?: number;
  error?: string;
}

interface FileAttachmentListProps {
  files: FileAttachment[];
  onRemove: (id: string) => void;
}

export function FileAttachmentList({ files, onRemove }: FileAttachmentListProps) {
  if (files.length === 0) return null;

  const getStatusColor = (status: FileAttachment["status"]) => {
    switch (status) {
      case "pending": return "var(--text-muted)";
      case "uploading": return "var(--accent)";
      case "ready": return "var(--success)";
      case "error": return "var(--error)";
      default: return "var(--text-muted)";
    }
  };

  const getStatusIcon = (status: FileAttachment["status"]) => {
    switch (status) {
      case "pending": return "⏳";
      case "uploading": return "⬆️";
      case "ready": return "✓";
      case "error": return "✗";
      default: return "📄";
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      padding: "8px 12px",
      borderTop: "1px solid var(--accent-dim)",
    }}>
      {files.map((file) => (
        <div
          key={file.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            background: "var(--bg-surface)",
            border: "1px solid var(--accent-dim)",
            borderRadius: "var(--radius)",
            fontSize: 12,
          }}
        >
          <span style={{ color: getStatusColor(file.status) }}>
            {getStatusIcon(file.status)}
          </span>
          <span style={{ maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.file.name}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>
            {formatFileSize(file.file.size)}
          </span>
          <button
            onClick={() => onRemove(file.id)}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 2,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
