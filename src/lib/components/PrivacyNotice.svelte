<script lang="ts">
	import { ShieldCheck } from '@lucide/svelte';

	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { dismissPrivacyNotice } from '$lib/remote/privacyNotice.remote';

	let { dismissed }: { dismissed: boolean } = $props();

	let hiddenLocally = $state(false);
</script>

{#if !dismissed && !hiddenLocally}
	<aside
		aria-label="Privacy notice"
		class="border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
	>
		<div class="flex items-start gap-3">
			<ShieldCheck class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
			<div class="space-y-2">
				<p>
					Your designs stay in this browser. They reach GitHub only if you connect it and sync. We
					count visits anonymously, without cookies or tracking; the only cookies are for access and
					GitHub sign-in.
				</p>
				<div class="flex items-center gap-3">
					<form
						{...dismissPrivacyNotice.enhance(async ({ submit }) => {
							hiddenLocally = true;
							// No updates: a plain submit() reloads every load function, which remounts the editor.
							await submit().updates();
						})}
					>
						<Button type="submit" size="sm">Got it</Button>
					</form>
					<a
						href={resolve('/privacy')}
						class="text-muted-foreground underline underline-offset-2 hover:text-foreground"
						>Privacy details</a
					>
				</div>
			</div>
		</div>
	</aside>
{/if}
