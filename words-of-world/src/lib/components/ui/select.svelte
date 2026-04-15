<script lang="ts">
  import { cn } from "$lib/utils";
  import { CaretDown } from "phosphor-svelte";

  let {
    class: className,
    value = $bindable(""),
    options = [],
    placeholder = "Select an option",
    disabled = false,
    ...restProps
  }: {
    class?: string;
    value?: string;
    options?: Array<{ value: string; label: string }>;
    placeholder?: string;
    disabled?: boolean;
  } = $props();
</script>

<div class="relative">
  <select
    bind:value
    disabled={disabled}
    class={cn(
      "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none",
      className
    )}
    {...restProps}
  >
    <option value="" disabled>{placeholder}</option>
    {#each options as option}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <CaretDown class="absolute right-2 top-1/2 -translate-y-1/2 size-4 pointer-events-none" />
</div>