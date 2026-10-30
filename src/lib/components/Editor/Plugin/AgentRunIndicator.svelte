<script lang="ts">
	import { Bot, LoaderCircle, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { help } from '$lib/components/help/help';
	import type { AgentRunRecord } from '$lib/plugin/agentRuns';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	const editorCtx = getEditorViewContext();
	const agentRuns = $derived(editorCtx.agentRuns);
	const folderName = $derived(
		agentRuns.pluginId
			? (editorCtx.pluginRegistry.get(agentRuns.pluginId)?.linked?.folderName ?? '')
			: ''
	);

	// Agent edits must be noticeable while the Plugins panel is closed.
	let toasted: AgentRunRecord | null = null;
	$effect(() => {
		const run = agentRuns.lastRun;
		if (!run || run === toasted) return;
		toasted = run;
		const what = run.script ?? 'plugin.py';
		if (run.status === 'done' && run.applyOutcome !== 'stale') {
			toast.info(`Agent ran ${what}`, {
				description:
					run.applyOutcome === 'applied'
						? `Applied${run.summary ? ` (${run.summary})` : ''}. Undo reverts it.`
						: run.applyOutcome === 'pending-review'
							? 'The result is waiting for Apply or Discard in the Plugins panel.'
							: 'The design was not changed.',
			});
		} else {
			const verb =
				run.status === 'done'
					? 'not applied'
					: run.status === 'rejected'
						? 'rejected'
						: run.status === 'cancelled'
							? 'cancelled'
							: 'failed';
			toast.warning(`Agent run of ${what} ${verb}`, { description: run.error ?? undefined });
		}
	});

	const label = $derived(
		agentRuns.current
			? `Running ${agentRuns.current.script ?? 'plugin.py'}`
			: agentRuns.state === 'listening'
				? `Agent runs: ${folderName} → ${agentRuns.connection?.docName ?? ''}`
				: agentRuns.state === 'needs-permission'
					? 'Agent runs: allow folder access'
					: `Agent runs paused: ${agentRuns.pausedReason ?? ''}`
	);
</script>

{#if agentRuns.state !== 'off'}
	<div
		class={[
			'my-auto ml-2 flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[12px]',
			agentRuns.state === 'listening' && 'border-primary bg-primary/10 text-primary',
			agentRuns.state === 'needs-permission' && 'border-amber-300 text-amber-700',
			agentRuns.state === 'paused' && 'text-muted-foreground',
		]}
		{@attach help({
			title: 'Agent runs',
			text: 'A coding agent can run Python from this linked folder (python .foldnano/run.py) on the named design, and results are applied straight away (each run is one undo step). Turn it off here or in Plugins → Dev.',
		})}
	>
		<button
			class="flex max-w-56 cursor-pointer items-center gap-1 truncate"
			title={agentRuns.state === 'needs-permission'
				? 'Click to let Foldnano read and write the folder again'
				: label}
			onclick={() => {
				if (agentRuns.state === 'needs-permission') void agentRuns.resume();
			}}
		>
			{#if agentRuns.current}
				<LoaderCircle size={13} class="shrink-0 animate-spin" />
			{:else}
				<Bot size={13} class="shrink-0" />
			{/if}
			<span class="truncate">{label}</span>
		</button>
		<button
			class="cursor-pointer rounded p-0.5 hover:bg-muted"
			title="Stop accepting agent runs"
			onclick={() => void agentRuns.disable()}
		>
			<X size={11} />
		</button>
	</div>
{/if}
