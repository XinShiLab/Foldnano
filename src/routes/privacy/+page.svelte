<script lang="ts">
	import { resolve } from '$app/paths';

	const CONTROLLER = 'Prof. Xin Shi, Department of Chemistry, KU Leuven';
	const LAST_UPDATED = '2026-10-07';

	const STORAGE_ITEMS = [
		{
			name: 'foldnano_alpha_access',
			kind: 'Cookie',
			purpose: 'Remembers that you entered a valid access code during testing.',
			lifetime: '30 days',
		},
		{
			name: 'foldnano_privacy_notice',
			kind: 'Cookie',
			purpose: 'Remembers that you dismissed the privacy notice.',
			lifetime: '1 year',
		},
		{
			name: 'foldnano_workspace_help',
			kind: 'Cookie',
			purpose:
				'Remembers that you closed the workspace help, so it does not open by itself on later visits.',
			lifetime: '1 year',
		},
		{
			name: 'foldnano_browser_notice',
			kind: 'Cookie',
			purpose:
				'Remembers that you dismissed the notice recommending a Chromium-based browser (shown only in other browsers).',
			lifetime: '1 year',
		},
		{
			name: 'gh_oauth_state',
			kind: 'Cookie',
			purpose:
				'Protects the GitHub sign-in against forged requests. Set only when you connect GitHub.',
			lifetime: '10 minutes',
		},
		{
			name: 'gh_token',
			kind: 'Cookie',
			purpose:
				'Holds your GitHub access token so the app can read and write the repositories you choose. Not readable by page scripts.',
			lifetime: '8 hours, or until you disconnect',
		},
		{
			name: 'Foldnano database',
			kind: 'IndexedDB',
			purpose:
				'Your working copies of designs, editor layout, installed plugins, and GitHub sync metadata.',
			lifetime: 'Until you delete it or clear site data',
		},
	];
</script>

<svelte:head>
	<title>Privacy · Foldnano</title>
	<meta name="description" content="How Foldnano handles your designs, cookies, and data." />
</svelte:head>

<main class="min-h-dvh bg-background px-4 py-10 text-foreground">
	<article class="mx-auto prose max-w-3xl prose-neutral dark:prose-invert">
		<p class="text-sm"><a href={resolve('/')}>Foldnano</a></p>
		<h1>Privacy</h1>
		<p class="lead">
			Foldnano is local-first. Your designs are stored in your own browser and are never uploaded to
			a Foldnano server. There is no tracking, no advertising, and no user accounts. We only count
			visits anonymously, so we can report how widely Foldnano is used to the agencies that fund it.
		</p>

		<h2>Where your designs are stored</h2>
		<ul>
			<li>
				<strong>In this browser.</strong> Designs are saved in your browser's IndexedDB storage on
				this device. Foldnano has no server-side document store, so we cannot see, recover, or
				delete your designs. Clearing this site's data in your browser deletes them, so export a
				<code>.fn.json</code> file for anything important.
			</li>
			<li>
				<strong>On GitHub, only if you choose.</strong> If you connect a GitHub account and sync or
				publish a design, it is stored in the repository you select, under
				<a
					href="https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"
					>GitHub's privacy statement</a
				>. GitHub may process data outside the EU. Check whether the target repository is private or
				public before syncing.
			</li>
			<li>
				<strong>In files you export.</strong> Downloads (Foldnano JSON, cadnano, oxDNA, mrDNA, and others)
				go wherever you save them.
			</li>
		</ul>

		<h2>Cookies and browser storage</h2>
		<p>
			Foldnano only stores what is strictly necessary to provide the features you use, so it does
			not ask for cookie consent. No cookies are used for statistics or advertising.
		</p>
		<div class="not-prose overflow-x-auto">
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-border text-left">
						<th class="py-2 pr-4 font-semibold">Name</th>
						<th class="py-2 pr-4 font-semibold">Type</th>
						<th class="py-2 pr-4 font-semibold">Purpose</th>
						<th class="py-2 font-semibold">Lifetime</th>
					</tr>
				</thead>
				<tbody>
					{#each STORAGE_ITEMS as item (item.name)}
						<tr class="border-b border-border align-top">
							<td class="py-2 pr-4 font-mono text-xs">{item.name}</td>
							<td class="py-2 pr-4">{item.kind}</td>
							<td class="py-2 pr-4 text-muted-foreground">{item.purpose}</td>
							<td class="py-2 text-muted-foreground">{item.lifetime}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<h2>Anonymous usage statistics</h2>
		<p>
			We use <a href="https://vercel.com/docs/analytics/privacy-policy">Vercel Web Analytics</a> to count
			page views and visitors. It sets no cookies and stores nothing in your browser. Each page view records
			only the page address, referring site, country or region, browser, operating system, and device
			type. A visitor is recognised by a hash of the request that is discarded after 24 hours, and results
			are only available to us as totals.
		</p>
		<p>
			Before anything is sent, Foldnano removes document identifiers and all query parameters from
			the page address, so an editor visit is recorded as <code>/editor/[docId]</code>. Your design
			content, file names, and GitHub data are never part of these statistics.
		</p>

		<h2>Services your browser contacts</h2>
		<p>
			None of these receive your designs. Like any website request, they receive your IP address and
			browser details.
		</p>
		<ul>
			<li>
				<strong>Vercel.</strong> The app is hosted on Vercel, which keeps short-lived technical request
				logs (IP address, time, requested page) for security and operation, and receives the anonymous
				statistics described above.
			</li>
			<li>
				<strong>jsDelivr CDN.</strong> When you run a Python plugin or Script Lab, the Python
				runtime (Pyodide) is downloaded from <code>cdn.jsdelivr.net</code>. Your design stays in
				your browser; the plugin runs locally.
			</li>
			<li>
				<strong>GitHub.</strong> Only after you connect GitHub. Requests pass through Foldnano's API proxy
				so your access token never reaches page scripts; the proxy does not store your files.
			</li>
			<li>
				<strong>Plugin sources.</strong> Installing a plugin from a URL downloads it from that address.
				Plugins are independent projects with their own terms.
			</li>
		</ul>

		<h2>Legal basis and your rights</h2>
		<p>
			Request logs, the necessary cookies above, and the anonymous usage statistics are processed on
			the basis of our legitimate interest in operating a secure service and reporting its use to
			research funders (GDPR Art. 6(1)(f)). GitHub data is processed only to perform the sync you
			request (Art. 6(1)(b)). You have the right to access, correct, or erase personal data we hold,
			to object to processing, and to lodge a complaint with a supervisory authority; in Belgium
			this is the
			<a href="https://www.dataprotectionauthority.be">Data Protection Authority</a>.
		</p>

		<h2>Contact</h2>
		<p>
			Controller: {CONTROLLER}.<br />
			For questions or requests, contact Prof. Xin Shi at the Department of Chemistry, KU Leuven.
		</p>

		<p class="text-sm text-muted-foreground">Last updated {LAST_UPDATED}.</p>
	</article>
</main>
