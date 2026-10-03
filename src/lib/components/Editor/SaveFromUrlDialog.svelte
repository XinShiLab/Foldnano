<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	interface Props {
		open: boolean;
		sourceUrl: string | null;
		onConfirm: () => void;
	}

	let { open = $bindable(), sourceUrl, onConfirm }: Props = $props();

	function handleConfirm() {
		open = false;
		onConfirm();
	}

	function hostname() {
		if (!sourceUrl) return null;
		try {
			return new URL(sourceUrl).hostname;
		} catch {
			return sourceUrl;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Save this design to your browser?</Dialog.Title>
			<Dialog.Description>
				This design was loaded from an external URL. Saving it will store a copy in your browser's
				local storage.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-2 text-sm text-muted-foreground">
			<ul class="list-disc space-y-1 pl-5">
				<li>
					Find it later in <strong class="text-foreground">Documents</strong> (<code>/toc</code>)
				</li>
				<li>To download the file, use <strong class="text-foreground">Export</strong></li>
			</ul>
			{#if hostname()}
				<p class="mt-3 truncate text-xs">
					Source: <span class="font-mono text-foreground">{hostname()}</span>
				</p>
			{/if}
		</div>

		<Dialog.Footer class="flex gap-2">
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={handleConfirm}>Save to Browser</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
