import { useState } from "react";
import { RaphaelConfig } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { SectionTitle, FieldLabel, TextInput, SaveButton } from "./settingsShared";

export default function HotkeySection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [hotkey, setHotkey] = useState(config.hotkey);

  async function handleSave() {
    const updated: RaphaelConfig = { ...config, hotkey };
    await saveConfig(updated);
    onSave(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>HOTKEY</SectionTitle>
      <div>
        <FieldLabel>Global shortcut to summon Raphael</FieldLabel>
        <TextInput value={hotkey} onChange={setHotkey} placeholder="Super+Shift+Space" />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Changes take effect after restarting the app.
        </div>
      </div>
      <SaveButton onClick={handleSave} />
    </div>
  );
}