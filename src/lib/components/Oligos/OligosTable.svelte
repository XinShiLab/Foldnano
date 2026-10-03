<script lang="ts">
	import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/svelte';
	import type { OligoReportColumn, OligoReportRow } from '$lib/model/io/oligoReport';

	interface Props {
		rows: OligoReportRow[];
		changedColumnsByOligoKey?: Record<string, OligoReportColumn[]>;
		emptyMessage?: string;
	}

	let { rows, changedColumnsByOligoKey = {}, emptyMessage = 'No oligos found.' }: Props = $props();

	const PREVIEW_LENGTH = 100;

	type SortDirection = 'asc' | 'desc';

	interface ColumnDef {
		key: OligoReportColumn;
		label: string;
		align?: 'left' | 'right';
	}

	const columns: ColumnDef[] = [
		{ key: 'oligoKey', label: 'OligoKey' },
		{ key: 'start', label: 'Start' },
		{ key: 'end', label: 'End' },
		{ key: 'sequence', label: 'Sequence' },
		{ key: 'length', label: 'Length', align: 'right' },
		{ key: 'color', label: 'Color' },
		{ key: 'mod5Prime', label: 'Mod5Prime' },
		{ key: 'mod3Prime', label: 'Mod3Prime' },
		{ key: 'positions', label: 'Positions' },
	];

	let sortColumn = $state<OligoReportColumn>('oligoKey');
	let sortDirection = $state<SortDirection>('asc');
	let expanded = $state<Record<string, boolean>>({});

	const sortedRows = $derived.by(() => {
		const copy = [...rows];
		copy.sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			if (sortColumn === 'length') return (a.length - b.length) * dir;
			return (
				String(a[sortColumn]).localeCompare(String(b[sortColumn]), undefined, {
					numeric: true,
					sensitivity: 'base',
				}) * dir
			);
		});
		return copy;
	});

	function toggleSort(column: OligoReportColumn): void {
		if (sortColumn === column) {
			sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
			return;
		}
		sortColumn = column;
		sortDirection = 'asc';
	}

	function expandKey(row: OligoReportRow, column: OligoReportColumn): string {
		return `${row.oligoKey}:${column}`;
	}

	function toggleExpand(row: OligoReportRow, column: OligoReportColumn): void {
		const key = expandKey(row, column);
		expanded[key] = !expanded[key];
	}

	function isExpanded(row: OligoReportRow, column: OligoReportColumn): boolean {
		return expanded[expandKey(row, column)] ?? false;
	}

	function textColorFor(color: string): string {
		const match = /^#?([0-9a-f]{6})$/i.exec(color.trim());
		if (!match) return color;
		const hex = match[1];
		const r = Number.parseInt(hex.slice(0, 2), 16);
		const g = Number.parseInt(hex.slice(2, 4), 16);
		const b = Number.parseInt(hex.slice(4, 6), 16);
		const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
		return luminance > 0.72 ? '#111827' : `#${hex}`;
	}

	function cellText(row: OligoReportRow, column: OligoReportColumn): string {
		if (column === 'length') return String(row.length);
		return String(row[column]);
	}

	function isChanged(row: OligoReportRow, column: OligoReportColumn): boolean {
		return changedColumnsByOligoKey[row.oligoKey]?.includes(column) ?? false;
	}
</script>

<div class="overflow-hidden border border-border bg-background">
	<div class="overflow-auto">
		<table class="w-full min-w-[980px] border-collapse text-left text-sm">
			<thead class="sticky top-0 z-10 bg-muted text-xs text-muted-foreground uppercase">
				<tr>
					{#each columns as column (column.key)}
						<th class="border-b border-border px-3 py-2 font-medium">
							<button
								class="flex w-full items-center gap-1 {column.align === 'right'
									? 'justify-end'
									: 'justify-start'}"
								onclick={() => toggleSort(column.key)}
								aria-label={`Sort by ${column.label}`}
							>
								<span>{column.label}</span>
								{#if sortColumn === column.key}
									{#if sortDirection === 'asc'}
										<ArrowUp class="size-3" />
									{:else}
										<ArrowDown class="size-3" />
									{/if}
								{:else}
									<ArrowUpDown class="size-3 opacity-40" />
								{/if}
							</button>
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#if sortedRows.length === 0}
					<tr>
						<td colspan={columns.length} class="px-3 py-10 text-center text-muted-foreground">
							{emptyMessage}
						</td>
					</tr>
				{:else}
					{#each sortedRows as row (row.fullOligoId)}
						<tr
							class="border-b border-border/70 hover:bg-muted/40"
							style:color={textColorFor(row.color)}
						>
							{#each columns as column (column.key)}
								<td
									class="max-w-[24rem] px-3 py-2 align-top {column.align === 'right'
										? 'text-right tabular-nums'
										: ''} {isChanged(row, column.key) ? 'bg-amber-100 text-amber-950' : ''}"
								>
									{#if column.key === 'color'}
										<span class="inline-flex items-center gap-2">
											<span
												class="inline-block size-3 shrink-0 border border-border"
												style:background={row.color}
											></span>
											<span class="font-mono">{row.color}</span>
										</span>
									{:else if column.key === 'sequence' || column.key === 'positions'}
										{@const text = cellText(row, column.key)}
										{@const needsTruncation = text.length > PREVIEW_LENGTH}
										{@const exp = isExpanded(row, column.key)}
										<span class="font-mono break-all"
											>{needsTruncation && !exp ? text.slice(0, PREVIEW_LENGTH) : text}</span
										>{#if needsTruncation}
											<button
												class="ml-1 shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
												onclick={() => toggleExpand(row, column.key)}
												>{exp ? 'show less' : `…+${text.length - PREVIEW_LENGTH}`}</button
											>
										{/if}
									{:else if column.key === 'oligoKey'}
										<span class="font-mono">{row.oligoKey}</span>
									{:else}
										{cellText(row, column.key)}
									{/if}
								</td>
							{/each}
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>
