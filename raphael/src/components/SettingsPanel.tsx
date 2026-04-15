import { useState } from "react";
import { RaphaelConfig } from "../config/types";
import { Tabs } from "./settings/settingsShared";
import ApiKeysSection from "./settings/ApiKeysSection";
import PersonaSection from "./settings/PersonaSection";
import ModelsSection from "./settings/ModelsSection";
import PermissionsSection from "./settings/PermissionsSection";
import HotkeySection from "./settings/HotkeySection";
import McpServersSection from "./settings/McpServersSection";
import CustomProvidersSection from "./settings/CustomProvidersSection";

type TabId = "api" | "persona" | "permissions" | "integrations" | "system";

const TABS: { id: string; label: string; icon?: string }[] = [
  { id: "api", label: "API", icon: "🔑" },
  { id: "persona", label: "Persona", icon: "🎭" },
  { id: "permissions", label: "Access", icon: "🔐" },
  { id: "integrations", label: "Connect", icon: "🔌" },
  { id: "system", label: "System", icon: "⚙️" },
];

interface Props {
  config: RaphaelConfig;
  onClose: () => void;
  onSave: (config: RaphaelConfig) => void;
}

export default function SettingsPanel({ config, onClose, onSave }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("api");

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "var(--bg)", display: "flex", flexDirection: "column",
      animation: "slideIn 0.18s ease-out",
    }}>
      {/* Header */}
      <div style={{
        padding: "12px 16px", display: "flex", alignItems: "center",
        justifyContent: "space-between", borderBottom: "1px solid #1e1e2e", flexShrink: 0,
      }}>
        <span style={{ letterSpacing: "0.2em", fontSize: 11, fontWeight: 700 }}>SETTINGS</span>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "var(--text-muted)",
          cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "0 4px",
        }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{ padding: "0 16px", paddingTop: 16 }}>
        <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
        {activeTab === "api" && <ApiKeysSection />}
        {activeTab === "persona" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <PersonaSection config={config} onSave={onSave} />
            <ModelsSection config={config} onSave={onSave} />
          </div>
        )}
        {activeTab === "permissions" && <PermissionsSection config={config} onSave={onSave} />}
        {activeTab === "integrations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <McpServersSection config={config} onSave={onSave} />
            <CustomProvidersSection config={config} onSave={onSave} />
          </div>
        )}
        {activeTab === "system" && <HotkeySection config={config} onSave={onSave} />}
      </div>
    </div>
  );
}