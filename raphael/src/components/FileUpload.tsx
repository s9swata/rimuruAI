import { useState, useRef } from "react";

export interface FileUploadProps {
  onFilesSelected: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}

export default function FileUpload({
  onFilesSelected,
  accept = ".pdf,.png,.jpg,.jpeg,.txt",
  multiple = true,
  disabled = false,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesSelected(files);
    }
  };

  const handleClick = () => {
    if (!disabled) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${isDragging ? "var(--accent)" : "var(--accent-dim)"}`,
        borderRadius: "var(--radius)",
        padding: "16px",
        textAlign: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.2s ease",
        background: isDragging ? "var(--bg-surface)" : "transparent",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleFileChange}
        style={{ display: "none" }}
        disabled={disabled}
      />
      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
        Drop files here or click to upload
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 4 }}>
        PDF, Images, Text
      </div>
    </div>
  );
}
