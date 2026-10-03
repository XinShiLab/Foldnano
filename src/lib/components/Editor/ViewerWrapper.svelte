<script lang="ts">
	let { children } = $props();
</script>

<div class=" m-2 h-full overflow-hidden">
	{@render children?.()}
</div>
