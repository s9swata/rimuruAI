import { useState } from "react";
import { RaphaelConfig } from "../../config/types";
import { saveConfig } from "../../config/loader";
import { SectionTitle, FieldLabel, TextInput, Segment, SaveButton } from "./settingsShared";

export default function PersonaSection({ config, onSave }: { config: RaphaelConfig; onSave: (c: RaphaelConfig) => void }) {
  const [address, setAddress] = useState(config.persona.address);
  const [tone, setTone] = useState(config.persona.tone);
  const [verbosity, setVerbosity] = useState(config.persona.verbosity);

  async function handleSave() {
    const updated: RaphaelConfig = { ...config, persona: { address, tone, verbosity } };
    await saveConfig(updated);
    onSave(updated);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <SectionTitle>PERSONA</SectionTitle>
      <div>
        <FieldLabel>Address (how Raphael calls you)</FieldLabel>
        <TextInput value={address} onChange={setAddress} placeholder="sir" />
      </div>
      <div>
        <FieldLabel>Tone</FieldLabel>
        <Segment options={["jarvis", "professional", "friendly"] as const} value={tone} onChange={setTone} />
      </div>
      <div>
        <FieldLabel>Verbosity</FieldLabel>
        <Segment options={["terse", "balanced", "verbose"] as const} value={verbosity} onChange={setVerbosity} />
      </div>
      <SaveButton onClick={handleSave} />
    </div>
  );
}