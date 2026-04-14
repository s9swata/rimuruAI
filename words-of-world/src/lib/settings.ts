import { writable } from 'svelte/store';

export interface AppSettings {
  groqApiKey: string;
  hotkey: string;
  pushToTalk: boolean;
}

export const defaultSettings: AppSettings = {
  groqApiKey: '',
  hotkey: 'Alt+Space',
  pushToTalk: false
};

export const settings = writable<AppSettings>(defaultSettings);

export async function loadSettings(): Promise<AppSettings> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    const loaded = await invoke<AppSettings>('get_settings');
    settings.set(loaded);
    return loaded;
  } catch (e) {
    console.error('Failed to load settings:', e);
    return defaultSettings;
  }
}

export async function saveSettings(newSettings: AppSettings): Promise<boolean> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('save_settings', { settings: newSettings });
    settings.set(newSettings);
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

export type RecordingState = 'idle' | 'recording' | 'processing';

export const recordingState = writable<RecordingState>('idle');

export function setRecordingState(state: RecordingState) {
  recordingState.set(state);
}