<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import Preferences from '$lib/components/Preferences.svelte';
  import StatusIndicator from '$lib/components/StatusIndicator.svelte';
  import { recordingState, setRecordingState, loadSettings, type AppSettings } from '$lib/settings';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

  let settings: AppSettings | null = null;
  let currentAudioPath: string | null = null;
  let showPreferences = false;
  let errorMessage: string | null = null;
  let unlistenTrayRecord: UnlistenFn;
  let unlistenOpenPrefs: UnlistenFn;

  onMount(async () => {
    settings = await loadSettings();
    
    if (settings?.hotkey) {
      await registerHotkey(settings.hotkey);
    }

    unlistenTrayRecord = await listen('tray-record', () => {
      toggleRecording();
    });

    unlistenOpenPrefs = await listen('open-preferences', () => {
      showPreferences = true;
    });
  });

  onDestroy(async () => {
    unlistenTrayRecord?.();
    unlistenOpenPrefs?.();
    if (settings?.hotkey) {
      await unregisterHotkey(settings.hotkey);
    }
  });

  async function registerHotkey(hotkey: string) {
    try {
      await register(hotkey, (event) => {
        if (event.state === 'Pressed') {
          toggleRecording();
        }
      });
    } catch (e) {
      console.error('Failed to register hotkey:', e);
    }
  }

  async function unregisterHotkey(hotkey: string) {
    try {
      await unregister(hotkey);
    } catch (e) {
      console.error('Failed to unregister hotkey:', e);
    }
  }

  async function toggleRecording() {
    const isRecording = await invoke<boolean>('check_recording_status');
    
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }

  async function startRecording() {
    try {
      errorMessage = null;
      setRecordingState('recording');
      currentAudioPath = await invoke<string>('start_recording');
    } catch (e) {
      console.error('Failed to start recording:', e);
      errorMessage = `Start failed: ${e}`;
      setRecordingState('idle');
    }
  }

  async function stopRecording() {
    try {
      setRecordingState('processing');
      const audioPath = await invoke<string | null>('stop_recording');

      if (audioPath) {
        const transcript = await invoke<string>('transcribe_audio', { audioPath });
        await invoke('inject_text', { text: transcript });
      } else {
        errorMessage = 'No audio captured';
      }

      setRecordingState('idle');
    } catch (e) {
      console.error('Failed to process recording:', e);
      errorMessage = `Error: ${e}`;
      setRecordingState('idle');
    }
  }

  async function handleSettingsSaved(newSettings: AppSettings) {
    if (settings?.hotkey && settings.hotkey !== newSettings.hotkey) {
      await unregisterHotkey(settings.hotkey);
    }
    if (newSettings.hotkey) {
      await registerHotkey(newSettings.hotkey);
    }
    settings = newSettings;
    showPreferences = false;
  }
</script>

<main class="container">
  <div class="header">
    <StatusIndicator />
    <button class="record-btn" on:click={toggleRecording} disabled={$recordingState === 'processing'} aria-busy={$recordingState === 'processing'}>
      {$recordingState === 'recording' ? 'Stop' : 'Record'}
    </button>
    <button class="settings-btn" on:click={() => showPreferences = true}>
      ⚙️
    </button>
  </div>
  
  {#if errorMessage}
    <div class="error-banner">
      {errorMessage}
      <button on:click={() => errorMessage = null}>✕</button>
    </div>
  {/if}

  {#if showPreferences}
    <Preferences
      on:save={(e) => handleSettingsSaved(e.detail)}
      on:close={() => showPreferences = false}
    />
  {/if}
</main>

<style>
  .container {
    min-height: 100vh;
    background: #f5f5f7;
    padding: 16px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .record-btn {
    padding: 8px 20px;
    font-size: 14px;
    font-weight: 500;
    border: none;
    border-radius: 8px;
    background: #007aff;
    color: #fff;
    cursor: pointer;
    transition: background 0.2s;
  }

  .record-btn:hover {
    background: #0063cc;
  }

  .settings-btn {
    padding: 8px 12px;
    font-size: 16px;
    border: none;
    border-radius: 8px;
    background: #f5f5f7;
    cursor: pointer;
    transition: background 0.2s;
  }

  .settings-btn:hover {
    background: #e8e8ed;
  }

  .error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding: 8px 12px;
    background: #fee2e2;
    border: 1px solid #fca5a5;
    border-radius: 8px;
    font-size: 13px;
    color: #991b1b;
  }

  .error-banner button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 14px;
    color: #991b1b;
    padding: 0 4px;
  }
</style>