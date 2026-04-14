<script lang="ts">
  import { recordingState, type RecordingState } from '$lib/settings';

  const stateIcons: Record<RecordingState, string> = {
    idle: '○',
    recording: '●',
    processing: '◐'
  };

  const stateLabels: Record<RecordingState, string> = {
    idle: 'Idle',
    recording: 'Recording',
    processing: 'Processing'
  };

  const stateClasses: Record<RecordingState, string> = {
    idle: 'state-idle',
    recording: 'state-recording',
    processing: 'state-processing'
  };
</script>

<div class="status-indicator" class:state-idle={$recordingState === 'idle'} class:state-recording={$recordingState === 'recording'} class:state-processing={$recordingState === 'processing'}>
  <span class="icon" class:recording={$recordingState === 'recording'} class:processing={$recordingState === 'processing'}>
    {stateIcons[$recordingState]}
  </span>
  <span class="label">{stateLabels[$recordingState]}</span>
</div>

<style>
  .status-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 16px;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: rgba(128, 128, 128, 0.1);
    transition: all 0.2s ease;
  }

  .icon {
    font-size: 14px;
    color: #8e8e93;
    transition: color 0.2s ease;
  }

  .label {
    color: #636366;
    font-weight: 500;
  }

  .state-recording {
    background: rgba(255, 59, 48, 0.1);
  }

  .state-recording .icon {
    color: #ff3b30;
    animation: pulse 1s infinite;
  }

  .state-recording .label {
    color: #ff3b30;
  }

  .state-processing {
    background: rgba(0, 122, 255, 0.1);
  }

  .state-processing .icon {
    color: #007aff;
    animation: spin 1s linear infinite;
  }

  .state-processing .label {
    color: #007aff;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>