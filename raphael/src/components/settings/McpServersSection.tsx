import { useState } from "react";
import { RaphaelConfig, McpServerConfig } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { SectionTitle, FieldLabel, TextInput, Toggle, SaveButton } from "./settingsShared";

const EMPTY_FORM: { name: string; command: string; args: string } = { name: "", command: "", args: "" };

export default function McpServersSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [servers, setServers] = useState<McpServerConfig[]>(config.mcpServers ?? []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  function updateServers(next: McpServerConfig[]) {
    setServers(next);
  }

  async function handleSave(next: McpServerConfig[]) {
    const updated: RaphaelConfig = { ...config, mcpServers: next };
    await saveConfig(updated);
    onSave(updated);
  }

  function handleToggle(idx: number, value: boolean) {
    const next = servers.map((s, i) => i === idx ? { ...s, enabled: value } : s);
    updateServers(next);
  }

  function handleRemove(idx: number) {
    const next = servers.filter((_, i) => i !== idx);
    updateServers(next);
    handleSave(next);
  }

  function handleAdd() {
    setFormError("");
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name) { setFormError("Name is required."); return; }
    if (!command) { setFormError("Command is required."); return; }
    const args = form.args.split(",").map(a => a.trim()).filter(Boolean);
    const entry: McpServerConfig = { name, command, args, enabled: true };
    const next = [...servers, entry];
    updateServers(next);
    handleSave(next);
    setForm(EMPTY_FORM);
    setShowForm(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>MCP SERVERS</SectionTitle>

      {servers.length === 0 && !showForm && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No MCP servers configured.</div>
      )}

      {servers.map((srv, idx) => (
        <div key={idx} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "var(--bg-surface)", borderRadius: "var(--radius)",
          padding: "8px 10px", gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{srv.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {srv.command}{srv.args.length > 0 ? " " + srv.args.join(" ") : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{srv.enabled ? "enabled" : "disabled"}</span>
            <Toggle value={srv.enabled} onChange={(v) => handleToggle(idx, v)} />
            <button
              onClick={() => handleRemove(idx)}
              style={{
                background: "none", border: "1px solid var(--accent-dim)", borderRadius: "var(--radius)",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 11,
                fontFamily: "var(--font-mono)", padding: "3px 8px",
              }}
            >
              remove
            </button>
          </div>
        </div>
      ))}

      {servers.length > 0 && !showForm && (
        <SaveButton onClick={() => handleSave(servers)} />
      )}

      {showForm ? (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 12,
          border: "1px solid var(--accent-dim)",
        }}>
          <div>
            <FieldLabel>Name</FieldLabel>
            <TextInput value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} placeholder="filesystem" />
          </div>
          <div>
            <FieldLabel>Command</FieldLabel>
            <TextInput value={form.command} onChange={(v) => setForm(f => ({ ...f, command: v }))} placeholder="npx" />
          </div>
          <div>
            <FieldLabel>Args (comma-separated)</FieldLabel>
            <TextInput
              value={form.args}
              onChange={(v) => setForm(f => ({ ...f, args: v }))}
              placeholder="-y, @modelcontextprotocol/server-filesystem, /tmp"
            />
          </div>
          {formError && <div style={{ fontSize: 11, color: "var(--danger)" }}>{formError}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              style={{
                background: "var(--accent)", color: "white", border: "none",
                borderRadius: "var(--radius)", padding: "6px 16px",
                fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
              }}
            >
              Add
            </button>
            <button
              onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(""); }}
              style={{
                background: "var(--bg-chip)", color: "var(--text-muted)", border: "none",
                borderRadius: "var(--radius)", padding: "6px 16px",
                fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          style={{
            alignSelf: "flex-start", background: "var(--bg-chip)", color: "var(--text-muted)",
            border: "1px dashed var(--accent-dim)", borderRadius: "var(--radius)",
            padding: "5px 14px", fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer",
          }}
        >
          + Add server
        </button>
      )}
    </div>
  );
}