<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Blocks from '@lucide/svelte/icons/blocks';
	import Bot from '@lucide/svelte/icons/bot';
	import Code2 from '@lucide/svelte/icons/code-2';
	import Copy from '@lucide/svelte/icons/copy';
	import FileImage from '@lucide/svelte/icons/file-image';
	import FileJson from '@lucide/svelte/icons/file-json';
	import FileOutput from '@lucide/svelte/icons/file-output';
	import GitBranch from '@lucide/svelte/icons/git-branch';
	import GitFork from '@lucide/svelte/icons/git-fork';
	import Grid3x3 from '@lucide/svelte/icons/grid-3x3';
	import HardDrive from '@lucide/svelte/icons/hard-drive';
	import Puzzle from '@lucide/svelte/icons/puzzle';
	import Rotate3d from '@lucide/svelte/icons/rotate-3d';
	import Shapes from '@lucide/svelte/icons/shapes';
	import Waypoints from '@lucide/svelte/icons/waypoints';

	import AlphaAccessGate from '$lib/components/AlphaAccessGate.svelte';
	import EditorShowcase from '$lib/components/landing/EditorShowcase.svelte';
	import Hero3D from '$lib/components/landing/Hero3D.svelte';
	import fn from '$lib/assets/fn.svg';
	import heroIllustration from '$lib/assets/landing/hero-illustration.svg';

	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Featured design rendered in the hero (static asset in /static). Swap to change the hero structure.
	const HERO_DESIGN_URL = '/hero-design.json';

	// Public repo URL does not exist yet; swap to the public GitHub URL at release.
	const GITHUB_URL = 'https://github.com/XinShiLab/foldnano';

	const PLUGIN_DOCS = resolve('/docs/plugin-development/plugin-quickstart');
	const PLUGINS_GUIDE = resolve('/docs/guide/plugins-for-users');
	const REPEAT_DOCS = resolve('/docs/guide/duplicates-repeat-groups');
	const WIREFRAME_DOCS = resolve('/docs/guide/wireframe');
	const AGENT_RUNS_DOCS = resolve('/docs/plugin-development/agent-runs');

	// The editor's ?url= loader needs an absolute http(s) URL.
	const exampleHref = $derived(
		`${resolve('/editor')}?url=${encodeURIComponent(new URL(HERO_DESIGN_URL, page.url).href)}`
	);

	// Read-only illustrative snippet; not executed, no highlighter dependency.
	const codeSample = `part = load_part(ctx.get_part_as_foldnano_json(), ctx.active_region_id)
region = part.get_region(ctx.active_region_id)
region.increase_length_by(region.step)
ctx.set_result_mutation_log(part.mutation_log)`;

	// Minimal Python highlighting for the static snippet; avoids shipping a highlighter.
	type TokenKind = 'kw' | 'fn' | 'attr' | 'str' | 'num' | 'com' | 'punct' | 'plain';
	interface CodeToken {
		text: string;
		kind: TokenKind;
	}
	const PY_KEYWORDS = new Set(
		'and as class def elif else False for from if import in is lambda None not or pass return True while with yield'.split(
			' '
		)
	);
	const PY_TOKEN_RE =
		/(#.*)|('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_]\w*)|(\s+)|(.)/g;

	function tokenizePython(src: string): CodeToken[] {
		const tokens: CodeToken[] = [];
		for (const m of src.matchAll(PY_TOKEN_RE)) {
			const [text, com, str, num, ident, space] = m;
			let kind: TokenKind = 'punct';
			if (com) kind = 'com';
			else if (str) kind = 'str';
			else if (num) kind = 'num';
			else if (space) kind = 'plain';
			else if (ident) {
				const end = m.index + text.length;
				if (PY_KEYWORDS.has(text)) kind = 'kw';
				else if (src[end] === '(') kind = 'fn';
				else if (src[m.index - 1] === '.') kind = 'attr';
				else kind = 'plain';
			}
			tokens.push({ text, kind });
		}
		return tokens;
	}

	const codeTokens = tokenizePython(codeSample);

	type Accent = 'green' | 'blue';
	interface FeatureCard {
		kind: 'text' | 'code' | 'build';
		span: string; // md/lg column span
		icon?: typeof HardDrive;
		pre?: string;
		hi: string;
		post?: string;
		accent: Accent;
		body: string;
		href?: string;
		chips?: string[];
	}

	const features: FeatureCard[] = [
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: HardDrive,
			pre: 'No installation, no registration.',
			hi: ' Local-first.',
			accent: 'green',
			body: 'Runs entirely in your browser; designs live in browser storage and never leave your machine unless you push them.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Grid3x3,
			hi: 'Mix lattices',
			post: ' and unlatticed regions',
			accent: 'blue',
			body: 'Square, honeycomb, and freeform regions coexist in a single scaffold.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: FileJson,
			hi: 'Drop-in compatible',
			post: ' with cadnano',
			accent: 'green',
			body: 'Import and export classic cadnano .json designs without conversion.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Copy,
			hi: 'Repeat groups',
			post: ' with linked mirror copies',
			accent: 'blue',
			body: 'Copy a unit once; every mirror follows each edit you make to the original.',
			href: REPEAT_DOCS,
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Shapes,
			hi: 'Wireframe designs',
			post: ' from a mesh',
			accent: 'green',
			body: 'Start a wireframe region from a mesh and route it with a plugin such as pyDAEDALUS.',
			href: WIREFRAME_DOCS,
			chips: ['Experimental'],
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Rotate3d,
			pre: 'Built-in',
			hi: ' 3D structure view',
			accent: 'blue',
			body: 'Inspect your design in 3D as you edit, and overlay PDB protein structures to check the fit.',
		},
		{
			kind: 'code',
			span: 'md:col-span-2 lg:col-span-4',
			icon: Code2,
			hi: 'Edit programmatically',
			post: ' with live 3D preview',
			accent: 'green',
			body: 'Script against the live design in Python, right in the browser.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Bot,
			pre: 'Bring your own',
			hi: ' AI agent',
			accent: 'blue',
			body: 'Any coding agent on your machine can edit your open design while you watch, using a hosted model or a fully local one. Your choice of model, your data.',
			href: AGENT_RUNS_DOCS,
			chips: ['Experimental'],
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: GitBranch,
			hi: 'Git(hub)-integrated',
			post: ' version control',
			accent: 'green',
			body: 'Sync designs to GitHub repos; history and collaboration that just work.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Puzzle,
			hi: 'Python-in-browser',
			post: ' plugin system',
			accent: 'blue',
			body: 'Install sandboxed Python plugins from the Plugin Hub. No server required, no setup.',
			href: PLUGINS_GUIDE,
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: Waypoints,
			pre: 'Built-in',
			hi: ' rigid-body simulation',
			accent: 'green',
			body: 'Relax and optimize long bonds without leaving the editor.',
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: FileOutput,
			pre: 'Direct export for',
			hi: ' oxDNA and mrDNA',
			accent: 'blue',
			body: 'Generate simulation-ready files in one click, then replay oxDNA trajectories on your own strands.',
			chips: ['oxDNA', 'mrDNA'],
		},
		{
			kind: 'text',
			span: 'lg:col-span-2',
			icon: FileImage,
			hi: 'Publication-ready',
			post: ' design maps',
			accent: 'green',
			body: 'Clean, vector design diagrams straight from the editor.',
		},
		{
			kind: 'build',
			span: 'md:col-span-2 lg:col-span-2',
			icon: Blocks,
			pre: 'Build on',
			hi: ' Foldnano',
			accent: 'blue',
			body: 'An open platform: write Python plugins that run in the browser and share them with the community.',
		},
	];

	function accentClass(a: Accent): string {
		return a === 'green' ? 'text-[var(--landing-green)]' : 'text-[var(--landing-blue)]';
	}

	let scrolled = $state(false);
	$effect(() => {
		const onScroll = () => (scrolled = window.scrollY > 4);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	});

	// Pause the hero 3D (spin + drag + render loop) while the showcase and feature
	// cards overlay it; resume once the user scrolls back up to the hero.
	let overlayStartEl = $state<HTMLElement>();
	let heroSuspended = $state(false);
	$effect(() => {
		const el = overlayStartEl;
		if (!el) return;
		const io = new IntersectionObserver((entries) => {
			const e = entries[0];
			heroSuspended = e.isIntersecting || e.boundingClientRect.top < 0;
		});
		io.observe(el);
		return () => io.disconnect();
	});
</script>

<svelte:head>
	<title>Foldnano: DNA nanostructure design in your browser</title>
	<meta
		name="description"
		content="Free, open-source, local-first DNA origami design tool. Mix lattices, run Python plugins, and export to oxDNA/mrDNA. No installation, no account."
	/>
	<meta property="og:title" content="Foldnano: DNA nanostructure design in your browser" />
	<meta
		property="og:description"
		content="Free, open-source, local-first DNA origami design tool. Mix lattices, run Python plugins, and export to oxDNA/mrDNA. No installation, no account."
	/>
	<meta property="og:type" content="website" />
</svelte:head>

<AlphaAccessGate
	granted={data.alphaAccessGranted}
	title="Beta Testing"
	description="Foldnano is in beta testing. Enter your access code to continue."
>
	<div class="landing flex min-h-screen flex-col">
		<!-- Header -->
		<header
			class="sticky top-0 z-50 transition-colors {scrolled
				? 'border-b border-[var(--landing-border)] bg-[var(--landing-bg)]/80 backdrop-blur'
				: 'border-b border-transparent'}"
		>
			<div class="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
				<a
					href={resolve('/')}
					class="flex shrink-0 items-center gap-2 text-xl font-extrabold text-[var(--landing-ink)]"
				>
					<img src={fn} alt="" class="size-8" />
					Foldnano
				</a>
				<nav class="ml-auto flex items-center gap-0.5 text-sm sm:gap-1">
					<a
						href={resolve('/docs')}
						class="rounded-[10px] px-3 py-1.5 text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-ink)]"
					>
						Docs
					</a>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener"
						class="hidden items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-ink)] sm:flex"
					>
						<GitFork size={15} />GitHub
					</a>
					<a
						href={resolve('/editor')}
						class="ml-1 rounded-full bg-[var(--landing-blue)] px-4 py-1.5 font-semibold whitespace-nowrap text-white transition-opacity hover:opacity-90"
					>
						Open Editor
					</a>
				</nav>
			</div>
		</header>

		<main class="flex-1">
			<!-- Hero + features share one stage: only the 3D render is pinned (md+);
		     everything else (the frosted hero panel first, then the glass feature
		     cards) scrolls up over it. Spin/drag pause once cards overlay the render.
		     On < md everything falls back to a simple stacked flow (render on top). -->
			<div class="relative">
				<!-- Pinned 3D stage -->
				<div class="mx-auto max-w-7xl px-4 md:sticky md:top-14 md:px-6">
					<div class="relative h-72 sm:h-96 md:h-[calc(100vh-3.5rem)]">
						<Hero3D
							illustration={heroIllustration}
							designUrl={HERO_DESIGN_URL}
							alt="Illustration of a DNA origami virtual helix lattice"
							fill
							suspended={heroSuspended}
						/>
					</div>
				</div>

				<!-- Scrolling content layer over the stage; gaps let clicks/drags through -->
				<div class="pointer-events-none relative z-10 md:-mt-[calc(100vh-3.5rem)]">
					<section
						class="relative mx-auto flex max-w-7xl flex-col justify-center px-4 md:h-[calc(100vh-3.5rem)] md:px-6"
					>
						<div
							class="glass-panel pointer-events-auto mt-6 w-full rounded-3xl p-6 text-left sm:p-7 md:mt-0 md:max-w-xl md:p-10"
						>
							<p
								class="font-heading text-[10px] tracking-[0.12em] text-[var(--landing-muted)] uppercase md:text-xs md:tracking-[0.18em]"
							>
								Integrated Design Environment · Open-source
							</p>
							<h1
								class="mt-4 text-3xl leading-[1.05] font-extrabold text-[var(--landing-ink)] sm:text-4xl md:text-5xl"
							>
								The <span class="text-[var(--landing-green)]">IDE</span> for<br />
								<span class="text-[var(--landing-blue)] sm:whitespace-nowrap"
									>DNA Nanostructures</span
								>
							</h1>
							<p class="mt-4 max-w-md text-base text-[var(--landing-muted)] sm:text-lg">
								Design, inspect, and export DNA origami entirely in your browser. Run Python plugins
								and scripts directly to analyze and modify your designs. No installation, no
								account, your data stays on your machine.
							</p>
							<div class="mt-6 flex flex-wrap items-center gap-3">
								<a
									href={resolve('/editor')}
									class="lift rounded-full bg-[var(--landing-blue)] px-7 py-3 text-base font-semibold text-white shadow-sm"
								>
									Open Editor
								</a>
								<a
									href={resolve('/docs')}
									class="rounded-full border border-[var(--landing-border)] bg-[var(--landing-card)] px-7 py-3 text-base font-semibold text-[var(--landing-ink)] transition-colors hover:border-[var(--landing-muted)]"
								>
									Read the Docs
								</a>
							</div>
							<!-- eslint-disable svelte/no-navigation-without-resolve -- exampleHref is built with resolve() -->
							<a
								href={exampleHref}
								class="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[var(--landing-blue)] hover:underline"
							>
								Or open an example design in the editor <ArrowRight size={15} />
							</a>
							<!-- eslint-enable svelte/no-navigation-without-resolve -->
						</div>
						<a
							href="#showcase"
							aria-label="Jump to the editor tour"
							class="scroll-cue pointer-events-auto mx-auto mt-4 w-fit text-[var(--landing-muted)] transition-colors hover:text-[var(--landing-ink)] md:absolute md:inset-x-0 md:bottom-3 md:mt-0"
						>
							<ChevronDown size={24} />
						</a>
					</section>

					<!-- Editor showcase: first panel to scroll over the pinned 3D stage -->
					<section
						id="showcase"
						bind:this={overlayStartEl}
						class="mx-auto max-w-6xl scroll-mt-20 px-4 pt-8 md:px-6 md:pt-14"
					>
						<div class="glass-card pointer-events-auto rounded-3xl p-5 sm:p-8">
							<p
								class="font-heading text-[10px] tracking-[0.12em] text-[var(--landing-muted)] uppercase md:text-xs md:tracking-[0.18em]"
							>
								The editor
							</p>
							<h2 class="mt-2 mb-5 text-2xl font-bold text-[var(--landing-ink)] sm:text-3xl">
								One workspace, from routing to simulation
							</h2>
							<EditorShowcase />
						</div>
					</section>

					<!-- Feature cards: frosted glass, scrolling over the pinned 3D stage -->
					<section
						id="features"
						class="mx-auto max-w-6xl scroll-mt-20 px-4 py-8 md:px-6 md:pt-12 md:pb-16"
					>
						<div class="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6 lg:gap-5">
							{#each features as f (f.hi)}
								{@const Icon = f.icon}
								<svelte:element
									this={f.href ? 'a' : 'div'}
									href={f.href}
									class="glass-card pointer-events-auto {f.href
										? 'lift-card group'
										: ''} {f.span} flex flex-col rounded-2xl p-6"
								>
									<div class="flex items-start gap-2.5">
										{#if Icon}
											<Icon size={20} class="mt-0.5 shrink-0 text-[var(--landing-muted)]" />
										{/if}
										<h2 class="text-base leading-snug font-bold text-[var(--landing-ink)]">
											{f.pre ?? ''}<span class={accentClass(f.accent)}>{f.hi}</span>{f.post ?? ''}
											{#if f.href}
												<ArrowRight
													size={15}
													class="ml-0.5 inline align-[-2px] text-[var(--landing-muted)] transition-transform group-hover:translate-x-0.5"
												/>
											{/if}
										</h2>
									</div>
									<p class="mt-2 text-sm text-[var(--landing-muted)]">{f.body}</p>

									{#if f.chips}
										<div class="mt-3 flex gap-2">
											{#each f.chips as chip (chip)}
												<span
													class="rounded-[8px] border border-[var(--landing-border)] px-2 py-0.5 font-heading text-xs text-[var(--landing-muted)]"
													>{chip}</span
												>
											{/each}
										</div>
									{/if}

									{#if f.kind === 'build'}
										<div class="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
											<a
												href={PLUGIN_DOCS}
												class="inline-flex items-center gap-1 font-semibold text-[var(--landing-blue)] hover:underline"
											>
												Plugin development guide <ArrowRight size={15} />
											</a>
											<span
												class="inline-flex cursor-default items-center gap-2 text-[var(--landing-muted)]"
												aria-disabled="true"
											>
												Plugin community
												<span
													class="rounded-[8px] border border-[var(--landing-border)] px-2 py-0.5 font-heading text-xs"
													>SOON</span
												>
											</span>
										</div>
									{/if}

									{#if f.kind === 'code'}
										<pre
											class="mt-4 overflow-x-auto rounded-xl bg-[#1d1d1f] p-4 font-heading text-xs leading-relaxed text-[#e8e8ed]"><code
												>{#each codeTokens as t, i (i)}<span class="tok-{t.kind}">{t.text}</span
													>{/each}</code
											></pre>
									{/if}
								</svelte:element>
							{/each}
						</div>
					</section>
				</div>
			</div>

			<!-- Closing call to action -->
			<section class="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
				<h2 class="text-3xl font-extrabold text-[var(--landing-ink)] sm:text-4xl">
					Start designing
				</h2>
				<p class="mx-auto mt-3 max-w-md text-[var(--landing-muted)]">
					Free and open source. No installation, no account.
				</p>
				<div class="mt-7 flex flex-wrap items-center justify-center gap-3">
					<a
						href={resolve('/editor')}
						class="lift rounded-full bg-[var(--landing-blue)] px-7 py-3 text-base font-semibold text-white shadow-sm"
					>
						Open Editor
					</a>
					<!-- eslint-disable svelte/no-navigation-without-resolve -- exampleHref is built with resolve() -->
					<a
						href={exampleHref}
						class="rounded-full border border-[var(--landing-border)] bg-[var(--landing-card)] px-7 py-3 text-base font-semibold text-[var(--landing-ink)] transition-colors hover:border-[var(--landing-muted)]"
					>
						Try an example design
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</div>
			</section>
		</main>

		<!-- Footer -->
		<footer class="border-t border-[var(--landing-border)]">
			<div
				class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-center text-sm text-[var(--landing-muted)] sm:flex-row sm:px-6"
			>
				<div class="flex flex-col items-center gap-1 sm:items-start">
					<span class="flex items-center gap-2">
						<img src={fn} alt="" class="size-4 opacity-70" />
						Foldnano, open-source DNA nanostructure design
					</span>
					<span class="text-xs">
						Maintained by Xin Shi, Department of Chemistry, KU Leuven ·
						<a
							href="{GITHUB_URL}/blob/main/LICENSE"
							target="_blank"
							rel="noopener"
							class="underline-offset-2 hover:text-[var(--landing-ink)] hover:underline"
							>MIT License</a
						>
					</span>
				</div>
				<nav class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
					<a href={resolve('/editor')} class="hover:text-[var(--landing-ink)]">Editor</a>
					<a href={resolve('/docs')} class="hover:text-[var(--landing-ink)]">Docs</a>
					<a href={resolve('/privacy')} class="hover:text-[var(--landing-ink)]">Privacy</a>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener"
						class="hover:text-[var(--landing-ink)]">GitHub</a
					>
				</nav>
			</div>
		</footer>
	</div>
</AlphaAccessGate>

<style>
	/* Snippet colors: the code block is always dark, so these are fixed. */
	.tok-kw {
		color: #c792ea;
	}
	.tok-fn {
		color: #82b1ff;
	}
	.tok-attr {
		color: #7fdc9a;
	}
	.tok-str,
	.tok-num {
		color: #f7c97e;
	}
	.tok-com {
		color: #8b8b93;
		font-style: italic;
	}
	.tok-punct {
		color: #a1a1aa;
	}

	/* Landing-scoped tokens. Fixed (not theme tokens) so the page has its own
	   brand palette independent of the editor's --primary etc., but it does
	   follow the app's `.dark` class (ModeWatcher, root layout) via the override
	   block below, rather than being light-only. */
	.landing {
		--landing-bg: #f5f5f7;
		--landing-card: #ffffff;
		--landing-ink: #1d1d1f;
		--landing-muted: #6e6e73;
		--landing-green: #34a853;
		--landing-blue: #2b6cb5;
		--landing-border: #e8e8ed;
		background-color: var(--landing-bg);
		color: var(--landing-ink);
	}

	:global(.dark) .landing {
		--landing-bg: #17181c;
		--landing-card: #1e2126;
		--landing-ink: #f2f2f4;
		--landing-muted: #9aa0a8;
		--landing-green: #3ecf70;
		--landing-blue: #4d8ac9;
		--landing-border: rgb(255 255 255 / 0.12);
	}

	/* Frosted panel floating over the hero 3D render (landing-scoped; the app's
	   glass-paper utility is reserved for menus and uses theme tokens). */
	.glass-panel {
		background: rgb(255 255 255 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.7);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.6),
			0 8px 32px rgb(0 0 0 / 0.08);
		-webkit-backdrop-filter: blur(18px) saturate(1.4);
		backdrop-filter: blur(18px) saturate(1.4);
	}

	:global(.dark) .glass-panel {
		background: rgb(30 32 36 / 0.55);
		border: 1px solid rgb(255 255 255 / 0.12);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.06),
			0 8px 32px rgb(0 0 0 / 0.4);
	}

	/* Feature cards: same glass language, but a stronger tint so small body text
	   stays readable where cards overlap dense strand geometry. */
	.glass-card {
		background: rgb(255 255 255 / 0.72);
		border: 1px solid rgb(255 255 255 / 0.75);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.6),
			0 8px 24px rgb(0 0 0 / 0.06);
		-webkit-backdrop-filter: blur(14px) saturate(1.3);
		backdrop-filter: blur(14px) saturate(1.3);
	}

	:global(.dark) .glass-card {
		background: rgb(30 32 36 / 0.72);
		border: 1px solid rgb(255 255 255 / 0.14);
		box-shadow:
			inset 0 1px 0 rgb(255 255 255 / 0.06),
			0 8px 24px rgb(0 0 0 / 0.35);
	}

	@media (prefers-reduced-motion: no-preference) {
		.lift {
			transition:
				transform 0.15s ease,
				box-shadow 0.15s ease;
		}
		.lift:hover {
			transform: translateY(-1px);
			box-shadow: 0 6px 20px color-mix(in srgb, var(--landing-blue) 25%, transparent);
		}
		.lift-card {
			transition:
				transform 0.15s ease,
				box-shadow 0.15s ease;
		}
		.lift-card:hover {
			transform: translateY(-2px);
			box-shadow:
				0 2px 4px rgb(0 0 0 / 0.05),
				0 14px 34px rgb(0 0 0 / 0.09);
		}
		.scroll-cue {
			animation: bob 2s ease-in-out infinite;
		}
	}

	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(4px);
		}
	}

	.scroll-cue {
		display: inline-flex;
	}
</style>
