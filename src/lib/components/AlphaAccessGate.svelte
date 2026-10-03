<script lang="ts">
	import { LockKeyhole } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { grantAlphaAccess } from '$lib/remote/alphaAccess.remote';

	let {
		granted,
		title,
		description,
		footer,
		children,
	}: {
		granted: boolean;
		title: string;
		description: string;
		footer?: Snippet;
		children: Snippet;
	} = $props();
</script>

{#if granted}
	{@render children()}
{:else}
	<div class="grid min-h-dvh place-items-center bg-background px-4 py-8 text-foreground">
		<section class="w-full max-w-md border border-border bg-card p-5 shadow-sm">
			<div class="mb-5 flex items-start gap-3">
				<div class="grid size-9 shrink-0 place-items-center border border-border bg-muted">
					<LockKeyhole class="size-4" />
				</div>
				<div class="min-w-0">
					<h1 class="text-base font-semibold">{title}</h1>
					<p class="mt-1 text-sm text-muted-foreground">{description}</p>
				</div>
			</div>

			<form {...grantAlphaAccess} class="space-y-3">
				<div class="space-y-1.5">
					<Label for="alpha-access-code">Access code</Label>
					<Input
						id="alpha-access-code"
						autocomplete="off"
						autofocus
						{...grantAlphaAccess.fields._code.as('password')}
					/>
					{#each grantAlphaAccess.fields._code.issues() as issue (issue.message)}
						<p class="text-xs text-destructive">{issue.message}</p>
					{/each}
				</div>
				<Button type="submit" class="w-full" disabled={grantAlphaAccess.pending > 0}>
					{grantAlphaAccess.pending ? 'Checking...' : 'Continue'}
				</Button>
			</form>

			{#if footer}
				<div class="mt-5 space-y-3 border-t border-border pt-4 text-sm text-muted-foreground">
					{@render footer()}
				</div>
			{/if}
		</section>
	</div>
{/if}
