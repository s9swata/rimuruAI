<script lang="ts">
  import { cn } from "$lib/utils";

  let {
    class: className,
    ...restProps
  }: {
    class?: string;
  } = $props();
</script>

<div
  class={cn(
    "rounded-xl border bg-card text-card-foreground shadow",
    className
  )}
  {...restProps}
>
  <slot />
</div>