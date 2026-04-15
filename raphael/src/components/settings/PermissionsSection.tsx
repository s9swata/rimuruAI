import { useState } from "react";
import { RaphaelConfig, TrustLevel, applyTrustLevel } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { SectionTitle, FieldLabel, Segment, Toggle, SaveButton } from "./settingsShared";

const TOOL_LABELS: Record<string, string> = {
  "gmail.sendEmail": "Send email",
  "gmail.draftEmail": "Draft email",
  "calendar.createEvent": "Create calendar event",
  "calendar.listEvents": "List calendar events",
  "calendar.checkAvailability": "Check calendar availability",
  "x.getTimeline": "Get X timeline",
  "x.getMentions": "Get X mentions",
  "x.searchTweets": "Search X tweets",
  "files.searchFiles": "Search files",
  "files.readFile": "Read file",
  "memory.query": "Query memory",
  "memory.store": "Store to memory",
  "search.query": "Web search",
};

const TOOL_GROUPS: Record<string, string[]> = {
  "Email": ["gmail.sendEmail", "gmail.draftEmail"],
  "Calendar": ["calendar.createEvent", "calendar.listEvents", "calendar.checkAvailability"],
  "Social": ["x.getTimeline", "x.getMentions", "x.searchTweets"],
  "Files": ["files.searchFiles", "files.readFile"],
  "Memory": ["memory.query", "memory.store"],
  "Search": ["search.query"],
};

export default function PermissionsSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [local, setLocal] = useState(config);

  function handleTrustChange(level: TrustLevel) {
    setLocal(applyTrustLevel(local, level));
  }

  function handleToolToggle(tool: string, value: boolean) {
    setLocal((prev) => ({
      ...prev,
      tools: { ...prev.tools, [tool]: { requiresApproval: value } },
    }));
  }

  async function handleSave() {
    await saveConfig(local);
    onSave(local);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>PERMISSIONS</SectionTitle>
      <div>
        <FieldLabel>Trust Level</FieldLabel>
        <Segment
          options={["supervised", "balanced", "autonomous"] as const}
          value={local.trustLevel}
          onChange={handleTrustChange}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Supervised: confirm everything · Balanced: confirm side-effects · Autonomous: confirm nothing
        </div>
      </div>
      {Object.entries(TOOL_GROUPS).map(([group, tools]) => (
        <div key={group}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>{group.toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {tools.map((tool) => (
              <div key={tool} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 12, color: "var(--text)" }}>{TOOL_LABELS[tool]}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {local.tools[tool]?.requiresApproval ? "requires approval" : "auto"}
                  </span>
                  <Toggle
                    value={local.tools[tool]?.requiresApproval ?? false}
                    onChange={(v) => handleToolToggle(tool, v)}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <SaveButton onClick={handleSave} />
    </div>
  );
}