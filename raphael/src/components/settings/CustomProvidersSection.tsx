import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RaphaelConfig, CustomProviderConfig } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { SectionTitle, FieldLabel, TextInput, Toggle } from "./settingsShared";

const EMPTY_PROVIDER: CustomProviderConfig = { name: "", baseURL: "", apiKey: "", models: [], enabled: true };

export default function CustomProvidersSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [providers, setProviders] = useState<CustomProviderConfig[]>(config.customProviders ?? []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CustomProviderConfig>(EMPTY_PROVIDER);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setProviders(config.customProviders ?? []);
  }, [config.customProviders]);

  function updateProviders(next: CustomProviderConfig[]) {
    setProviders(next);
  }

  async function handleSave(next: CustomProviderConfig[]) {
    const updated: RaphaelConfig = { ...config, customProviders: next };
    await saveConfig(updated);
    await invoke("set_secret", { key: "custom_providers", value: JSON.stringify(next) });
    onSave(updated);
  }

  function handleToggle(idx: number, value: boolean) {
    const next = providers.map((p, i) => i === idx ? { ...p, enabled: value } : p);
    updateProviders(next);
    handleSave(next);
  }

  function handleRemove(idx: number) {
    const next = providers.filter((_, i) => i !== idx);
    updateProviders(next);
    handleSave(next);
  }

  function handleAdd() {
    setFormError("");
    const name = form.name.trim();
    const baseURL = form.baseURL.trim();
    const apiKey = form.apiKey.trim();
    const models = form.models.join(",").split(",").map(m => m.trim()).filter(Boolean);
    if (!name) { setFormError("Name is required."); return; }
    if (!baseURL) { setFormError("Base URL is required."); return; }
    if (!baseURL.startsWith("http")) { setFormError("Base URL must start with http:// or https://"); return; }
    if (!apiKey) { setFormError("API Key is required."); return; }
    const entry: CustomProviderConfig = { name, baseURL, apiKey, models, enabled: true };
    const next = [...providers, entry];
    updateProviders(next);
    handleSave(next);
    setForm(EMPTY_PROVIDER);
    setShowForm(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>CUSTOM PROVIDERS</SectionTitle>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
        Add OpenAI-compatible endpoints (Ollama, LM Studio, custom APIs, etc.)
      </div>

      {providers.length === 0 && !showForm && (
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No custom providers configured.</div>
      )}

      {providers.map((prov, idx) => (
        <div key={idx} style={{
          display: "flex", flexDirection: "column", alignItems: "flex-start",
          background: "var(--bg-surface)", borderRadius: "var(--radius)",
          padding: "10px 12px", gap: 8,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text)", fontFamily: "var(--font-mono)" }}>{prov.name}</span>
              <span style={{ fontSize: 10, color: prov.enabled ? "var(--accent)" : "var(--text-muted)" }}>
                {prov.enabled ? "enabled" : "disabled"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Toggle value={prov.enabled} onChange={(v) => handleToggle(idx, v)} />
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
          <div style={{ fontSize: 10, color: "var(--text-muted)", width: "100%" }}>
            <div style={{ wordBreak: "break-all" }}>{prov.baseURL}</div>
            {prov.models.length > 0 && (
              <div style={{ marginTop: 4 }}>Models: {prov.models.join(", ")}</div>
            )}
          </div>
        </div>
      ))}

      {showForm ? (
        <div style={{
          display: "flex", flexDirection: "column", gap: 10,
          background: "var(--bg-surface)", borderRadius: "var(--radius)", padding: 14,
          border: "1px solid var(--accent-dim)",
        }}>
          <div>
            <FieldLabel>Provider Name</FieldLabel>
            <TextInput value={form.name} onChange={(v) => setForm(f => ({ ...f, name: v }))} placeholder="ollama-local" />
          </div>
          <div>
            <FieldLabel>Base URL</FieldLabel>
            <TextInput value={form.baseURL} onChange={(v) => setForm(f => ({ ...f, baseURL: v }))} placeholder="http://localhost:11434/v1" />
          </div>
          <div>
            <FieldLabel>API Key</FieldLabel>
            <TextInput type="password" value={form.apiKey} onChange={(v) => setForm(f => ({ ...f, apiKey: v }))} placeholder="ollama, sk-..., or leave empty for local" />
          </div>
          <div>
            <FieldLabel>Models (comma-separated, optional)</FieldLabel>
            <TextInput value={form.models.join(", ")} onChange={(v) => setForm(f => ({ ...f, models: v.split(",").map(m => m.trim()).filter(Boolean) }))} placeholder="llama3, mistral, codellama" />
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
              onClick={() => { setShowForm(false); setForm(EMPTY_PROVIDER); setFormError(""); }}
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
          + Add provider
        </button>
      )}
    </div>
  );
}