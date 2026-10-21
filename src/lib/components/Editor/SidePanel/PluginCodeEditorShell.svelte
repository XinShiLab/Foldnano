<script lang="ts">
	import { PYODIDE_PYTHON_VERSION, PYODIDE_VERSION } from '$lib/plugin/worker/pyodideConfig';
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { Download, Ellipsis, Eraser, FileCode2, Play, RotateCcw, Square } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { PrismEditor } from 'prism-code-editor';
	import { basicEditor } from 'prism-code-editor/setups';
	import type { EditorTheme } from 'prism-code-editor/themes';
	import 'prism-code-editor/prism/languages/python';
	import 'prism-code-editor/languages/python';

	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Resizable from '$lib/components/ui/resizable/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	type ExecutionState = 'ready' | 'running' | 'stopped';

	export interface EditorToolbarAction {
		id: string;
		label: string;
		onClick?: () => void | Promise<void>;
		icon?: Component;
		disabled?: boolean;
		variant?: 'default' | 'outline' | 'ghost';
		tooltip?: string;
	}

	interface Props {
		title?: string;
		description?: string;
		titleTail?: Snippet;
		filename?: string;
		code?: string;
		executionState?: ExecutionState;
		runDisabled?: boolean;
		stopDisabled?: boolean;
		theme?: EditorTheme;
		showDownloadButton?: boolean;
		showPrototypeBadge?: boolean;
		toolbarTail?: Snippet;
		toolbarActions?: EditorToolbarAction[];
		output?: Snippet;
		onRun?: (code: string) => void | Promise<void>;
		onStop?: () => void | Promise<void>;
		onClearScript?: () => void | Promise<void>;
		onResetPlugin?: () => void | Promise<void>;
		onRestoreDefaultScript?: () => void | Promise<void>;
		onDownload?: (code: string) => void | Promise<void>;
		onCodeChange?: (code: string) => void;
	}

	let {
		title = 'Code Editor',
		description = 'Reusable host-rendered code-editor surface for Python plugins.',
		titleTail,
		filename = 'script.py',
		code = '',
		executionState = 'ready',
		runDisabled = false,
		stopDisabled = false,
		theme = 'github-dark-dimmed',
		showDownloadButton = true,
		showPrototypeBadge = false,
		toolbarTail,
		toolbarActions = [],
		output,
		onRun,
		onStop,
		onClearScript,
		onResetPlugin,
		onRestoreDefaultScript,
		onDownload,
		onCodeChange,
	}: Props = $props();

	let script = $state(code);
	let editorFontSize = $state(12);
	let editorHost: HTMLDivElement | null = null;
	let editor: PrismEditor<{ theme: EditorTheme }> | null = null;
	let toolbarScrollEl: HTMLDivElement | null = null;

	const MIN_EDITOR_FONT_SIZE = 10;
	const MAX_EDITOR_FONT_SIZE = 16;

	function syncEditorValue(next: string): void {
		script = next;
		if (editor && editor.value !== next) {
			editor.setOptions({ value: next });
		}
	}

	$effect(() => {
		if (code !== script) {
			syncEditorValue(code);
		}
	});

	function setScript(next: string): void {
		script = next;
		onCodeChange?.(next);
	}

	function statusLabel(): string {
		switch (executionState) {
			case 'running':
				return 'Running';
			case 'stopped':
				return 'Stopped';
			default:
				return 'Ready';
		}
	}

	function statusBadgeClass(): string {
		switch (executionState) {
			case 'running':
				return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
			case 'stopped':
				return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300';
			default:
				return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300';
		}
	}

	function adjustEditorFontSize(delta: number): void {
		editorFontSize = Math.max(
			MIN_EDITOR_FONT_SIZE,
			Math.min(MAX_EDITOR_FONT_SIZE, editorFontSize + delta)
		);
	}

	function handleToolbarWheel(event: WheelEvent): void {
		if (!toolbarScrollEl) return;
		if (toolbarScrollEl.scrollWidth <= toolbarScrollEl.clientWidth) return;
		if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

		event.preventDefault();
		toolbarScrollEl.scrollLeft += event.deltaY;
	}

	onMount(() => {
		if (!editorHost) return;

		editor = basicEditor(editorHost, {
			language: 'python',
			theme,
			lineNumbers: true,
			tabSize: 4,
			wordWrap: false,
			value: script,
			onUpdate: (value) => {
				setScript(value);
			},
		});

		// Prevent editor keystrokes from falling through to the app-wide editor shortcuts
		// registered on <body>, such as Backspace/Delete removing design selections.
		const stopEditorShortcutPropagation = (event: KeyboardEvent) => {
			event.stopPropagation();
		};
		editor.textarea.addEventListener('keydown', stopEditorShortcutPropagation);

		// Writing-assistant extensions ignore `spellcheck=false`; these are their own opt-outs.
		for (const [name, value] of [
			['data-gramm', 'false'],
			['data-gramm_editor', 'false'],
			['data-enable-grammarly', 'false'],
			['data-lt-active', 'false'],
			['autocorrect', 'off'],
			['translate', 'no'],
		]) {
			editor.textarea.setAttribute(name, value);
		}

		return () => {
			editor?.textarea.removeEventListener('keydown', stopEditorShortcutPropagation);
			editor?.remove();
			editor = null;
		};
	});

	const PYTHON_MINOR = PYODIDE_PYTHON_VERSION.split('.').slice(0, 2).join('.');
</script>

<div class="flex h-full min-h-0 flex-col overflow-hidden text-sm">
	<div class="border-b border-border px-2.5 py-2">
		<div class="flex items-center justify-between gap-2">
			<div class="min-w-0">
				<div class="flex items-center gap-1.5">
					<h2 class="truncate text-sm font-semibold text-foreground">{title}</h2>
					<Badge variant="outline" class={`h-4 px-1.5 text-[10px] ${statusBadgeClass()}`}
						>{statusLabel()}</Badge
					>
					{#if titleTail}
						{@render titleTail()}
					{/if}
				</div>
				<!-- One truncated line keeps the header compact; hover shows the full description. -->
				<Tooltip.Provider>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<p
									{...props}
									class="cursor-default truncate text-[11px] whitespace-nowrap text-muted-foreground"
								>
									{description}
								</p>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="bottom" align="start">
							<p class="max-w-72 text-[11px] leading-4">{description}</p>
						</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<Badge variant="outline" class="h-4 gap-1 border-border/80 bg-muted/60 px-1.5 text-[10px]">
					<FileCode2 size={10} />
					Python
				</Badge>
				{#if showPrototypeBadge}
					<Badge variant="outline" class="h-4 border-border/80 bg-muted/60 px-1.5 text-[10px]">
						Prototype
					</Badge>
				{/if}
			</div>
		</div>
	</div>

	<div
		bind:this={toolbarScrollEl}
		class="scrollbar-none overflow-x-auto overflow-y-hidden border-b border-border [&::-webkit-scrollbar]:hidden"
		onwheel={handleToolbarWheel}
	>
		<div class="flex w-max min-w-full items-center gap-1.5 px-2.5 py-1.5 whitespace-nowrap">
			<Button
				size="xs"
				class="h-6 gap-1 px-1.5 text-[11px]"
				onclick={() => onRun?.(script)}
				disabled={runDisabled}
			>
				<Play size={11} />
				Run
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				onclick={() => onStop?.()}
				disabled={stopDisabled}
			>
				<Square size={11} />
				Stop
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				onclick={() => onClearScript?.()}
				title="Clear the editor to a bare run(ctx) skeleton"
			>
				<Eraser size={11} />
				Clear
			</Button>
			<Button
				size="xs"
				variant="outline"
				class="h-6 gap-1 px-1.5 text-[11px]"
				onclick={() => onResetPlugin?.()}
				title="Clear run output and reset to ready state"
			>
				<RotateCcw size={11} />
				Reset
			</Button>
			<div class="ml-auto flex items-center gap-1 pl-1.5">
				{#if toolbarTail}
					{@render toolbarTail()}
				{/if}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								size="xs"
								variant="outline"
								class="h-6 w-6 px-0"
								title="More actions"
								aria-label="More actions"
							>
								<Ellipsis size={12} />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-52">
						<div class="flex items-center justify-between gap-2 px-2 py-1.5 text-xs">
							<span class="text-muted-foreground">Font size</span>
							<!-- Plain buttons, not menu items, so stepping the size keeps the menu open. -->
							<div class="flex items-center gap-1">
								<Button
									size="xs"
									variant="outline"
									class="h-6 w-6 px-0 text-[10px]"
									aria-label="Decrease font size"
									onclick={() => adjustEditorFontSize(-1)}
									disabled={editorFontSize <= MIN_EDITOR_FONT_SIZE}
								>
									A-
								</Button>
								<span class="w-9 text-center text-[11px] tabular-nums">{editorFontSize}px</span>
								<Button
									size="xs"
									variant="outline"
									class="h-6 w-6 px-0 text-[10px]"
									aria-label="Increase font size"
									onclick={() => adjustEditorFontSize(1)}
									disabled={editorFontSize >= MAX_EDITOR_FONT_SIZE}
								>
									A+
								</Button>
							</div>
						</div>
						<DropdownMenu.Separator />
						{#if onRestoreDefaultScript}
							<DropdownMenu.Item onclick={() => onRestoreDefaultScript?.()}>
								<RotateCcw size={12} />
								Restore default script
							</DropdownMenu.Item>
						{/if}
						{#if showDownloadButton}
							<DropdownMenu.Item onclick={() => onDownload?.(script)}>
								<Download size={12} />
								Download {filename}
							</DropdownMenu.Item>
						{/if}
						{#if toolbarActions.length > 0}
							<DropdownMenu.Separator />
							{#each toolbarActions as action (action.id)}
								{@const ActionIcon = action.icon}
								<DropdownMenu.Item
									class="items-start"
									onclick={() => action.onClick?.()}
									disabled={action.disabled}
								>
									{#if ActionIcon}
										<ActionIcon size={12} class="mt-0.5" />
									{/if}
									<div class="min-w-0">
										<div>{action.label}</div>
										{#if action.tooltip}
											<div class="text-[10px] leading-4 whitespace-normal text-muted-foreground">
												{action.tooltip}
											</div>
										{/if}
									</div>
								</DropdownMenu.Item>
							{/each}
						{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	</div>

	<Resizable.PaneGroup direction="vertical" class="min-h-0 flex-1">
		<Resizable.Pane defaultSize={58} minSize={34}>
			<div class="flex h-full min-h-0 flex-col overflow-hidden">
				<div class="flex items-center justify-between border-b border-border px-2.5 py-1.5">
					<div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
						<Badge
							variant="outline"
							class="h-4 border-border/80 bg-muted/50 px-1.5 font-mono text-[10px]"
						>
							{filename}
						</Badge>
						<span class="truncate text-[11px] text-muted-foreground">Plugin script</span>
					</div>
					<div
						class="shrink-0 text-[10px] text-muted-foreground"
						title="Pyodide {PYODIDE_VERSION} · Python {PYODIDE_PYTHON_VERSION}"
					>
						Py {PYTHON_MINOR}
					</div>
				</div>
				<div class="min-h-0 flex-1 overflow-hidden bg-[#0d1117]">
					<div
						bind:this={editorHost}
						class="h-full w-full"
						style={`display:grid;height:100%;font-family:var(--font-mono, 'JetBrains Mono Variable', monospace);font-size:${editorFontSize}px;`}
					></div>
				</div>
			</div>
		</Resizable.Pane>

		<Resizable.Handle withHandle />

		<Resizable.Pane defaultSize={42} minSize={24}>
			<div class="h-full min-h-0 overflow-hidden">
				{@render output?.()}
			</div>
		</Resizable.Pane>
	</Resizable.PaneGroup>
</div>
