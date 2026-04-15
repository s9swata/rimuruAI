<script lang="ts">
  import { recordingState, type RecordingState } from '$lib/settings';
  import { Circle, ArrowsClockwise } from 'phosphor-svelte';

  const stateLabels: Record<RecordingState, string> = {
    idle: 'Idle',
    recording: 'Recording',
    processing: 'Processing'
  };
</script>

<div class="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors
  {$recordingState === 'idle' ? 'bg-muted text-muted-foreground' : ''}
  {$recordingState === 'recording' ? 'bg-destructive/10 text-destructive' : ''}
  {$recordingState === 'processing' ? 'bg-primary/10 text-primary' : ''}"
>
  {#if $recordingState === 'idle'}
    <span class="w-2 h-2 rounded-full bg-muted-foreground/50"></span>
  {:else if $recordingState === 'recording'}
    <span class="w-2 h-2 rounded-full bg-destructive animate-pulse"></span>
  {:else if $recordingState === 'processing'}
    <ArrowsClockwise class="w-3 h-3 animate-spin" />
  {/if}
  <span>{stateLabels[$recordingState]}</span>
</div>