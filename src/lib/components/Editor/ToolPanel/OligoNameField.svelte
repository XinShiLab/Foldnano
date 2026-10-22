<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { Input } from '$lib/components/ui/input';
	import { renameOligoCmd } from '$lib/commands/strands';
	import type Oligo from '$lib/model/Oligo';
	import { getEditorViewContext } from '../context/EditorViewContext.svelte';

	let { oligo }: { oligo: Oligo } = $props();

	const ctx = getEditorViewContext();
	// Pinned at focus: a canvas click can swap `oligo` before this input's blur commits.
	let editing = $state<Oligo | null>(null);
	let draft = $state('');
	const isMirror = $derived(oligo.mirrorOf !== null);
	const readOnly = $derived(isMirror || !ctx.isTabOwner);

	function onfocus() {
		if (readOnly) return;
		editing = oligo;
		draft = oligo.name;
	}

	function commit() {
		const target = editing;
		editing = null;
		if (!target || draft.trim() === target.name) return;
		try {
			renameOligoCmd({ oligo: target, name: draft }, ctx.historyStack);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		}
	}

	function onkeydown(e: KeyboardEvent) {
		const input = e.currentTarget as HTMLInputElement;
		if (e.key === 'Enter') input.blur();
		else if (e.key === 'Escape') {
			editing = null;
			input.blur();
		}
	}

	$effect(() => () => commit());
</script>

<!-- @component
  OligoNameField
  Inline editor for the optional, free-form `Oligo.name` label. Commits on blur / Enter as one
  undo step; Escape reverts. Read-only for repeat-group mirrors (they copy their source's name).
-->

<Input
	value={editing ? draft : oligo.name}
	oninput={(e) => (draft = e.currentTarget.value)}
	{onfocus}
	onblur={commit}
	{onkeydown}
	readonly={readOnly}
	placeholder={isMirror ? '(follows source oligo)' : 'Add a name (optional)'}
	title={isMirror ? "Mirror oligos follow their source's name" : 'Optional label for this oligo'}
	aria-label="Oligo name"
	spellcheck={false}
	class="h-6 flex-1 border-transparent bg-muted px-1.5 font-mono text-foreground read-only:bg-transparent hover:border-input read-only:hover:border-transparent focus-visible:bg-background dark:bg-muted"
/>
