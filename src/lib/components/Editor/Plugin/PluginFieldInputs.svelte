<script lang="ts">
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import type { PluginFieldDef } from '$lib/plugin/types';

	let {
		fields,
		values,
	}: {
		fields: PluginFieldDef[];
		values: Record<string, unknown>;
	} = $props();

	function optionValue(opt: string | { value: string; label: string }): string {
		return typeof opt === 'string' ? opt : opt.value;
	}

	function optionLabel(opt: string | { value: string; label: string }): string {
		return typeof opt === 'string' ? opt : opt.label;
	}
</script>

<div class="flex flex-col gap-4">
	{#each fields as field (field.id)}
		<div class="flex flex-col gap-1.5">
			{#if field.type === 'boolean'}
				<div class="flex items-center gap-2">
					<Switch
						id="field-{field.id}"
						checked={Boolean(values[field.id])}
						onCheckedChange={(v) => (values[field.id] = v)}
					/>
					<Label for="field-{field.id}">
						{field.label}{field.required ? ' *' : ''}
					</Label>
				</div>
			{:else}
				<Label for="field-{field.id}">
					{field.label}{field.required ? ' *' : ''}
				</Label>

				{#if field.type === 'string'}
					<Input id="field-{field.id}" type="text" bind:value={values[field.id] as string} />
				{:else if field.type === 'number'}
					<Input
						id="field-{field.id}"
						type="number"
						min={field.min}
						max={field.max}
						step={field.step ?? 'any'}
						bind:value={values[field.id] as number}
					/>
				{:else if field.type === 'select'}
					<Select.Root
						type="single"
						bind:value={() => String(values[field.id] ?? ''), (v) => (values[field.id] = v)}
					>
						<Select.Trigger id="field-{field.id}" class="w-full">
							{String(values[field.id] ?? 'Select…')}
						</Select.Trigger>
						<Select.Content>
							{#each field.options ?? [] as opt (optionValue(opt))}
								<Select.Item value={optionValue(opt)}>
									{optionLabel(opt)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			{/if}

			{#if field.description}
				<p class="text-[11px] text-muted-foreground">{field.description}</p>
			{/if}
		</div>
	{/each}
</div>
