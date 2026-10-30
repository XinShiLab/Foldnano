<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import { APP_COMMIT, APP_VERSION } from '$lib/appInfo';
	import { guideHref } from '$lib/components/help/help';
	import { PYODIDE_PYTHON_VERSION, PYODIDE_VERSION } from '$lib/plugin/worker/pyodideConfig';
	import {
		RECENT_WINDOW_MONTHS,
		publishedWhatsNew,
		splitByRecency,
		unreadEntryCount,
		type WhatsNewEntry,
	} from '$lib/whats-new/entries';

	let { open = $bindable() }: { open: boolean } = $props();

	type AboutTab = 'whats-new' | 'author' | 'license';
	const REPO_URL = 'https://github.com/XinShiLab/foldnano';

	let activeTab = $state<AboutTab>('whats-new');

	const MONTH_FORMAT = new Intl.DateTimeFormat('en', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});

	const entries = publishedWhatsNew();
	// Fixed for this page load: opening the dialog marks entries seen, but they stay highlighted
	// until the next load so the user can still see what was new.
	const unread = new Set(entries.slice(0, unreadEntryCount(page.data.whatsNewSeen ?? null)));
	const latestDate = entries[0]?.date;
	const { recent, earlier } = splitByRecency(entries);
	const recentByMonth = groupByMonth(recent);
	const earlierByMonth = groupByMonth(earlier);
	let showEarlier = $state(false);

	function groupByMonth(list: WhatsNewEntry[]): { month: string; entries: WhatsNewEntry[] }[] {
		const groups: { month: string; entries: WhatsNewEntry[] }[] = [];
		for (const entry of list) {
			const month = MONTH_FORMAT.format(new Date(`${entry.date}T00:00:00Z`));
			const last = groups.at(-1);
			if (last?.month === month) last.entries.push(entry);
			else groups.push({ month, entries: [entry] });
		}
		return groups;
	}
</script>

{#snippet monthGroups(groups: { month: string; entries: WhatsNewEntry[] }[])}
	{#each groups as group (group.month)}
		<div class="space-y-2">
			<h4 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{group.month}
			</h4>
			<ul class="space-y-2">
				{#each group.entries as entry (entry.date + entry.area + entry.text)}
					<li class={unread.has(entry) ? 'text-foreground' : 'text-muted-foreground'}>
						{#if unread.has(entry)}
							<span
								class="mr-1.5 inline-block size-1.5 rounded-full bg-sky-400 align-middle"
								aria-hidden="true"
							></span><span class="sr-only">New: </span>
						{/if}
						<span class="font-medium text-foreground">{entry.area}:</span>
						{entry.text}
						{#if entry.link}
							<!-- eslint-disable svelte/no-navigation-without-resolve -- guideHref() uses resolve() -->
							<a
								href={guideHref(entry.link)}
								target="_blank"
								rel="noopener"
								class="text-primary underline-offset-2 hover:underline">Learn more →</a
							>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
{/snippet}

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl">
		<Dialog.Header class="border-b border-border px-4 py-3">
			<div class="flex flex-wrap items-baseline gap-x-2">
				<Dialog.Title class="text-xl font-bold">Foldnano</Dialog.Title>
				<span class="text-xs font-medium text-muted-foreground" title="Build commit">
					v{APP_VERSION} · {APP_COMMIT}
				</span>
				<span
					class="text-xs text-muted-foreground"
					title="Python runtime used by plugins and Script Lab"
				>
					Pyodide {PYODIDE_VERSION} · Python {PYODIDE_PYTHON_VERSION}
				</span>
			</div>
			<Dialog.Description>Web-based DNA nanostructure design tool</Dialog.Description>
		</Dialog.Header>

		<Tabs.Root bind:value={activeTab} class="flex min-h-0 flex-1 flex-col overflow-hidden">
			<Tabs.List variant="line" class="w-full border-b border-border px-4">
				<Tabs.Trigger value="whats-new" class="flex-1 text-xs">What's New</Tabs.Trigger>
				<Tabs.Trigger value="author" class="flex-1 text-xs">Project</Tabs.Trigger>
				<Tabs.Trigger value="license" class="flex-1 text-xs">License</Tabs.Trigger>
			</Tabs.List>

			<div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-sm text-foreground">
				<Tabs.Content value="whats-new" class="mt-0 p-0">
					<section class="space-y-4">
						<div>
							<h3 class="font-semibold">Recent updates</h3>
							{#if latestDate}
								<p class="mt-1 text-xs text-muted-foreground">
									Last updated {latestDate}. Showing the last {RECENT_WINDOW_MONTHS} months.
								</p>
							{/if}
						</div>
						{@render monthGroups(recentByMonth)}
						{#if earlier.length > 0}
							{#if showEarlier}
								{@render monthGroups(earlierByMonth)}
							{:else}
								<Button variant="outline" size="sm" onclick={() => (showEarlier = true)}>
									Show earlier updates ({earlier.length})
								</Button>
							{/if}
						{/if}
					</section>
				</Tabs.Content>

				<Tabs.Content value="author" class="mt-0 p-0">
					<section class="space-y-2">
						<h3 class="font-semibold">Project</h3>
						<p>
							Foldnano is maintained by Prof. Xin Shi at the Department of Chemistry, KU Leuven,
							with contributions from the
							<a href="{REPO_URL}/graphs/contributors" target="_blank" class="underline"
								>Foldnano contributors</a
							>.
						</p>
						<ul class="space-y-1">
							<li>
								<a href={REPO_URL} target="_blank" class="underline">Source code on GitHub</a>
							</li>
							<li>
								<a href="{REPO_URL}/issues" target="_blank" class="underline">Report a bug</a>
							</li>
							<li>
								<a href="{REPO_URL}/blob/main/CITATION.cff" target="_blank" class="underline"
									>How to cite Foldnano</a
								>
							</li>
						</ul>
						<p class="text-muted-foreground">
							Your designs stay in this browser unless you sync them to GitHub.
							<a href={resolve('/privacy')} target="_blank" class="underline">Privacy details</a>
						</p>
					</section>
				</Tabs.Content>

				<Tabs.Content value="license" class="mt-0 p-0">
					<div class="space-y-4">
						<section>
							<h3 class="mb-1 font-semibold">License</h3>
							<p>
								Foldnano is open-source software released under the MIT License. Copyright ©
								2025–2026 Xin Shi and Foldnano contributors.
							</p>
						</section>

						<section>
							<h3 class="mb-2 font-semibold">Third-party licenses</h3>
							<ul class="space-y-1 text-muted-foreground">
								<li>
									<span class="font-medium text-foreground">cadnano</span> — Original DNA origami design
									tool. Foldnano reads and writes the cadnano JSON design format and follows many of cadnano's
									design conventions. BSD 3-Clause License. Copyright © Wyss Institute.
								</li>
								<li>
									<span class="font-medium text-foreground">SvelteKit / Svelte</span> — MIT License. Copyright
									© Svelte contributors.
								</li>
								<li>
									<span class="font-medium text-foreground">Konva.js</span> — MIT License. Copyright ©
									2012 Anton Lavrenov.
								</li>
								<li>
									<span class="font-medium text-foreground">Three.js</span> — MIT License. Copyright ©
									2010–2024 three.js authors.
								</li>
								<li>
									<span class="font-medium text-foreground">Tailwind CSS</span> — MIT License. Copyright
									© Tailwind Labs Inc.
								</li>
								<li>
									<span class="font-medium text-foreground">bits-ui</span> — MIT License. Copyright ©
									Huntabyte.
								</li>
								<li>
									<span class="font-medium text-foreground">shadcn-svelte</span> — UI components, a Svelte
									port of shadcn/ui. MIT License. Copyright © 2023 Hunter Johnston, CokaKoala and shadcn.
								</li>
								<li>
									<span class="font-medium text-foreground">shadcn-svelte-extras</span> — File drop zone
									component. MIT License. Copyright © 2024 Aidan Bleser.
								</li>
								<li>
									<span class="font-medium text-foreground">Lucide</span> — ISC License. Copyright © Lucide
									contributors.
								</li>
								<li>
									<span class="font-medium text-foreground">Dexie.js</span> — Apache License 2.0. Copyright
									© David Fahlander and Dexie contributors.
								</li>
								<li>
									<span class="font-medium text-foreground">Pyodide</span> — Mozilla Public License 2.0.
									Copyright © Pyodide contributors.
								</li>
							</ul>
							<p class="mt-2">
								<a
									href="/third-party-licenses.txt"
									target="_blank"
									rel="external noopener"
									class="underline">Full list of third-party licenses</a
								>
								for every package bundled into this build.
							</p>
						</section>

						<section>
							<p>Each plugin is an independent project with its own licensing terms.</p>
						</section>
					</div>
				</Tabs.Content>
			</div>
		</Tabs.Root>

		<Dialog.Footer class="border-t border-border px-4 py-3">
			<Button variant="outline" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
