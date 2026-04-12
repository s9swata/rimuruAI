import { DEFAULT_CONFIG, RaphaelConfig } from "./types";

export async function loadConfig(): Promise<RaphaelConfig> {
  return DEFAULT_CONFIG;
}

export async function saveConfig(_config: RaphaelConfig): Promise<void> {
  return;
}