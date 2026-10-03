<script lang="ts">
	import { cn } from '$lib/utils/utils';

	type Props = {
		active?: boolean;
		id: string;
		class?: string;
		children: import('svelte').Snippet;
	};

	let { active = false, id, class: className, children }: Props = $props();
</script>

<span
	data-tutorial-id={id}
	class={cn(
		'inline-flex rounded-sm transition-shadow',
		active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
		className
	)}
>
	{@render children()}
</span>
