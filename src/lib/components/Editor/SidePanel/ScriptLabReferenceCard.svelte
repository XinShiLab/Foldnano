<script lang="ts">
	import { BookOpenText, FileCode2, FlaskConical, Layers } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import { help } from '$lib/components/help/help';

	interface Props {
		onLoadMutationTemplate: () => void;
		onLoadAnalysisTemplate: () => void;
		onLoadFullApiDemoTemplate: () => void;
	}

	let { onLoadMutationTemplate, onLoadAnalysisTemplate, onLoadFullApiDemoTemplate }: Props =
		$props();

	const contextApi = [
		'ctx.get_part_as_foldnano_json() -> current part snapshot',
		'ctx.active_region_id -> selected StrandView region, if any',
		'ctx.log("...") -> stream output into the console',
		'ctx.set_result({...}) -> show structured JSON output',
		'ctx.set_result_mutation_log(part.mutation_log) -> enable Apply',
	];

	const miniPatterns = [
		'part = load_part(ctx.get_part_as_foldnano_json(), active_region_id=ctx.active_region_id)',
		'Inspect with part.oligos / part.virtual_helices / part.regions',
		'Use part.get_region(ctx.active_region_id) when region context matters',
		'Emit part.mutation_log once at the end of a mutating run',
	];
</script>

<div class="flex justify-end">
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="sm"
					class="h-6 w-6 px-0"
					title="Script Lab help and starter templates"
					aria-label="Script Lab help"
					{@attach help({
						title: 'Starters and API reference',
						text: 'Load a starter script, or look up the most used parts of the scripting API.',
						doc: 'script-lab',
					})}
				>
					<BookOpenText size={12} />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="w-80 p-0">
			<DropdownMenu.Item onclick={onLoadMutationTemplate}>
				<FlaskConical size={12} />
				Load Mutation Starter
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={onLoadAnalysisTemplate}>
				<FileCode2 size={12} />
				Load Analysis Starter
			</DropdownMenu.Item>
			<DropdownMenu.Item onclick={onLoadFullApiDemoTemplate}>
				<Layers size={12} />
				Load Full API Demo
			</DropdownMenu.Item>
			<DropdownMenu.Separator />
			<div class="px-3 py-2 text-[11px] text-muted-foreground">
				<div class="font-medium text-foreground">PluginContext</div>
				<div class="mt-1 space-y-1">
					{#each contextApi as line (line)}
						<div>{line}</div>
					{/each}
				</div>

				<div class="mt-3 font-medium text-foreground">foldnano_mini patterns</div>
				<div class="mt-1 space-y-1">
					{#each miniPatterns as line (line)}
						<div>{line}</div>
					{/each}
				</div>

				<div class="mt-3 font-medium text-foreground">Sandbox</div>
				<div class="mt-1 space-y-1">
					<div>
						Scripts run in the same sandbox as plugins: no internet, no access to your GitHub
						account or your other designs.
					</div>
					<div>
						Packages that ship with Pyodide, such as numpy, load automatically on the first run that
						imports them.
					</div>
					<div>
						A script sees the open design and proposes changes; nothing changes until you click
						Apply, and Apply is one undo step. Only run code you understand, especially code copied
						from others.
					</div>
				</div>
			</div>
		</DropdownMenu.Content>
	</DropdownMenu.Root>
</div>
