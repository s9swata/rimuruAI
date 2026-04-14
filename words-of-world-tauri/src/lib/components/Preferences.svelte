<script lang="ts">
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { loadSettings, saveSettings, defaultSettings, type AppSettings } from '$lib/settings';

  const dispatch = createEventDispatcher<{
    save: AppSettings;
    close: void;
  }>();

  let settings: AppSettings = { ...defaultSettings };
  let originalSettings: AppSettings = { ...defaultSettings };
  let loading = true;
  let saving = false;
  let error = '';
  let isRecordingHotkey = false;
  let recordedKeys: string[] = [];

  onMount(async () => {
    try {
      settings = await loadSettings();
      originalSettings = { ...settings };
      if (settings.hotkey) {
        recordedKeys = settings.hotkey.split('+');
      }
    } catch (e) {
      error = 'Failed to load settings';
      console.error(e);
    } finally {
      loading = false;
    }
  });

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

  async function handleSave() {
    saving = true;
    error = '';
    
    const success = await saveSettings(settings);
    
    if (success) {
      originalSettings = { ...settings };
      dispatch('save', settings);
    } else {
      error = 'Failed to save settings';
    }
    
    saving = false;
  }

  function handleCancel() {
    dispatch('close');
  }

  $: hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="preferences">
  <h2 class="title">Preferences</h2>
  
  {#if loading}
    <div class="loading">Loading settings...</div>
  {:else}
    <div class="form">
      <div class="field">
        <label for="groq-api-key">Groq API Key</label>
        <input
          id="groq-api-key"
          type="password"
          placeholder="gsk_..."
          bind:value={settings.groqApiKey}
          autocomplete="off"
        />
        <span class="hint">Get your API key from <a href="https://console.groq.com" target="_blank" rel="noopener">groq.com</a></span>
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
        <span class="hint">Hold the hotkey to record audio</span>
      </div>

      {#if error}
        <div class="error">{error}</div>
      {/if}

      <div class="actions">
        <button class="btn-secondary" on:click={handleCancel} disabled={saving}>
          Cancel
        </button>
        <button class="btn-primary" on:click={handleSave} disabled={!hasChanges || saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .preferences {
    max-width: 480px;
    margin: 0 auto;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .title {
    font-size: 20px;
    font-weight: 600;
    color: #1d1d1f;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 1px solid #e5e5e5;
  }

  .loading {
    text-align: center;
    color: #86868b;
    padding: 40px;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field label {
    font-size: 13px;
    font-weight: 500;
    color: #1d1d1f;
  }

  .field input[type="password"] {
    padding: 10px 12px;
    font-size: 14px;
    border: 1px solid #d2d2d7;
    border-radius: 8px;
    background: #fff;
    color: #1d1d1f;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .field input[type="password"]:focus {
    outline: none;
    border-color: #007aff;
    box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.15);
  }

  .hint {
    font-size: 12px;
    color: #86868b;
  }

  .hint a {
    color: #007aff;
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
    padding: 10px 16px;
    font-size: 14px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border: 1px solid #d2d2d7;
    border-radius: 8px;
    background: #f5f5f7;
    color: #1d1d1f;
    cursor: pointer;
    transition: all 0.2s;
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hotkey-recorder:hover {
    background: #e8e8ed;
  }

  .hotkey-recorder.recording {
    border-color: #ff3b30;
    background: rgba(255, 59, 48, 0.1);
    color: #ff3b30;
    animation: pulse-border 1s infinite;
  }

  @keyframes pulse-border {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.4); }
    50% { box-shadow: 0 0 0 4px rgba(255, 59, 48, 0.2); }
  }

  .clear-btn {
    padding: 8px 12px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border: 1px solid #d2d2d7;
    border-radius: 6px;
    background: #fff;
    color: #86868b;
    cursor: pointer;
    transition: all 0.2s;
  }

  .clear-btn:hover {
    background: #f5f5f7;
    color: #1d1d1f;
  }

  .checkbox-field {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
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
    width: 20px;
    height: 20px;
    border: 2px solid #d2d2d7;
    border-radius: 4px;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .checkbox-label input[type="checkbox"]:checked + .checkbox-custom {
    background: #007aff;
    border-color: #007aff;
  }

  .checkbox-label input[type="checkbox"]:checked + .checkbox-custom::after {
    content: '✓';
    color: #fff;
    font-size: 12px;
    font-weight: bold;
  }

  .checkbox-text {
    font-size: 14px;
    color: #1d1d1f;
  }

  .error {
    padding: 10px 14px;
    background: rgba(255, 59, 48, 0.1);
    border-radius: 8px;
    color: #ff3b30;
    font-size: 13px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 8px;
    padding-top: 16px;
    border-top: 1px solid #e5e5e5;
  }

  .btn-primary,
  .btn-secondary {
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 500;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #007aff;
    color: #fff;
    border: none;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0063cc;
  }

  .btn-primary:disabled {
    background: #a7a7ab;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: #fff;
    color: #1d1d1f;
    border: 1px solid #d2d2d7;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #f5f5f7;
  }

  .btn-secondary:disabled {
    color: #a7a7ab;
    cursor: not-allowed;
  }
</style>