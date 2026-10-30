import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';

vi.mock('$lib/errorReporting', () => ({ reportError: vi.fn() }));

import FoldnanoDocument from '$lib/model/document.svelte';
import { buildDesignOverview } from '$lib/model/io/designOverview';
import type { Part } from '$lib/model/Part';
import { makeHoneycombPart } from '$lib/model/test/testHelpers';
import {
	memoryDirectory,
	type MemoryDirectory,
	type MemoryTree,
} from '$lib/services/fileAccess/memoryFileSystem';
import type { IndexedDbFileHandleRecord } from '$lib/services/storage/indexedDbTypes';
import { FakeLockManager } from '$lib/services/test/fakeLockManager';
import { AgentRunListener } from './AgentRunListener.svelte';
import {
	AGENT_PROTOCOL,
	agentsMdFile,
	MAX_AGENT_SCRIPT_BYTES,
	type AgentListenerInfo,
	type AgentRunRecord,
} from './agentRuns';
import { PluginCoordinator } from './PluginCoordinator.svelte';
import { PluginDevMode } from './PluginDevMode.svelte';
import { PluginRegistry } from './PluginRegistry.svelte';
import type { PluginManifest } from './types';

const ID = 'agent.example';
const MINI = { format: 'foldnano_mini', applyStrategy: 'replayMutationLog' } as const;

function pluginTree(manifest: Partial<PluginManifest> = {}): MemoryTree {
	return {
		'fplugin.json': JSON.stringify({
			schemaVersion: 2,
			id: ID,
			name: 'Agent Example',
			version: '0.1.0',
			format: 'foldnano_json',
			applyStrategy: 'previewOnly',
			...manifest,
		}),
		'plugin.py': 'def run(ctx): pass\n',
		'helpers.py': 'X = 1\n',
	};
}

/** IndexedDB stand-in; one per browser, shared by every tab of a test. */
function makeDb() {
	const handles = new Map<string, IndexedDbFileHandleRecord>();
	const settings = new Map<string, unknown>();
	return {
		settings,
		loadAllPlugins: vi.fn(async () => []),
		savePlugin: vi.fn(async () => {}),
		updatePluginRecord: vi.fn(async () => {}),
		deletePlugin: vi.fn(async () => {}),
		deletePluginFiles: vi.fn(async () => {}),
		saveFileHandle: vi.fn(async (r: IndexedDbFileHandleRecord) => void handles.set(r.id, r)),
		loadFileHandle: vi.fn(async (id: string) => handles.get(id) ?? null),
		deleteFileHandle: vi.fn(async (id: string) => void handles.delete(id)),
		getSetting: vi.fn(async (key: string) => settings.get(key)),
		setSetting: vi.fn(async (key: string, value: unknown) => void settings.set(key, value)),
	};
}

type RunResult = {
	logs: string[];
	artifacts: Record<string, string>;
	pluginResult: Record<string, unknown> | null;
	primaryArtifact: string | null;
	mutationLog: unknown[] | null;
};

const previewResult = async (): Promise<RunResult> => ({
	logs: ['hello from python'],
	artifacts: {},
	pluginResult: { helices: 2 },
	primaryArtifact: null,
	mutationLog: null,
});

const mutationResult =
	(ops: unknown[] = [{ op: 'noop' }]) =>
	async (): Promise<RunResult> => ({
		logs: [],
		artifacts: {},
		pluginResult: null,
		primaryArtifact: null,
		mutationLog: ops,
	});

function makeBridge(run: () => Promise<RunResult>) {
	return {
		initRuntime: vi.fn(async () => {}),
		installPlugin: vi.fn(async () => {}),
		runPlugin: vi.fn(run),
		terminate: vi.fn(),
	};
}

/** One browser: the folder, IndexedDB and the lock manager every tab shares. */
function makeBrowser(manifest: Partial<PluginManifest> = {}) {
	const tree = pluginTree(manifest);
	return {
		db: makeDb(),
		tree,
		dir: memoryDirectory('my-plugin', tree, { readwrite: 'prompt', onRequest: 'granted' }),
		locks: new FakeLockManager(),
	};
}

/** One editor tab with the folder linked, showing `docId`. */
async function setup(
	options: {
		manifest?: Partial<PluginManifest>;
		run?: () => Promise<RunResult>;
		canEdit?: () => boolean;
		docId?: string;
		browser?: ReturnType<typeof makeBrowser>;
		allow?: boolean;
		getOverview?: (part?: Part) => ReturnType<typeof buildDesignOverview>;
	} = {}
) {
	const browser = options.browser ?? makeBrowser(options.manifest);
	const { db, dir, locks } = browser;
	const registry = new PluginRegistry(db as never);
	const doc = new FoldnanoDocument(options.docId ?? 'doc', 'Doc');
	doc.parts.push(makeHoneycombPart('Part'));
	const bridge = makeBridge(options.run ?? previewResult);
	const coordinator = new PluginCoordinator(
		registry,
		() => doc,
		undefined,
		() => null,
		(() => bridge) as never
	);
	registry.setBusyCheck((id) => coordinator.isPluginBusyOrPending(id));
	const devMode = new PluginDevMode(registry, () => coordinator, db as never);
	coordinator.setLinkedFolderReader((plugin) => devMode.readFolder(plugin));
	await devMode.ready;
	await devMode.setEnabled(true);
	vi.stubGlobal(
		'showDirectoryPicker',
		vi.fn(async () => dir)
	);
	await devMode.linkFolder();
	let now = 1_000_000;
	const listener = new AgentRunListener({
		registry,
		devMode,
		getCoordinator: () => coordinator,
		getDocId: () => doc.id,
		getDocName: () => doc.name,
		getPartJson: () => JSON.stringify(doc.parts[0].toJSON()),
		getOverview: options.getOverview ?? ((part = doc.parts[0]) => buildDesignOverview(part, null)),
		canEdit: options.canEdit ?? (() => true),
		origin: 'https://foldnano.test',
		db: db as never,
		locks,
		now: () => (now += 10),
		autoPoll: false,
	});
	coordinator.setPendingResolvedListener((token, resolution) =>
		listener.onPendingResolved(token, resolution)
	);
	await listener.ready;
	if (options.allow !== false) await listener.setAllowed(true);
	return { ...browser, registry, coordinator, devMode, bridge, doc, listener };
}

const agentDir = (tree: MemoryTree) => (tree['.foldnano'] as MemoryTree).agent as MemoryTree;

function readJson<T>(folder: MemoryTree, name: string): T {
	const value = folder[name];
	return JSON.parse(typeof value === 'string' ? value : strFromU8(value as Uint8Array)) as T;
}

const listenerInfo = (tree: MemoryTree) =>
	readJson<AgentListenerInfo>(agentDir(tree), 'listener.json');

/** A request the way run.py writes one: with the session listener.json announces. */
function addRequest(tree: MemoryTree, id: string, fields: Record<string, unknown> = {}): void {
	const agent = ((tree['.foldnano'] as MemoryTree).agent ??= {}) as MemoryTree;
	const requests = (agent.requests ??= {}) as MemoryTree;
	const session = agent['listener.json'] ? listenerInfo(tree).session : 'none';
	requests[`${id}.json`] = JSON.stringify({ protocol: AGENT_PROTOCOL, id, session, ...fields });
}

const record = (tree: MemoryTree, id: string) =>
	readJson<AgentRunRecord>(agentDir(tree).runs as MemoryTree, `${id}.json`);

const waiting = (tree: MemoryTree) =>
	Object.keys((agentDir(tree).requests as MemoryTree | undefined) ?? {});

function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}

const setPermission = (dir: MemoryDirectory, readwrite: PermissionState) =>
	((dir as unknown as { permissions: { readwrite: PermissionState } }).permissions.readwrite =
		readwrite);

describe('AgentRunListener', () => {
	it('asks for write access, writes the agent files and connects to the open design', async () => {
		const { listener, tree, db } = await setup();
		await listener.enable(ID);
		expect(listener.state).toBe('listening');
		expect(db.settings.get('pluginAgentRunsConnection')).toEqual({
			pluginId: ID,
			docId: 'doc',
			docName: 'Doc',
		});
		const foldnano = tree['.foldnano'] as MemoryTree;
		expect(strFromU8(foldnano['run.py'] as Uint8Array)).toContain('Generated by Foldnano');
		expect(strFromU8(tree['AGENTS.md'] as Uint8Array)).toContain('https://foldnano.test/llms.txt');
		expect(tree['agent-scripts']).toEqual({});
		expect(Object.keys(tree['.foldnano-stubs'] as MemoryTree).sort()).toEqual([
			'foldnano',
			'foldnano_mini',
		]);
		expect(tree['pyrightconfig.json']).toBeDefined();
		expect(listenerInfo(tree)).toMatchObject({
			protocol: AGENT_PROTOCOL,
			pluginId: ID,
			docId: 'doc',
			docName: 'Doc',
			state: 'listening',
			activity: 'idle',
		});
		expect(listenerInfo(tree).session).toEqual(expect.any(String));
	});

	it('keeps an AGENTS.md and run.py the author wrote', async () => {
		const { listener, tree } = await setup();
		tree['AGENTS.md'] = 'mine';
		tree['.foldnano'] = { 'run.py': 'print("mine")' };
		await listener.enable(ID);
		expect(tree['AGENTS.md']).toBe('mine');
		expect((tree['.foldnano'] as MemoryTree)['run.py']).toBe('print("mine")');
	});

	it('updates an AGENTS.md it wrote, until someone edits it', async () => {
		const { listener, tree } = await setup();
		const unedited = await agentsMdFile(
			{ format: 'cadnano_json', applyStrategy: 'replaceRegion' } as unknown as PluginManifest,
			'https://foldnano.test'
		);
		tree['AGENTS.md'] = unedited;
		await listener.enable(ID);
		const updated = strFromU8(tree['AGENTS.md'] as unknown as Uint8Array);
		expect(updated).not.toBe(unedited);
		expect(updated).toContain('--ask-user-approval');

		await listener.disable();
		const edited = updated.replace('# Working', '# Our lab rules\n\n# Working');
		tree['AGENTS.md'] = edited;
		await listener.enable(ID);
		expect(tree['AGENTS.md']).toBe(edited);
	});

	it('runs the plugin for a request and records the output and context', async () => {
		const { listener, tree, bridge } = await setup();
		await listener.enable(ID);
		addRequest(tree, 'r1', { params: { n: 2 } });
		await listener.tick();

		expect(bridge.runPlugin).toHaveBeenCalledOnce();
		expect(waiting(tree)).toEqual([]);
		const run = record(tree, 'r1');
		expect(run).toMatchObject({
			status: 'done',
			script: null,
			params: { n: 2 },
			applyOutcome: 'nothing',
			applied: false,
			result: { helices: 2 },
			docId: 'doc',
			manifestVersion: '0.1.0',
		});
		expect(run.logs.at(-1)).toBe('hello from python');
		expect(run.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(run.runtime).toMatch(/^pyodide-/);
		expect(run.designAfter).toBe(run.designBefore);
		expect(run.kind).toBe('run');
		expect(run.overview).toMatchObject({ overview: 1, region: { kind: 'HONEYCOMB' } });
		expect(listener.lastRun?.id).toBe('r1');
	});

	it('answers a describe request with the overview, without running Python', async () => {
		const { listener, tree, bridge } = await setup();
		await listener.enable(ID);
		addRequest(tree, 'd1', { kind: 'describe' });
		await listener.tick();

		expect(bridge.runPlugin).not.toHaveBeenCalled();
		expect(waiting(tree)).toEqual([]);
		expect(record(tree, 'd1')).toMatchObject({
			kind: 'describe',
			status: 'done',
			apply: false,
			applyOutcome: null,
			overview: { overview: 1, region: { helixCount: 0 } },
		});
	});

	it('leaves the overview out, and still finishes the run, when building it fails', async () => {
		const { listener, tree } = await setup({
			getOverview: () => {
				throw new Error('broken');
			},
		});
		await listener.enable(ID);
		addRequest(tree, 'r1');
		await listener.tick();
		expect(record(tree, 'r1')).toMatchObject({ status: 'done', overview: null });
	});

	it('runs a folder script as the entrypoint, with the plugin modules beside it', async () => {
		const { listener, tree, bridge } = await setup();
		await listener.enable(ID);
		(tree['agent-scripts'] as MemoryTree)['01-look.py'] = 'def run(ctx): print(1)\n';
		addRequest(tree, 'r1', { script: 'agent-scripts/01-look.py' });
		await listener.tick();

		const [args] = bridge.runPlugin.mock.calls[0] as unknown as [
			{ entrypointPath: string; pluginZipData: ArrayBuffer },
		];
		expect(args.entrypointPath).toBe('agent-scripts/01-look.py');
		const files = unzipSync(new Uint8Array(args.pluginZipData));
		expect(Object.keys(files).sort()).toEqual([
			'agent-scripts/01-look.py',
			'fplugin.json',
			'helpers.py',
			'plugin.py',
		]);
		expect(record(tree, 'r1').scriptSha256).toMatch(/^[0-9a-f]{64}$/);
	});

	it('rejects a bad request without touching the plugin or attributing old logs', async () => {
		const { listener, tree, bridge } = await setup();
		await listener.enable(ID);
		addRequest(tree, 'r0');
		await listener.tick();
		addRequest(tree, 'r1', { script: 'agent-scripts/missing.py' });
		await listener.tick();
		expect(bridge.runPlugin).toHaveBeenCalledOnce();
		expect(record(tree, 'r1')).toMatchObject({ status: 'rejected', logs: [], result: null });
		expect(record(tree, 'r1').error).toMatch(/was not found/);
	});

	it('records a failed run with its folder-relative traceback', async () => {
		const { listener, tree } = await setup({
			run: async () => {
				throw Object.assign(new Error('ValueError: bad'), {
					traceback: 'File "/plugin_run/agent-scripts/x.py", line 2',
					logs: ['before'],
				});
			},
		});
		await listener.enable(ID);
		addRequest(tree, 'r1');
		await listener.tick();
		const run = record(tree, 'r1');
		expect(run.status).toBe('error');
		expect(run.error).toBe('ValueError: bad');
		expect(run.traceback).toContain('my-plugin/agent-scripts/x.py');
		expect(run.logs.at(-1)).toBe('before');
	});

	it('applies only its own result and records the outcome the coordinator reports', async () => {
		const { listener, tree, coordinator } = await setup({ manifest: MINI, run: mutationResult() });
		const confirm = vi.spyOn(coordinator, 'confirmApply').mockImplementation(() => {
			coordinator.pendingApply = null;
			return 'applied';
		});
		await listener.enable(ID);
		addRequest(tree, 'r1');
		await listener.tick();
		expect(confirm).toHaveBeenCalledWith(ID, expect.any(String));
		expect(record(tree, 'r1')).toMatchObject({
			status: 'done',
			applyOutcome: 'applied',
			applied: true,
		});
	});

	describe('dry runs', () => {
		const addHelix = (doc: FoldnanoDocument, regionId = doc.parts[0].regions[0].id) => ({
			op: 'add_vh_at_coords',
			regionId,
			row: 0,
			col: 0,
			newVhId: 'vh-new',
		});

		it('shows the overview with the change, then throws the result away', async () => {
			const shown: { doc?: FoldnanoDocument } = {};
			const ctx = await setup({
				manifest: MINI,
				run: async () => mutationResult([addHelix(shown.doc!)])(),
			});
			shown.doc = ctx.doc;
			const confirm = vi.spyOn(ctx.coordinator, 'confirmApply');
			await ctx.listener.enable(ID);
			addRequest(ctx.tree, 'r1', { mode: 'dry-run' });
			await ctx.listener.tick();

			expect(record(ctx.tree, 'r1')).toMatchObject({
				status: 'done',
				mode: 'dry-run',
				applyOutcome: 'dry-run',
				applied: false,
				overview: { region: { helixCount: 1 } },
			});
			expect(confirm).not.toHaveBeenCalled();
			expect(ctx.coordinator.pendingApply).toBeNull();
			expect(ctx.doc.parts[0].virtualHelices).toHaveLength(0);
		});

		it('reports a change that would fail to apply', async () => {
			const shown: { doc?: FoldnanoDocument } = {};
			const ctx = await setup({
				manifest: MINI,
				run: async () => mutationResult([addHelix(shown.doc!, 'no-such-region')])(),
			});
			shown.doc = ctx.doc;
			await ctx.listener.enable(ID);
			addRequest(ctx.tree, 'r1', { mode: 'dry-run' });
			await ctx.listener.tick();

			const run = record(ctx.tree, 'r1');
			expect(run).toMatchObject({ status: 'error', applyOutcome: 'failed', overview: null });
			expect(run.error).toMatch(/^Applying this result would fail/);
			expect(ctx.coordinator.pendingApply).toBeNull();
		});
	});

	describe('connection (bug 1)', () => {
		it('does not listen in a tab that shows another design', async () => {
			const browser = makeBrowser();
			const a = await setup({ browser, docId: 'doc-a' });
			await a.listener.enable(ID);
			const b = await setup({ browser, docId: 'doc-b' });
			await b.listener.tick();
			expect(b.listener.state).toBe('paused');
			expect(b.listener.pausedReason).toMatch(/connected to "Doc"/);

			addRequest(browser.tree, 'r1');
			await b.listener.tick();
			await a.listener.tick();
			expect(b.bridge.runPlugin).not.toHaveBeenCalled();
			expect(a.bridge.runPlugin).toHaveBeenCalledOnce();
		});

		it('lets only one tab listen to a folder, so a request runs once', async () => {
			const browser = makeBrowser();
			const a = await setup({ browser });
			await a.listener.enable(ID);
			const b = await setup({ browser });
			await b.listener.tick();
			expect(b.listener.pausedReason).toBe('another tab is listening to this folder');

			addRequest(browser.tree, 'r1');
			await Promise.all([a.listener.tick(), b.listener.tick()]);
			expect(a.bridge.runPlugin.mock.calls.length + b.bridge.runPlugin.mock.calls.length).toBe(1);
		});

		it('rejects a request written for another listening session', async () => {
			const { listener, tree, bridge } = await setup();
			await listener.enable(ID);
			addRequest(tree, 'r1', { session: 'someone-elses' });
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(record(tree, 'r1')).toMatchObject({ status: 'rejected' });
			expect(record(tree, 'r1').error).toMatch(/earlier listening session/);
		});

		it('disconnects when plugin dev mode is turned off', async () => {
			const { listener, tree, db, devMode } = await setup();
			await listener.enable(ID);
			await devMode.setEnabled(false);
			await listener.tick();
			expect(listener.state).toBe('off');
			expect(db.settings.get('pluginAgentRunsConnection')).toBeNull();
			expect(listenerInfo(tree).state).toBe('stopped');
		});

		it('disconnects in another tab when one tab turns agent runs off', async () => {
			const browser = makeBrowser();
			const a = await setup({ browser });
			await a.listener.enable(ID);
			const b = await setup({ browser });
			await b.listener.setAllowed(false);
			await a.listener.tick();
			expect(a.listener.state).toBe('off');
			expect(listenerInfo(browser.tree).state).toBe('stopped');
		});
	});

	describe('review (bugs 2, 3)', () => {
		it('queues requests while a result awaits review, and records the review', async () => {
			const { listener, tree, coordinator, bridge } = await setup({
				manifest: MINI,
				run: mutationResult(),
			});
			const confirm = vi.spyOn(coordinator, 'confirmApply');
			await listener.enable(ID);
			addRequest(tree, 'r1', { mode: 'ask-user' });
			await listener.tick();
			expect(record(tree, 'r1')).toMatchObject({
				mode: 'ask-user',
				apply: false,
				applyOutcome: 'pending-review',
				review: null,
			});

			// An inspection run must not apply (or replace) the result the user is reviewing.
			bridge.runPlugin.mockImplementation(mutationResult([]));
			addRequest(tree, 'r2');
			await listener.tick();
			expect(waiting(tree)).toEqual(['r2.json']);
			expect(listenerInfo(tree).activity).toBe('awaiting-review');
			expect(confirm).not.toHaveBeenCalled();

			coordinator.cancelApply(ID);
			await vi.waitFor(() => expect(record(tree, 'r1').review).toBe('discarded'));
			await listener.tick();
			expect(record(tree, 'r2')).toMatchObject({ status: 'done', applyOutcome: 'nothing' });
			expect(confirm).not.toHaveBeenCalled();
		});

		it('reports a result thrown away because the design changed as not applied', async () => {
			const shown: { doc?: FoldnanoDocument } = {};
			const run = async () => {
				shown.doc!.parts[0].name = 'Edited by the user meanwhile';
				return mutationResult()();
			};
			const ctx = await setup({ manifest: MINI, run });
			shown.doc = ctx.doc;
			await ctx.listener.enable(ID);
			addRequest(ctx.tree, 'r1');
			await ctx.listener.tick();
			const result = record(ctx.tree, 'r1');
			expect(result).toMatchObject({ status: 'done', applyOutcome: 'stale', applied: false });
			expect(result.error).toMatch(/design changed while the script ran/);
			expect(result.designAfter).not.toBe(result.designBefore);
		});
	});

	describe('lifecycle (bugs 4, 5)', () => {
		it('runs nothing after the editor is disposed mid-poll', async () => {
			const { listener, devMode, tree, bridge } = await setup();
			await listener.enable(ID);
			addRequest(tree, 'r1');
			const realHandle = devMode.folderHandle.bind(devMode);
			const { opened, open } = gate();
			vi.spyOn(devMode, 'folderHandle').mockImplementation(async (plugin) => {
				await opened;
				return realHandle(plugin);
			});
			const poll = listener.tick();
			listener.dispose();
			open();
			await poll;
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(waiting(tree)).toEqual(['r1.json']);
		});

		it('does not start after being disposed while loading', async () => {
			const browser = makeBrowser();
			const a = await setup({ browser });
			await a.listener.enable(ID);
			const b = await setup({ browser, allow: false });
			const late = new AgentRunListener({
				registry: b.registry,
				devMode: b.devMode,
				getCoordinator: () => b.coordinator,
				getDocId: () => 'doc',
				getDocName: () => 'Doc',
				getPartJson: () => null,
				canEdit: () => true,
				origin: '',
				db: browser.db as never,
				locks: browser.locks,
				autoPoll: false,
			});
			late.dispose();
			await late.ready;
			expect(late.connection).toBeNull();
		});

		it('keeps the heartbeat going, with the running request, during a long run', async () => {
			const running = gate();
			const { listener, tree } = await setup({
				run: async () => {
					await running.opened;
					return previewResult();
				},
			});
			await listener.enable(ID);
			addRequest(tree, 'r1');
			const poll = listener.tick();
			await vi.waitFor(() => expect(listener.current?.id).toBe('r1'));
			const before = listenerInfo(tree).heartbeatAt;
			await listener.heartbeat();
			expect(listenerInfo(tree)).toMatchObject({ activity: 'running', requestId: 'r1' });
			expect(listenerInfo(tree).heartbeatAt).toBeGreaterThan(before);
			running.open();
			await poll;
			expect(listenerInfo(tree).activity).toBe('idle');
		});

		it('marks a run a closed editor left running as interrupted', async () => {
			const { listener, tree } = await setup();
			tree['.foldnano'] = {
				agent: {
					runs: { 'old.json': JSON.stringify({ id: 'old', status: 'running' }) },
				},
			};
			await listener.enable(ID);
			expect(record(tree, 'old').status).toBe('interrupted');
		});
	});

	describe('outcomes (bug 6)', () => {
		it('records a run the user stopped as cancelled, not done', async () => {
			let rejectRun!: (e: Error) => void;
			const { listener, tree, coordinator, bridge } = await setup({
				run: () => new Promise((_resolve, reject) => (rejectRun = reject)),
			});
			bridge.terminate.mockImplementation(() => rejectRun(new Error('worker terminated')));
			await listener.enable(ID);
			addRequest(tree, 'r1');
			const poll = listener.tick();
			await vi.waitFor(() => expect(bridge.runPlugin).toHaveBeenCalled());
			coordinator.stopPlugin(ID);
			await poll;
			expect(record(tree, 'r1')).toMatchObject({ status: 'cancelled', applied: false });
			expect(record(tree, 'r1').error).toMatch(/stopped/);
		});
	});

	describe('limits (bug 7)', () => {
		it('rejects a script over the size limit without reading or running it', async () => {
			const { listener, tree, bridge } = await setup();
			await listener.enable(ID);
			(tree['agent-scripts'] as MemoryTree)['big.py'] = new Uint8Array(MAX_AGENT_SCRIPT_BYTES + 1);
			addRequest(tree, 'r1', { script: 'agent-scripts/big.py' });
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(record(tree, 'r1')).toMatchObject({ status: 'rejected' });
		});

		it('rejects a request file over the size limit', async () => {
			const { listener, tree, bridge } = await setup();
			await listener.enable(ID);
			addRequest(tree, 'r1', { params: { blob: 'x'.repeat(70 * 1024) } });
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(record(tree, 'r1').error).toMatch(/larger than/);
		});
	});

	describe('leftover requests', () => {
		it('pauses while another tab owns the design, and rejects what was written meanwhile', async () => {
			let owner = false;
			const { listener, tree, bridge } = await setup({ canEdit: () => owner });
			await listener.enable(ID);
			expect(listener.state).toBe('paused');
			expect(listener.pausedReason).toBe('another tab is editing this design');
			addRequest(tree, 'r1');
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();

			owner = true;
			await listener.tick();
			expect(record(tree, 'r1')).toMatchObject({ status: 'rejected' });
			expect(bridge.runPlugin).not.toHaveBeenCalled();

			addRequest(tree, 'r2');
			await listener.tick();
			expect(record(tree, 'r2').status).toBe('done');
		});

		it('never runs a request that was waiting before agent runs were turned on', async () => {
			const { listener, tree, bridge } = await setup();
			tree['.foldnano'] = {
				agent: {
					requests: {
						'planted.json': JSON.stringify({
							protocol: AGENT_PROTOCOL,
							id: 'planted',
							session: 'x',
						}),
					},
				},
			};
			await listener.enable(ID);
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(waiting(tree)).toEqual([]);
			expect(record(tree, 'planted').error).toMatch(/already waiting/);
		});

		it('rejects requests written while folder permission had lapsed', async () => {
			const { listener, tree, dir, bridge } = await setup();
			await listener.enable(ID);
			setPermission(dir, 'prompt');
			await listener.tick();
			expect(listener.state).toBe('needs-permission');
			addRequest(tree, 'r1');
			await listener.resume();
			expect(listener.state).toBe('listening');
			await listener.tick();
			expect(bridge.runPlugin).not.toHaveBeenCalled();
			expect(record(tree, 'r1').status).toBe('rejected');
		});
	});

	describe('switching off', () => {
		it('marks the folder as not listening when turned off', async () => {
			const { listener, tree, db } = await setup();
			await listener.enable(ID);
			await listener.disable();
			expect(listener.state).toBe('off');
			expect(db.settings.get('pluginAgentRunsConnection')).toBeNull();
			expect(listenerInfo(tree).state).toBe('stopped');
		});

		it('stays off when stopped while a poll is still reading the folder', async () => {
			const { listener, devMode, tree } = await setup();
			await listener.enable(ID);
			const realHandle = devMode.folderHandle.bind(devMode);
			const { opened, open } = gate();
			vi.spyOn(devMode, 'folderHandle').mockImplementation(async (plugin) => {
				await opened;
				return realHandle(plugin);
			});
			const poll = listener.tick();
			const stopped = listener.disable();
			open();
			await Promise.all([poll, stopped]);
			expect(listener.state).toBe('off');
			expect(listener.pluginId).toBeNull();
			expect(listenerInfo(tree).state).toBe('stopped');
		});

		it('needs the experimental switch, and disconnects when it is turned off', async () => {
			const { listener, db, tree } = await setup({ allow: false });
			await expect(listener.enable(ID)).rejects.toThrow(/experimental/);
			expect((tree['.foldnano'] as MemoryTree | undefined)?.['run.py']).toBeUndefined();

			await listener.setAllowed(true);
			await listener.enable(ID);
			await listener.setAllowed(false);
			expect(listener.state).toBe('off');
			expect(db.settings.get('pluginAgentRunsAllowed')).toBe(false);
			expect(db.settings.get('pluginAgentRunsConnection')).toBeNull();
		});

		it('stops when its folder is unlinked', async () => {
			const { listener, devMode } = await setup();
			await listener.enable(ID);
			devMode.unlink(ID);
			await listener.tick();
			expect(listener.pluginId).toBeNull();
		});
	});
});
