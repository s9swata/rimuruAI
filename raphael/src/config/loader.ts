import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_CONFIG, RaphaelConfig } from "./types";

export async function loadConfig(): Promise<RaphaelConfig> {
  try {
    const json = await invoke<string>("load_config");
    if (!json) return DEFAULT_CONFIG;
    const parsed = JSON.parse(json) as Partial<RaphaelConfig>;
    // Merge with DEFAULT_CONFIG so new keys added in future releases always have defaults
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      persona: { ...DEFAULT_CONFIG.persona, ...(parsed.persona ?? {}) },
      tools: { ...DEFAULT_CONFIG.tools, ...(parsed.tools ?? {}) },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: RaphaelConfig): Promise<void> {
  await invoke("save_config", { json: JSON.stringify(config, null, 2) });
}