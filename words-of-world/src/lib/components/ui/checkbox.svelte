<script lang="ts">
  import { cn } from "$lib/utils";
  import { Check } from "phosphor-svelte";

  let {
    class: className,
    checked = $bindable(false),
    disabled = false,
    label = "",
    id,
    ...restProps
  }: {
    class?: string;
    checked?: boolean;
    disabled?: boolean;
    label?: string;
    id?: string;
  } = $props();
</script>

<label for={id} class={cn("flex items-center gap-2 cursor-pointer", disabled && "cursor-not-allowed opacity-50")}>
  <input
    type="checkbox"
    id={id}
    bind:checked
    disabled={disabled}
    class="peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    {...restProps}
  />
  <span class={cn("flex h-4 w-4 items-center justify-center rounded border border-input", checked && "bg-primary border-primary")}>
    {#if checked}
      <Check weight="bold" class="size-3 text-primary-foreground" />
    {/if}
  </span>
  {#if label}
    <span class="text-sm font-medium">{label}</span>
  {/if}
</label>