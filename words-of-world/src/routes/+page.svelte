<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import StatusIndicator from '$lib/components/StatusIndicator.svelte';
  import { recordingState, setRecordingState, loadSettings, saveSettings, defaultSettings, type AppSettings, type RecordingState } from '$lib/settings';
  import { invoke } from '@tauri-apps/api/core';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { register, unregister } from '@tauri-apps/plugin-global-shortcut';

  interface AudioDevice {
    name: string;
    is_default: boolean;
  }

  let settings: AppSettings = { ...defaultSettings };
  let currentAudioPath: string | null = null;
  let errorMessage: string | null = null;
  let unlistenTrayRecord: UnlistenFn;
  let unlistenOpenPrefs: UnlistenFn;
  let isRecordingHotkey = false;
  let recordedKeys: string[] = [];
  let hasApiKey = false;
  let audioDevices: AudioDevice[] = [];
  let selectedDevice = '';
  let micTestActive = false;
  let micAmplitude = 0;
  let unlistenMicAmplitude: UnlistenFn;

  onMount(async () => {
    settings = await loadSettings();
    if (settings.hotkey) {
      recordedKeys = settings.hotkey.split('+');
      await registerHotkey(settings.hotkey);
    }

    hasApiKey = await invoke<boolean>('has_api_key').catch(() => false);

    await loadAudioDevices();

    unlistenTrayRecord = await listen('tray-record', () => {
      toggleRecording();
    });

    unlistenOpenPrefs = await listen('open-preferences', () => {});

    unlistenMicAmplitude = await listen<number>('mic-amplitude', (event) => {
      micAmplitude = event.payload;
    });
  });

  onDestroy(() => {
    unlistenMicAmplitude?.();
    if (micTestActive) {
      invoke('stop_mic_test').catch(() => {});
    }
  });

  async function loadAudioDevices() {
    try {
      audioDevices = await invoke<AudioDevice[]>('list_microphones');
      const defaultDevice = audioDevices.find(d => d.is_default);
      selectedDevice = defaultDevice?.name || audioDevices[0]?.name || '';
    } catch (e) {
      console.error('Failed to load audio devices:', e);
    }
  }

  async function startMicTest() {
    micAmplitude = 0;
    micTestActive = true;
    try {
      await invoke('start_mic_test', { deviceName: selectedDevice || null });
    } catch (e) {
      console.error('Failed to start mic test:', e);
      micTestActive = false;
    }
  }

  async function stopMicTest() {
    micTestActive = false;
    micAmplitude = 0;
    try {
      await invoke('stop_mic_test');
    } catch (e) {
      console.error('Failed to stop mic test:', e);
    }
  }

  onDestroy(async () => {
    unlistenTrayRecord?.();
    unlistenOpenPrefs?.();
    unlistenMicAmplitude?.();
    if (micTestActive) {
      await invoke('stop_mic_test').catch(() => {});
    }
    if (settings.hotkey) {
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

  async function handleSave() {
    if (settings.hotkey && settings.hotkey !== defaultSettings.hotkey) {
      await unregisterHotkey(defaultSettings.hotkey);
    }
    if (settings.hotkey) {
      await registerHotkey(settings.hotkey);
    }
    await saveSettings(settings);
    if (settings.hotkey) {
      recordedKeys = settings.hotkey.split('+');
    }
    hasApiKey = await invoke<boolean>('has_api_key').catch(() => false);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (!isRecordingHotkey) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const key = event.key;
    
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
      return;
    }
    
    const newKeys: string[] = [];
    if (event.ctrlKey) newKeys.push('Ctrl');
    if (event.altKey) newKeys.push('Alt');
    if (event.shiftKey) newKeys.push('Shift');
    if (event.metaKey) newKeys.push('Cmd');
    
    const displayKey = key.length === 1 ? key.toUpperCase() : key;
    if (!newKeys.includes(displayKey)) {
      newKeys.push(displayKey);
    }
    
    recordedKeys = newKeys;
    settings.hotkey = newKeys.join('+');
    isRecordingHotkey = false;
  }

  function clearHotkey() {
    recordedKeys = [];
    settings.hotkey = '';
  }

  $: hasChanges = settings.groqApiKey !== defaultSettings.groqApiKey || 
                 settings.hotkey !== defaultSettings.hotkey || 
                 settings.pushToTalk !== defaultSettings.pushToTalk;
</script>

<svelte:window on:keydown={handleKeyDown} />

<main class="container">
  <div class="app-header">
    <h1 class="app-title">Words of World</h1>
    <div class="header-controls">
      <StatusIndicator />
      <button 
        class="record-btn" 
        on:click={toggleRecording} 
        disabled={$recordingState === 'processing'}
        class:recording={$recordingState === 'recording'}
        class:processing={$recordingState === 'processing'}
      >
        {#if $recordingState === 'processing'}
          <span class="spinner"></span>
        {:else if $recordingState === 'recording'}
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"/>
          </svg>
        {:else}
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="6"/>
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <p class="hotkey-hint">Press <kbd>{settings.hotkey || 'Alt+Space'}</kbd> to record</p>

  <div class="app-content">

    <section class="settings-section">
      <h2 class="section-title">Settings</h2>
      
      <div class="form">
        <div class="field">
          <div class="api-key-header">
            <label for="groq-api-key">Groq API Key</label>
            <span class="api-key-status" class:configured={hasApiKey}>
              {hasApiKey ? '✓ Configured' : 'Not set'}
            </span>
          </div>
          <input
            id="groq-api-key"
            type="password"
            placeholder="gsk_..."
            bind:value={settings.groqApiKey}
            autocomplete="off"
          />
          <span class="hint">Get your key from <a href="https://console.groq.com" target="_blank" rel="noopener">groq.com</a></span>
        </div>

        <div class="field">
          <span class="field-label">Global Hotkey</span>
          <div class="hotkey-field">
            <button
              class="hotkey-recorder"
              class:recording={isRecordingHotkey}
              on:click={() => isRecordingHotkey = !isRecordingHotkey}
              on:blur={() => isRecordingHotkey = false}
            >
              {#if isRecordingHotkey}
                Press keys...
              {:else if recordedKeys.length > 0}
                {recordedKeys.join(' + ')}
              {:else}
                Click to record
              {/if}
            </button>
            {#if recordedKeys.length > 0}
              <button class="clear-btn" on:click={clearHotkey}>Clear</button>
            {/if}
          </div>
        </div>

        <div class="field checkbox-field">
          <label class="checkbox-label">
            <input
              type="checkbox"
              bind:checked={settings.pushToTalk}
            />
            <span class="checkbox-custom"></span>
            <span class="checkbox-text">Push-to-Talk Mode</span>
          </label>
          <span class="hint">Hold hotkey to record</span>
        </div>

        <div class="actions">
          <button 
            class="save-btn" 
            on:click={handleSave} 
            disabled={!hasChanges}
          >
            Save Settings
          </button>
        </div>
      </div>
    </section>

    <section class="mic-section">
      <h2 class="section-title">Microphone</h2>

      <div class="field">
        <label for="mic-select">Input Device</label>
        <select id="mic-select" bind:value={selectedDevice} on:change={() => { if (micTestActive) { stopMicTest(); startMicTest(); } }}>
          {#each audioDevices as device}
            <option value={device.name}>
              {device.name} {device.is_default ? '(Default)' : ''}
            </option>
          {/each}
        </select>
      </div>

      <div class="mic-visualizer" on:mousedown={startMicTest} on:mouseup={stopMicTest} on:mouseleave={stopMicTest}>
        <div class="bars">
          {#each Array(12) as _, i}
            <div 
              class="bar" 
              style="height: {micTestActive ? Math.max(4, micAmplitude * 100 * (0.5 + Math.random() * 0.5)) : 4}%"
              class:active={micAmplitude > 0.05}
            ></div>
          {/each}
        </div>
        <span class="mic-hint">{micTestActive ? 'Release to stop' : 'Hold to test'}</span>
      </div>

      {#if !micTestActive && micAmplitude === 0 && audioDevices.length > 0}
        <span class="mic-error">No input detected - check your microphone</span>
      {/if}
    </section>
  </div>

  {#if errorMessage}
    <div class="error-toast">
      <span>{errorMessage}</span>
      <button on:click={() => errorMessage = null}>Dismiss</button>
    </div>
  {/if}
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif;
    background: #0a0a0c;
    color: #f5f5f7;
    -webkit-font-smoothing: antialiased;
  }

  .container {
    min-height: 100vh;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: linear-gradient(135deg, #1c1c1f 0%, #2c2c2f 100%);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .app-title {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    background: linear-gradient(135deg, #fff 0%, #a1a1aa 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    margin: 0;
  }

  .header-controls {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .record-btn {
    width: 44px;
    height: 44px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
  }

  .record-btn.recording {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  }

  .record-btn.processing {
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
  }

  .record-btn .icon {
    width: 20px;
    height: 20px;
    color: #fff;
  }

  .hotkey-hint {
    font-size: 13px;
    color: #71717a;
    margin-top: -16px;
    text-align: center;
  }

  .hotkey-hint kbd {
    display: inline-block;
    padding: 2px 8px;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #a1a1aa;
  }

  .app-content {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }

  @media (min-width: 640px) {
    .app-content {
      grid-template-columns: 1fr 1fr;
    }
  }

  .recorder-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 32px;
    background: linear-gradient(135deg, #1c1c1f 0%, #2c2c2f 100%);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    gap: 16px;
  }

  .record-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 160px;
    padding: 16px 32px;
    font-size: 16px;
    font-weight: 600;
    letter-spacing: -0.01em;
    border: none;
    border-radius: 16px;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: #fff;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.3);
  }

  .record-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(59, 130, 246, 0.4);
  }

  .record-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .record-btn.recording {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);
    animation: pulse-recording 1.5s ease-in-out infinite;
  }

  .record-btn.processing {
    background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
    cursor: wait;
  }

  @keyframes pulse-recording {
    0%, 100% { box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4); }
    50% { box-shadow: 0 4px 32px rgba(239, 68, 68, 0.6); }
  }

  .record-btn .icon {
    width: 20px;
    height: 20px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .hotkey-hint {
    font-size: 13px;
    color: #71717a;
    margin: 0;
  }

  .hotkey-hint kbd {
    display: inline-block;
    padding: 2px 8px;
    font-size: 12px;
    font-family: 'SF Mono', Monaco, monospace;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #a1a1aa;
  }

  .settings-section {
    padding: 24px;
    background: linear-gradient(135deg, #1c1c1f 0%, #2c2c2f 100%);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .section-title {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #52525b;
    margin: 0 0 20px 0;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .field label {
    font-size: 14px;
    font-weight: 500;
    color: #e4e4e7;
  }

  .field-label {
    font-size: 14px;
    font-weight: 500;
    color: #e4e4e7;
  }

  .field input[type="password"] {
    padding: 12px 14px;
    font-size: 14px;
    font-family: 'SF Mono', Monaco, monospace;
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #f5f5f7;
    transition: all 0.2s;
  }

  .field input[type="password"]:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .field input[type="password"]::placeholder {
    color: #52525b;
  }

  .hint {
    font-size: 12px;
    color: #71717a;
  }

  .hint a {
    color: #3b82f6;
    text-decoration: none;
  }

  .hint a:hover {
    text-decoration: underline;
  }

  .hotkey-field {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .hotkey-recorder {
    flex: 1;
    padding: 12px 16px;
    font-size: 14px;
    font-family: 'SF Mono', Monaco, monospace;
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #f5f5f7;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 46px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hotkey-recorder:hover {
    border-color: rgba(255, 255, 255, 0.2);
  }

  .hotkey-recorder.recording {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
    animation: pulse-border 1s infinite;
  }

  @keyframes pulse-border {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
    50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.2); }
  }

  .clear-btn {
    padding: 10px 14px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-btn:hover {
    background: rgba(255, 255, 255, 0.05);
    color: #e4e4e7;
  }

  .checkbox-field {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .checkbox-label input[type="checkbox"] {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .checkbox-custom {
    width: 22px;
    height: 22px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    background: #0a0a0c;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .checkbox-label input[type="checkbox"]:checked + .checkbox-custom {
    background: #3b82f6;
    border-color: #3b82f6;
  }

  .checkbox-label input[type="checkbox"]:checked + .checkbox-custom::after {
    content: '✓';
    color: #fff;
    font-size: 13px;
    font-weight: bold;
  }

  .checkbox-text {
    font-size: 14px;
    color: #e4e4e7;
  }

  .actions {
    margin-top: 8px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .save-btn {
    width: 100%;
    padding: 14px 20px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: #fff;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .save-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  }

  .save-btn:disabled {
    background: #3f3f46;
    color: #71717a;
    cursor: not-allowed;
  }

  .error-toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    background: rgba(239, 68, 68, 0.95);
    border-radius: 12px;
    color: #fff;
    font-size: 14px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: slide-up 0.3s ease-out;
  }

  .error-toast button {
    padding: 4px 12px;
    font-size: 13px;
    background: rgba(255, 255, 255, 0.2);
    border: none;
    border-radius: 6px;
    color: #fff;
    cursor: pointer;
  }

  @keyframes slide-up {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(16px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  .api-key-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .api-key-status {
    font-size: 12px;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }

  .api-key-status.configured {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  .mic-section {
    padding: 24px;
    background: linear-gradient(135deg, #1c1c1f 0%, #2c2c2f 100%);
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.06);
  }

  .mic-status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 10px;
  }

  .mic-status-indicator {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #71717a;
  }

  .mic-status-indicator.ready {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }

  .mic-status-indicator.error {
    background: #ef4444;
    box-shadow: 0 0 8px rgba(239, 68, 68, 0.5);
  }

  .mic-status-text {
    font-size: 14px;
    color: #a1a1aa;
  }

  .mic-section select {
    width: 100%;
    padding: 12px 14px;
    font-size: 14px;
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #f5f5f7;
    cursor: pointer;
  }

  .mic-section select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }

  .mic-visualizer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    cursor: pointer;
    user-select: none;
    transition: all 0.2s;
    -webkit-user-select: none;
  }

  .mic-visualizer:active {
    border-color: #22c55e;
  }

  .bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 60px;
    width: 100%;
    justify-content: center;
  }

  .bar {
    width: 8px;
    background: #3f3f46;
    border-radius: 4px;
    transition: height 0.05s ease-out;
  }

  .bar.active {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
  }

  .mic-hint {
    font-size: 13px;
    color: #71717a;
  }

  .mic-error {
    font-size: 12px;
    color: #ef4444;
    margin-top: 4px;
  }

  .test-mic-btn {
    width: 100%;
    margin-top: 12px;
    padding: 12px 20px;
    font-size: 14px;
    font-weight: 500;
    background: #0a0a0c;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    color: #e4e4e7;
    cursor: pointer;
    transition: all 0.2s;
  }

  .test-mic-btn:hover:not(:disabled) {
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .test-mic-btn.testing {
    background: rgba(59, 130, 246, 0.1);
    border-color: #3b82f6;
    color: #3b82f6;
  }

  .test-mic-btn.success {
    background: rgba(34, 197, 94, 0.1);
    border-color: #22c55e;
    color: #22c55e;
  }

  .test-mic-btn.failed {
    background: rgba(239, 68, 68, 0.1);
    border-color: #ef4444;
    color: #ef4444;
  }

  .test-mic-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>