import { useState } from "react";
import { RaphaelConfig, BuiltInProvider, ModelSelection } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { PROVIDER_MODEL_OPTIONS, PROVIDER_LABELS } from "../../agent/prompts";
import { SectionTitle, FieldLabel, SaveButton } from "./settingsShared";

function ModelSelectionRow({ 
  label, 
  selection, 
  onChange,
  availableProviders,
}: { 
  label: string; 
  selection: ModelSelection; 
  onChange: (s: ModelSelection) => void;
  availableProviders: BuiltInProvider[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={selection.provider}
          onChange={(e) => {
            const newProvider = e.target.value as BuiltInProvider;
            const newModels = PROVIDER_MODEL_OPTIONS[newProvider] || [];
            onChange({ 
              provider: newProvider, 
              model: newModels[0] || "" 
            });
          }}
          style={{
            flex: 1,
            background: "var(--bg-surface)",
            color: "var(--text)",
            border: "1px solid var(--accent-dim)",
            borderRadius: "var(--radius)",
            padding: "6px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            outline: "none",
          }}
        >
          {availableProviders.map((p) => (
            <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
          ))}
        </select>
        <select
          value={selection.model}
          onChange={(e) => onChange({ ...selection, model: e.target.value })}
          style={{
            flex: 2,
            background: "var(--bg-surface)",
            color: "var(--text)",
            border: "1px solid var(--accent-dim)",
            borderRadius: "var(--radius)",
            padding: "6px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            outline: "none",
          }}
        >
          {(PROVIDER_MODEL_OPTIONS[selection.provider] || []).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function ModelsSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [selection, setSelection] = useState(config.modelSelection);

  async function handleSave() {
    const updated: RaphaelConfig = { ...config, modelSelection: selection };
    await saveConfig(updated);
    onSave(updated);
  }

  const enabledProviders = config.providerPriority.filter(p => p.enabled).map(p => p.provider) as BuiltInProvider[];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>MODEL SELECTION</SectionTitle>
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
        Configure which provider/model to use for each tier
      </div>
      <ModelSelectionRow 
        label="Orchestrator (routing decision)" 
        selection={selection.orchestrator}
        onChange={(s) => setSelection({ ...selection, orchestrator: s })}
        availableProviders={enabledProviders}
      />
      <ModelSelectionRow 
        label="Fast (simple tasks)" 
        selection={selection.fast}
        onChange={(s) => setSelection({ ...selection, fast: s })}
        availableProviders={enabledProviders}
      />
      <ModelSelectionRow 
        label="Powerful (complex reasoning)" 
        selection={selection.powerful}
        onChange={(s) => setSelection({ ...selection, powerful: s })}
        availableProviders={enabledProviders}
      />
      <SaveButton onClick={handleSave} />
    </div>
  );
}