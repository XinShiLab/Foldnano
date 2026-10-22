import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/errorReporting', () => ({
	reportError: vi.fn(),
}));

import FoldnanoDocument from '$lib/model/document.svelte';
import { makeHoneycombPart, addLatticeVh } from '$lib/model/test/testHelpers';
import { HoneycombRegion } from '$lib/model/Part/DesignRegion';
import { Plane } from '$lib/model/Part/Plane.svelte';
import {
	PluginCoordinator,
	RUN_FAILED_WITHOUT_MESSAGE,
	type PendingApply,
} from './PluginCoordinator.svelte';
import { PluginRegistry } from './PluginRegistry.svelte';
import { RunTimeoutError } from './worker/bridge';
import { FoldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import { HistoryStack } from '$lib/commands/history.svelte';
import { StorageManager } from '$lib/services/storage/StorageManager';
import type { StorageProvider } from '$lib/services/storage/StorageProvider';
import type { PluginManifest, PythonPlugin } from './types';
import { reportError } from '$lib/errorReporting';

const reportErrorMock = vi.mocked(reportError);

class MockStorageProvider implements StorageProvider {
	async saveDocument(): Promise<boolean> {
		return true;
	}
	async loadDocument(): Promise<object | null> {
		return null;
	}
	async deleteDocument(): Promise<boolean> {
		return true;
	}
	async getDocumentList(): Promise<[]> {
		return [];
	}
	async saveContext(): Promise<boolean> {
		return true;
	}
	async loadContext(): Promise<object | null> {
		return null;
	}
	getProviderInfo() {
		return { name: 'Mock', type: 'memory' as const, description: 'Mock storage provider' };
	}
	async isAvailable(): Promise<boolean> {
		return true;
	}
}

function createHistory(doc: FoldnanoDocument): HistoryStack {
	const storage = new StorageManager('memory');
	storage.registerProvider('memory', new MockStorageProvider());
	return new HistoryStack(doc, storage);
}

function makePlugin(manifest: PluginManifest): PythonPlugin {
	return {
		manifest,
		origin: 'user',
		enabled: true,
		status: 'active',
		resolvedCode: 'def run(ctx): pass',
		resolvedZipData: undefined,
		errorMessage: null,
		errorTraceback: null,
		logs: [],
		artifacts: {},
		pluginResult: null,
		paramValues: {},
		sidePanelValues: {},
		sidePanelCode: '',
		lastRunMutationLogLength: null,
		authoring: null,
		draftCode: null,
		iconSvg: null,
	};
}

describe('PluginCoordinator', () => {
	it('discards pending apply when the active part changed after the plugin run', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'replace-part',
			name: 'Replace Part',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(makeHoneycombPart('From Plugin').toJSON()),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		const originalPart = makeHoneycombPart('Original Part');
		doc.parts.push(originalPart);

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);
		expect(coordinator.pendingApply?.pluginId).toBe(manifest.id);

		doc.parts[0].name = 'Locally Edited';
		coordinator.confirmApply(manifest.id);

		expect(coordinator.pendingApply).toBeNull();
		expect(doc.parts[0].name).toBe('Locally Edited');
		expect(doc.parts[0]).toBe(originalPart);
	});

	it('captures the pre-run snapshot before the run starts, independent of edits made while it is in flight', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'replace-part-midrun',
			name: 'Replace Part Midrun',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		let resolveRun!: (result: {
			logs: string[];
			artifacts: Record<string, unknown>;
			pluginResult: null;
			primaryArtifact: string;
			mutationLog: null;
		}) => void;
		const runPromise = new Promise((resolve) => {
			resolveRun = resolve;
		});
		const bridge = {
			runPlugin: vi.fn().mockReturnValue(runPromise),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		const originalPart = makeHoneycombPart('Original Part');
		doc.parts.push(originalPart);

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		const runCall = coordinator.run(manifest.id);
		// Snapshot is captured synchronously before this `await`, so this edit must not reach it.
		doc.parts[0].name = 'Edited Mid-Run';

		resolveRun({
			logs: [],
			artifacts: {},
			pluginResult: null,
			primaryArtifact: JSON.stringify(makeHoneycombPart('From Plugin').toJSON()),
			mutationLog: null,
		});
		await runCall;

		const snapshot = coordinator.pendingApply?.preRunFoldnanoSnapshot as { name: string } | null;
		expect(snapshot?.name).toBe('Original Part');

		// The worker input must be the same pre-edit snapshot, not a re-read of the live part.
		const sentArg = bridge.runPlugin.mock.calls[0][0] as { foldnanoJsonIn?: string };
		const sentSnapshot = JSON.parse(sentArg.foldnanoJsonIn ?? 'null') as { name: string } | null;
		expect(sentSnapshot?.name).toBe('Original Part');
	});

	it('forwards side panel input to the worker when requested', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'side-panel-demo',
			name: 'Side Panel Demo',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: null,
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.runWithOptions(manifest.id, {
			params: { sample: 1 },
			sidePanelInput: {
				type: 'codeEditor',
				code: 'print("hello")',
				filename: 'demo.py',
			},
		});

		expect(bridge.runPlugin).toHaveBeenCalledWith(
			expect.objectContaining({
				paramsJson: JSON.stringify({ sample: 1 }),
				pluginCode: 'def run(ctx): pass',
				loadImports: false,
				sidePanelInputJson: JSON.stringify({
					type: 'codeEditor',
					code: 'print("hello")',
					filename: 'demo.py',
				}),
			})
		);
	});

	it('executes code-editor contents as the entrypoint when requested by the manifest', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'script-lab',
			name: 'Script Lab',
			version: '1.0.0',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): raise RuntimeError("placeholder")',
			sidePanel: {
				type: 'codeEditor',
				codeEditor: {
					execution: 'entrypoint',
				},
			},
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: ['ok'],
				artifacts: {},
				pluginResult: { status: 'ok' },
				primaryArtifact: null,
				mutationLog: [{ op: 'set_oligo_color' }],
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.runWithOptions(manifest.id, {
			sidePanelInput: {
				type: 'codeEditor',
				code: 'def run(ctx):\n    ctx.log("from editor")\n',
				filename: 'script_lab.py',
			},
		});

		expect(bridge.runPlugin).toHaveBeenCalledWith(
			expect.objectContaining({
				pluginCode: 'def run(ctx):\n    ctx.log("from editor")\n',
				loadImports: true,
			})
		);
		expect(plugin.lastRunMutationLogLength).toBe(1);
		expect(coordinator.pendingApply?.pluginId).toBe(manifest.id);
	});

	it('does not create a pending apply when a replay plugin emits no mutation log', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'script-lab',
			name: 'Script Lab',
			version: '1.0.0',
			format: 'foldnano_mini',
			applyStrategy: 'replayMutationLog',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: ['no-op'],
				artifacts: {},
				pluginResult: { status: 'no-op' },
				primaryArtifact: null,
				mutationLog: [],
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.lastRunMutationLogLength).toBe(0);
		expect(coordinator.pendingApply).toBeNull();
	});

	it('never runs Plugin result format validation for previewOnly, even with a primary artifact present', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'preview-format',
			name: 'Preview Format',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'previewOnly',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			// Not valid foldnano_json shape — would throw if this ever reached format validation.
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: 'this is not even valid JSON',
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-preview', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('active');
		expect(plugin.errorMessage).toBeNull();
		expect(coordinator.pendingApply).toBeNull();
	});

	it('rejects a result that fails Plugin result format validation: status becomes error, no pendingApply is created', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'bad-format-result',
			name: 'Bad Format Result',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				// Missing "id" — fails Plugin result format validation before any reconstruction.
				primaryArtifact: JSON.stringify({
					name: 'Bad',
					planes: [],
					regions: [],
					oligos: [],
					virtualHelices: [],
				}),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-bad-format', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/Result validation/);
		expect(coordinator.pendingApply).toBeNull();
	});

	it('rejects a null primaryArtifact from a non-preview, non-replay strategy instead of silently skipping validation', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'null-result',
			name: 'Null Result',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			// No primaryArtifact — previously skipped the apply/validate block entirely.
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: null,
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-null-result', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/Result validation/);
		expect(coordinator.pendingApply).toBeNull();
	});

	it("passes the cleaned cadnano_json result to pendingApply, not the plugin's raw one-sided result", async () => {
		// Result validation may discard a one-sided pointer (a connection the plugin recorded but
		// the other side never agreed to) instead of rejecting it. Apply must use that cleaned
		// result — re-validating one artifact and applying the plugin's original, uncleaned one
		// would let the phantom pointer back in.
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'cadnano-one-sided',
			name: 'Cadnano One-Sided',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const rawArtifact = {
			name: 'One-Sided',
			vstrands: [
				{
					row: 0,
					col: 0,
					num: 0,
					scaf: [
						[-1, -1, 0, 1],
						[0, 0, 0, 2],
						[0, 1, 0, 10], // phantom outgoing — its target's own incoming is free
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, -1, -1],
						[-1, -1, 0, 11],
						[0, 10, -1, -1],
						// 42 bases (the default HONEYCOMB region's maxBase) so the fixture's length
						// matches its target region — unrelated to what this test actually checks.
						...Array.from({ length: 30 }, () => [-1, -1, -1, -1]),
					],
					stap: Array.from({ length: 42 }, () => [-1, -1, -1, -1]),
					loop: new Array(42).fill(0),
					skip: new Array(42).fill(0),
				},
			],
		};
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(rawArtifact),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-cadnano-clean', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		doc.parts.push(part);
		// replaceRegion requires the region to already own VH 0; this fixture tests connection cleanup, not region population.
		addLatticeVh(part, 0, 0);
		const activeRegion = part.getDefaultRegion();

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => activeRegion,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('active');
		expect(plugin.errorMessage).toBeNull();
		const applied = JSON.parse(coordinator.pendingApply!.primaryArtifact!) as {
			vstrands: { num: number; scaf: number[][] }[];
		};
		const vh0 = applied.vstrands.find((vs) => vs.num === 0)!;
		// The phantom pointer is gone in what Apply will actually use...
		expect(vh0.scaf[2]).toEqual([0, 1, -1, -1]);
		// ...while the raw result the plugin returned is untouched (nothing mutated in place).
		expect(rawArtifact.vstrands[0].scaf[2]).toEqual([0, 1, 0, 10]);
	});

	it('Design verification rejects a result that passes Result validation but cannot be safely reconstructed, leaving the real document and undo history untouched', async () => {
		// Result validation only checks a segment's slots against its own interval, never against the VH's length — only Design verification's bounds check catches this.
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'out-of-bounds-segment',
			name: 'Out Of Bounds Segment',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const doc = new FoldnanoDocument('doc-design-verification', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		doc.parts.push(part);
		const beforeJson = JSON.stringify(doc.toJSON());
		const historyStack = createHistory(doc);

		const resultJson = JSON.parse(JSON.stringify(part.toJSON()));
		const seg = resultJson.oligos[0].segments[0];
		const overIndex = vh.length + 5;
		seg.threePrime.index = overIndex;
		seg.slots = Array.from({ length: overIndex - seg.fivePrime.index + 1 }, (_, i) => ({
			bpIndex: seg.fivePrime.index + i,
			seq: 'A',
		}));
		// Delete "sequence" (optional) so only Design verification's bounds check rejects this, not Result validation's separate sequence-vs-slots check.
		delete seg.sequence;

		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(resultJson),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			() => historyStack,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/Design verification/);
		expect(coordinator.pendingApply).toBeNull();
		// Design verification only ever builds a detached scratch Part, never assigned to doc.parts and never wrapped in snapshotTx.
		expect(JSON.stringify(doc.toJSON())).toBe(beforeJson);
		expect(historyStack.numberOfUndos).toBe(0);
		expect(historyStack.numberOfRedos).toBe(0);
	});

	// 42 bases so the importer's Honeycomb lattice check (numBases % 21 === 0) accepts it.
	function makeEmptyHoneycombVstrand(num: number) {
		const length = 42;
		return {
			row: 0,
			col: 0,
			num,
			scaf: Array.from({ length }, () => [-1, -1, -1, -1]),
			stap: Array.from({ length }, () => [-1, -1, -1, -1]),
			loop: new Array(length).fill(0),
			skip: new Array(length).fill(0),
		};
	}

	it("accepts a replaceRegion result that keeps the region's original VH index, reaching pendingApply", async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-same-index',
			name: 'Region Same Index',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const doc = new FoldnanoDocument('doc-vh-index-set-accept', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		addLatticeVh(part, 0, 0);
		doc.parts.push(part);
		const activeRegion = part.getDefaultRegion();

		const resultArtifact = { name: 'Region Result', vstrands: [makeEmptyHoneycombVstrand(0)] };
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(resultArtifact),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => activeRegion,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('active');
		expect(plugin.errorMessage).toBeNull();
		expect(coordinator.pendingApply).not.toBeNull();
	});

	it('rejects a replaceRegion result whose vstrand indices differ from the region, leaving pendingApply empty and the live document unchanged', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-reindex',
			name: 'Region Reindex',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const doc = new FoldnanoDocument('doc-vh-index-set', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		addLatticeVh(part, 0, 0);
		doc.parts.push(part);
		const activeRegion = part.getDefaultRegion();
		const beforeJson = JSON.stringify(doc.toJSON());

		// Same fixture as the accepted case above, differing only in vstrand.num — isolates the index-set change as the sole rejection reason.
		const resultArtifact = { name: 'Region Result', vstrands: [makeEmptyHoneycombVstrand(1)] };
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(resultArtifact),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => activeRegion,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/virtual helix indices do not match/i);
		expect(coordinator.pendingApply).toBeNull();
		expect(JSON.stringify(doc.toJSON())).toBe(beforeJson);
	});

	it('summarizes a plain replaceRegion result as a region replacement, not a whole-part oligo count', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-preview-wording',
			name: 'Region Preview Wording',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const doc = new FoldnanoDocument('doc-preview-wording', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		const vh = addLatticeVh(part, 0, 0);
		part.createOligo(vh, 0, 5, '#000000');
		// A second region's oligo makes the whole part's oligo count (2) differ from the returned region's.
		const plane2 = new Plane('Plane 2');
		part.addPlane(plane2);
		const region2 = new HoneycombRegion('Region 2', plane2.id);
		part.addRegion(region2);
		const vh2 = region2.addVhAtCoords(part, 0, 0);
		part.createOligo(vh2, 0, 5, '#000000');
		doc.parts.push(part);
		const activeRegion = part.getDefaultRegion();

		const resultArtifact = { name: 'Empty Region', vstrands: [makeEmptyHoneycombVstrand(0)] };
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(resultArtifact),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => activeRegion,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);

		expect(plugin.status).toBe('active');
		expect(coordinator.pendingApply?.summary).toBe('replaceRegion — region replaced');
		expect(coordinator.pendingApply?.summary).not.toMatch(/KeepAnnotations/);
		expect(coordinator.pendingApply?.summary).not.toMatch(/\d+ oligos?/);
	});

	it('confirmApply refuses while another tab owns the document and keeps the result for later', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'apply-read-only',
			name: 'Apply Read Only',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(makeHoneycombPart('From Plugin').toJSON()),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-apply-read-only', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));
		const historyStack = createHistory(doc);

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			() => historyStack,
			() => null,
			(() => bridge) as never
		);
		let isTabOwner = false;
		coordinator.setEditGate(() => isTabOwner);

		// Running is still allowed in a read-only tab; only applying is gated.
		await coordinator.run(manifest.id);
		expect(coordinator.pendingApply?.pluginId).toBe(manifest.id);

		coordinator.confirmApply(manifest.id);
		expect(doc.parts[0].name).toBe('Original Part');
		expect(historyStack.numberOfUndos).toBe(0);
		expect(coordinator.pendingApply?.pluginId).toBe(manifest.id);

		isTabOwner = true;
		coordinator.confirmApply(manifest.id);
		expect(doc.parts[0].name).toBe('From Plugin');
		expect(coordinator.pendingApply).toBeNull();
	});

	it('confirmApply actually calls applyResult and records an undo entry when a real history stack is wired', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'apply-success',
			name: 'Apply Success',
			version: '1.0.0',
			format: 'foldnano_json',
			applyStrategy: 'replacePart',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(makeHoneycombPart('From Plugin').toJSON()),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const doc = new FoldnanoDocument('doc-apply-success', 'Plugin Doc');
		const originalPart = makeHoneycombPart('Original Part');
		doc.parts.push(originalPart);
		const historyStack = createHistory(doc);

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			() => historyStack,
			() => null,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);
		coordinator.confirmApply(manifest.id);

		expect(coordinator.pendingApply).toBeNull();
		expect(plugin.status).toBe('active');
		expect(doc.parts[0].name).toBe('From Plugin');
		expect(historyStack.numberOfUndos).toBe(1);
	});

	it('confirmApply reports a visible PluginApplyError when applyResult rejects its own precondition before any mutation is attempted', async () => {
		const manifest: PluginManifest = {
			schemaVersion: 1,
			id: 'region-apply-fails',
			name: 'Region Apply Fails',
			version: '1.0.0',
			format: 'cadnano_json',
			applyStrategy: 'replaceRegion',
			entrypoint: 'def run(ctx): pass',
		};
		const plugin = makePlugin(manifest);
		const registry = {
			get: vi.fn((id: string) => (id === manifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;

		const doc = new FoldnanoDocument('doc-apply-fails', 'Plugin Doc');
		const part = makeHoneycombPart('Original Part');
		addLatticeVh(part, 0, 0);
		doc.parts.push(part);
		const activeRegion = part.getDefaultRegion();
		const beforeJson = JSON.stringify(doc.toJSON());
		const historyStack = createHistory(doc);

		const resultArtifact = { name: 'Region Result', vstrands: [makeEmptyHoneycombVstrand(0)] };
		const bridge = {
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: JSON.stringify(resultArtifact),
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};

		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			() => historyStack,
			() => activeRegion,
			(() => bridge) as never
		);

		await coordinator.run(manifest.id);
		expect(coordinator.pendingApply).not.toBeNull();

		// Throws before historyStack.snapshotTx is entered, so this proves the catch, not rollback.
		coordinator.pendingApply!.activeRegionId = null;
		plugin.errorTraceback = 'stale python traceback';
		reportErrorMock.mockClear();

		coordinator.confirmApply(manifest.id);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/no active region was recorded/i);
		expect(plugin.errorTraceback).toBeNull();
		expect(coordinator.pendingApply).toBeNull();
		expect(JSON.stringify(doc.toJSON())).toBe(beforeJson);
		expect(reportErrorMock).toHaveBeenCalledTimes(1);
		expect(reportErrorMock).toHaveBeenCalledWith(expect.any(Error), 'plugin:apply', {
			notify: false,
		});
	});
});

// ---------------------------------------------------------------------------
// Two-tier worker model (standard / custom environments)
// ---------------------------------------------------------------------------

/** Runtime-code manifests skip the packaged-zip cache, so activate() succeeds
 *  in tests without IndexedDB. Env tier is driven purely by `requirements`. */
function runtimeCodeManifest(id: string, requirements?: string[]): PluginManifest {
	return {
		schemaVersion: 1,
		id,
		name: id,
		version: '1.0.0',
		format: 'foldnano_mini',
		applyStrategy: 'previewOnly',
		entrypoint: 'def run(ctx): pass',
		sidePanel: { type: 'codeEditor', codeEditor: { execution: 'entrypoint' } },
		...(requirements ? { requirements } : {}),
	};
}

function makeMockBridge() {
	return {
		initRuntime: vi.fn().mockResolvedValue(undefined),
		installPlugin: vi.fn().mockResolvedValue(undefined),
		runPlugin: vi.fn().mockResolvedValue({
			logs: [],
			artifacts: {},
			pluginResult: null,
			primaryArtifact: null,
			mutationLog: null,
		}),
		terminate: vi.fn(),
	};
}

function makeRegistry(plugins: PythonPlugin[]) {
	const map = new Map(plugins.map((p) => [p.manifest.id, p]));
	return { plugins: map, get: (id: string) => map.get(id), hasReservation: () => false };
}

function makeTieredCoordinator(plugins: PythonPlugin[]) {
	const bridges: ReturnType<typeof makeMockBridge>[] = [];
	const factory = () => {
		const bridge = makeMockBridge();
		bridges.push(bridge);
		return bridge;
	};
	const registry = makeRegistry(plugins);
	const coordinator = new PluginCoordinator(
		registry as never,
		undefined,
		undefined,
		undefined,
		factory as never
	);
	return { coordinator, bridges, registry };
}

describe('PluginCoordinator two-tier environments', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('shares one worker across standard-tier plugins', async () => {
		const a = makePlugin(runtimeCodeManifest('std-a', ['numpy']));
		const b = makePlugin(runtimeCodeManifest('std-b', ['pandas']));
		const { coordinator, bridges } = makeTieredCoordinator([a, b]);

		await coordinator.activate('std-a');
		await coordinator.activate('std-b');

		expect(bridges).toHaveLength(1);
		expect(bridges[0].installPlugin).toHaveBeenCalledTimes(2);
		expect(a.status).toBe('active');
		expect(b.status).toBe('active');
	});

	it('routes custom-tier plugins to a separate worker', async () => {
		const std = makePlugin(runtimeCodeManifest('std', ['numpy']));
		const custom = makePlugin(runtimeCodeManifest('custom', ['numpy==1.26.4']));
		const { coordinator, bridges } = makeTieredCoordinator([std, custom]);

		await coordinator.activate('std');
		await coordinator.activate('custom');

		expect(bridges).toHaveLength(2);
		expect(std.status).toBe('active');
		expect(custom.status).toBe('active');
	});

	it('evicts an idle custom-slot owner when another custom plugin activates', async () => {
		const a = makePlugin(runtimeCodeManifest('custom-a', ['numpy==1.0']));
		const b = makePlugin(runtimeCodeManifest('custom-b', ['pandas==2.0']));
		const { coordinator, bridges } = makeTieredCoordinator([a, b]);

		await coordinator.activate('custom-a');
		expect(a.status).toBe('active');

		await coordinator.activate('custom-b');

		expect(a.status).toBe('registered');
		expect(bridges[0].terminate).toHaveBeenCalled();
		expect(b.status).toBe('active');
		expect(bridges).toHaveLength(2);
	});

	it('reuses the warm custom environment when the same plugin re-activates', async () => {
		const a = makePlugin(runtimeCodeManifest('custom-a', ['numpy==1.0']));
		const { coordinator, bridges } = makeTieredCoordinator([a]);

		await coordinator.activate('custom-a');
		await coordinator.activate('custom-a');

		expect(bridges).toHaveLength(1);
		expect(bridges[0].terminate).not.toHaveBeenCalled();
		expect(coordinator.getActivationImpact('custom-a').requiresConfirmation).toBe(false);
	});

	it('reports activation impact for a busy custom-slot owner', async () => {
		const a = makePlugin(runtimeCodeManifest('custom-a', ['numpy==1.0']));
		const b = makePlugin(runtimeCodeManifest('custom-b', ['pandas==2.0']));
		const std = makePlugin(runtimeCodeManifest('std', ['numpy']));
		const { coordinator } = makeTieredCoordinator([a, b, std]);

		await coordinator.activate('custom-a');

		// Idle-active owner: eviction happens, but silently (toast, no dialog).
		let impact = coordinator.getActivationImpact('custom-b');
		expect(impact.requiresConfirmation).toBe(false);
		expect(impact.evictedPluginIds).toEqual(['custom-a']);

		// Running owner: destructive — must confirm.
		a.status = 'running';
		impact = coordinator.getActivationImpact('custom-b');
		expect(impact.requiresConfirmation).toBe(true);
		expect(impact.runningPluginId).toBe('custom-a');

		// Unapplied result: destructive — must confirm.
		a.status = 'active';
		coordinator.pendingApply = { pluginId: 'custom-a' } as never;
		impact = coordinator.getActivationImpact('custom-b');
		expect(impact.requiresConfirmation).toBe(true);
		expect(impact.pendingApplyPluginId).toBe('custom-a');
		coordinator.pendingApply = null;

		// Standard-tier activations never evict the custom slot.
		expect(coordinator.getActivationImpact('std').evictedPluginIds).toEqual([]);
	});

	it('scopes stopPlugin to the plugin’s own worker', async () => {
		const std = makePlugin(runtimeCodeManifest('std', ['numpy']));
		const custom = makePlugin(runtimeCodeManifest('custom', ['numpy==1.0']));
		const { coordinator, bridges } = makeTieredCoordinator([std, custom]);

		await coordinator.activate('std');
		await coordinator.activate('custom');
		custom.status = 'running';

		coordinator.stopPlugin('custom');

		expect(bridges[1].terminate).toHaveBeenCalled();
		expect(bridges[0].terminate).not.toHaveBeenCalled();
		expect(std.status).toBe('active');
	});

	it('routes a plugin that declares network access to the custom worker', async () => {
		const std = makePlugin(runtimeCodeManifest('std', ['numpy']));
		const net = makePlugin({
			...runtimeCodeManifest('net', ['numpy']),
			network: ['api.example.org'],
		});
		const { coordinator, bridges } = makeTieredCoordinator([std, net]);

		await coordinator.activate('std');
		await coordinator.activate('net');

		expect(bridges).toHaveLength(2);
		expect(bridges[0].terminate).not.toHaveBeenCalled();
	});

	it('restarts the custom worker when the owner’s network policy changes', async () => {
		const net = makePlugin({ ...runtimeCodeManifest('net'), network: ['api.example.org'] });
		const { coordinator, bridges } = makeTieredCoordinator([net]);

		await coordinator.activate('net');
		// Same id and version, different sandbox CSP: the warm worker can't be reused.
		net.manifest = { ...net.manifest, network: ['other.example.org'] };
		expect(coordinator.getActivationImpact('net').evictedPluginIds).toEqual(['net']);
		await coordinator.activate('net');

		expect(bridges).toHaveLength(2);
		expect(bridges[0].terminate).toHaveBeenCalled();
		expect(net.status).toBe('active');
	});

	it('refuses to fetch an external wheel named by a manifest stored before validation', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('location', { origin: 'http://localhost:3000', href: 'http://localhost:3000/' });

		const plugin = makePlugin(runtimeCodeManifest('ext', ['https://evil.example/pkg.whl']));
		const { coordinator } = makeTieredCoordinator([plugin]);

		await coordinator.activate('ext').catch(() => {});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toMatch(/not served by Foldnano/);
	});

	it('resolves standard extras to their pinned wheel URL at activation', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			arrayBuffer: async () => new ArrayBuffer(8),
		});
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('location', {
			origin: 'http://localhost:3000',
			href: 'http://localhost:3000/editor',
		});

		const plugin = makePlugin(runtimeCodeManifest('extras', ['cadnano2_5_mini', 'numpy']));
		const { coordinator, bridges } = makeTieredCoordinator([plugin]);

		await coordinator.activate('extras');

		expect(fetchMock).toHaveBeenCalledWith(
			'http://localhost:3000/plugins/cadnano_mini/v0.1.0/cadnano2_5_mini-0.1.0-py3-none-any.whl'
		);
		expect(bridges).toHaveLength(1); // extras keep the plugin standard-tier
		expect(bridges[0].installPlugin).toHaveBeenCalledWith(
			'extras',
			['numpy'],
			[
				expect.objectContaining({
					filename: 'cadnano2_5_mini-0.1.0-py3-none-any.whl',
				}),
			]
		);
	});

	it('rejects a run on a part-less document without stranding the plugin in running', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const emptyDoc = new FoldnanoDocument('doc-empty', 'Empty Doc'); // no region → no parts
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => emptyDoc,
			undefined,
			() => null,
			(() => makeMockBridge()) as never
		);

		await expect(coordinator.run('std')).rejects.toThrow(/requires an open design/);
		expect(plugin.status).toBe('active');
	});

	it('stamps run logs with the environment label', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const doc = new FoldnanoDocument('doc-env', 'Env Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => doc,
			undefined,
			() => null,
			(() => makeMockBridge()) as never
		);

		await coordinator.run('std');

		expect(plugin.logs[0]).toMatch(/^\[env\] pyodide-\d+\.\d+\.\d+ · standard$/);
	});

	it('preserves the environment stamp and pre-crash logs when a run rejects', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const doc = new FoldnanoDocument('doc-env-crash', 'Env Crash Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const crashError = new Error('boom') as Error & { traceback: string; logs: string[] };
		crashError.traceback = 'Traceback (most recent call last):\n  ...\nRuntimeError: boom';
		crashError.logs = ['before crash'];
		const bridge = makeMockBridge();
		bridge.runPlugin = vi.fn().mockRejectedValue(crashError);
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await expect(coordinator.run('std')).rejects.toThrow('boom');

		expect(plugin.logs[0]).toMatch(/^\[env\] pyodide-\d+\.\d+\.\d+ · standard$/);
		expect(plugin.logs.slice(1)).toEqual(['before crash']);
		expect(plugin.errorTraceback).toBe(crashError.traceback);
	});

	it('never leaves a failed run without a visible reason when the error message is empty', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const doc = new FoldnanoDocument('doc-empty-error', 'Empty Error Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const crashError = new Error('') as Error & { traceback: string; logs: string[] };
		crashError.traceback = 'Traceback (most recent call last):\n  ...\nAssertionError';
		crashError.logs = [];
		const bridge = makeMockBridge();
		bridge.runPlugin = vi.fn().mockRejectedValue(crashError);
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await expect(coordinator.run('std')).rejects.toBe(crashError);

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toBe(RUN_FAILED_WITHOUT_MESSAGE);
		expect(plugin.errorTraceback).toBe(crashError.traceback);
	});

	it('shows where a failure outside the plugin Python code happened when there is no traceback', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const doc = new FoldnanoDocument('doc-js-error', 'JS Error Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const hostError = new Error('worker crashed');
		const bridge = makeMockBridge();
		bridge.runPlugin = vi.fn().mockRejectedValue(hostError);
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(coordinator.run('std')).rejects.toBe(hostError);

		expect(plugin.errorMessage).toBe('worker crashed');
		expect(plugin.errorTraceback).toBe(hostError.stack);
	});

	it('ignores malformed logs on a crash rather than replacing the original error', async () => {
		const plugin = makePlugin(runtimeCodeManifest('std'));
		const doc = new FoldnanoDocument('doc-env-malformed-logs', 'Env Malformed Logs Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const crashError = new Error('boom') as Error & { traceback: string; logs: unknown };
		crashError.traceback = 'Traceback (most recent call last):\n  ...\nRuntimeError: boom';
		crashError.logs = [123]; // malformed: an array, but not of strings
		const bridge = makeMockBridge();
		bridge.runPlugin = vi.fn().mockRejectedValue(crashError);
		const coordinator = new PluginCoordinator(
			makeRegistry([plugin]) as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);

		await expect(coordinator.run('std')).rejects.toThrow('boom');

		expect(plugin.status).toBe('error');
		expect(plugin.errorMessage).toBe('boom');
		expect(plugin.errorTraceback).toBe(crashError.traceback);
		// Malformed logs are ignored; the pre-run environment stamp is left as-is.
		expect(plugin.logs).toEqual([
			expect.stringMatching(/^\[env\] pyodide-\d+\.\d+\.\d+ · standard$/),
		]);
	});
});

function makePendingApply(pluginId: string, manifest: PluginManifest): PendingApply {
	return {
		pluginId,
		docId: 'doc-test',
		partFingerprint: null,
		manifest,
		primaryArtifact: null,
		mutationLog: null,
		preRunFoldnanoSnapshot: null,
		summary: 'test summary',
		activeRegionId: null,
		resultToken: 'test-token',
	};
}

describe('PluginCoordinator busy/reservation guard', () => {
	it('reports busy for a running or activating plugin, and for one with a pending apply', () => {
		const running = makePlugin(runtimeCodeManifest('running-plugin'));
		running.status = 'running';
		const activating = makePlugin(runtimeCodeManifest('activating-plugin'));
		activating.status = 'activating';
		const idle = makePlugin(runtimeCodeManifest('idle-plugin'));
		const { coordinator } = makeTieredCoordinator([running, activating, idle]);

		expect(coordinator.isPluginBusyOrPending('running-plugin')).toEqual({
			busy: true,
			reason: 'currently running',
		});
		expect(coordinator.isPluginBusyOrPending('activating-plugin')).toEqual({
			busy: true,
			reason: 'currently activating',
		});
		expect(coordinator.isPluginBusyOrPending('idle-plugin')).toEqual({ busy: false });

		coordinator.pendingApply = makePendingApply('idle-plugin', idle.manifest);
		expect(coordinator.isPluginBusyOrPending('idle-plugin')).toEqual({
			busy: true,
			reason: 'it has an unapplied result. Apply or discard it first',
		});
	});
});

describe('PluginCoordinator reservation window (real PluginRegistry + PluginCoordinator)', () => {
	const isolatedDbs: FoldnanoIndexedDb[] = [];

	afterEach(async () => {
		for (const db of isolatedDbs.splice(0)) {
			db.close();
			await db.delete();
		}
	});

	async function freshWiredPair(): Promise<{
		db: FoldnanoIndexedDb;
		registry: PluginRegistry;
		coordinator: PluginCoordinator;
	}> {
		const db = new FoldnanoIndexedDb(`test-coordinator-reservation-${crypto.randomUUID()}`);
		isolatedDbs.push(db);
		const registry = new PluginRegistry(db);
		const coordinator = new PluginCoordinator(registry);
		registry.setBusyCheck((id) => coordinator.isPluginBusyOrPending(id));
		await registry.ready;
		return { db, registry, coordinator };
	}

	function deferredWrite() {
		let resolve!: () => void;
		let reject!: (reason: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	}

	// Use an existing plugin so activate()/run() would otherwise proceed without the reservation guard.
	it('blocks activation and runs while a replaceConfirmed persistence write is in flight, and clears on success', async () => {
		const { db, registry, coordinator } = await freshWiredPair();
		const original: PluginManifest = {
			...runtimeCodeManifest('reserved-plugin'),
			version: '1.0.0',
		};
		await registry.registerNew(original, null);

		const write = deferredWrite();
		vi.spyOn(db, 'saveInstalledPlugin').mockReturnValue(write.promise);

		const replacement: PluginManifest = {
			...runtimeCodeManifest('reserved-plugin'),
			version: '2.0.0',
		};
		const replacePromise = registry.replaceConfirmed(replacement, null);

		expect(registry.get('reserved-plugin')?.manifest.version).toBe('1.0.0');
		expect(registry.hasReservation('reserved-plugin')).toBe(true);
		await expect(coordinator.activate('reserved-plugin')).rejects.toThrow(
			/plugin installation or replacement is currently in progress/
		);
		await expect(coordinator.run('reserved-plugin')).rejects.toThrow(
			/plugin installation or replacement is currently in progress/
		);

		write.resolve();
		await replacePromise;

		expect(registry.hasReservation('reserved-plugin')).toBe(false);
		expect(registry.get('reserved-plugin')?.manifest.version).toBe('2.0.0');
	});

	it('clears the reservation via finally when the persistence write rejects, leaving the original plugin unchanged', async () => {
		const { db, registry } = await freshWiredPair();
		const original: PluginManifest = {
			...runtimeCodeManifest('reserved-plugin-2'),
			version: '1.0.0',
		};
		await registry.registerNew(original, null);

		const write = deferredWrite();
		vi.spyOn(db, 'saveInstalledPlugin').mockReturnValue(write.promise);

		const replacement: PluginManifest = {
			...runtimeCodeManifest('reserved-plugin-2'),
			version: '2.0.0',
		};
		const replacePromise = registry.replaceConfirmed(replacement, null);
		expect(registry.hasReservation('reserved-plugin-2')).toBe(true);

		write.reject(new Error('simulated failure'));
		await expect(replacePromise).rejects.toThrow('simulated failure');

		expect(registry.hasReservation('reserved-plugin-2')).toBe(false);
		expect(registry.get('reserved-plugin-2')?.manifest.version).toBe('1.0.0');
	});
});

describe('PluginCoordinator run timeout', () => {
	it('terminates the worker and requires re-activation', async () => {
		const slow = makePlugin(runtimeCodeManifest('slow', ['numpy']));
		const mate = makePlugin(runtimeCodeManifest('mate', ['numpy']));
		const doc = new FoldnanoDocument('doc-timeout', 'Timeout Doc');
		doc.parts.push(makeHoneycombPart('Part'));
		const bridges: ReturnType<typeof makeMockBridge>[] = [];
		const coordinator = new PluginCoordinator(
			makeRegistry([slow, mate]) as never,
			() => doc,
			undefined,
			() => null,
			(() => {
				const bridge = makeMockBridge();
				bridge.runPlugin.mockRejectedValue(new RunTimeoutError('The plugin run timed out'));
				bridges.push(bridge);
				return bridge;
			}) as never
		);

		await coordinator.activate('slow');
		await coordinator.activate('mate');
		await expect(coordinator.run('slow')).rejects.toBeInstanceOf(RunTimeoutError);

		expect(bridges[0].terminate).toHaveBeenCalledOnce();
		expect(slow.status).toBe('error');
		expect(slow.errorMessage).toMatch(/timed out/);
		// The Run button must not come back without a fresh environment.
		expect(slow.resolvedCode).toBeNull();
		// The shared standard worker died, so its other tenants must re-activate too.
		expect(mate.status).toBe('registered');

		await coordinator.activate('slow');
		expect(bridges).toHaveLength(2);
	});
});

describe('PluginCoordinator owned-plugin drafts', () => {
	const ownedManifest: PluginManifest = {
		schemaVersion: 1,
		id: 'local.abc12345',
		name: 'Mine',
		version: '1.0.0',
		format: 'foldnano_mini',
		applyStrategy: 'replayMutationLog',
	};
	const DRAFT = 'import numpy\n\ndef run(ctx):\n    ctx.log("draft")\n';

	function setup(owned: boolean) {
		const plugin = makePlugin(ownedManifest);
		plugin.resolvedCode = null;
		plugin.resolvedZipData = new ArrayBuffer(8);
		plugin.authoring = owned ? { source: 'scriptLab' } : null;
		const registry = {
			get: vi.fn((id: string) => (id === ownedManifest.id ? plugin : undefined)),
			hasReservation: () => false,
		} as const;
		const bridge = {
			initRuntime: vi.fn().mockResolvedValue(undefined),
			resolveImports: vi.fn().mockResolvedValue(['numpy']),
			runPlugin: vi.fn().mockResolvedValue({
				logs: [],
				artifacts: {},
				pluginResult: null,
				primaryArtifact: null,
				mutationLog: null,
			}),
			terminate: vi.fn(),
		};
		const doc = new FoldnanoDocument('doc-plugin', 'Plugin Doc');
		doc.parts.push(makeHoneycombPart('Original Part'));
		const coordinator = new PluginCoordinator(
			registry as never,
			() => doc,
			undefined,
			() => null,
			(() => bridge) as never
		);
		return { plugin, bridge, coordinator };
	}

	it('runs a draft as the plugin: a zip of the draft, scanned for imports', async () => {
		const { bridge, coordinator } = setup(true);
		await coordinator.runWithOptions(ownedManifest.id, { draftCode: DRAFT });

		const sent = bridge.runPlugin.mock.calls[0][0] as {
			pluginCode: string;
			pluginZipData: ArrayBuffer;
			loadImports: boolean;
		};
		expect(sent.pluginCode).toBe(DRAFT);
		expect(sent.loadImports).toBe(true);
		const { unzipSync, strFromU8 } = await import('fflate');
		const files = unzipSync(new Uint8Array(sent.pluginZipData));
		expect(strFromU8(files['plugin.py'])).toBe(DRAFT);
		expect(JSON.parse(strFromU8(files['fplugin.json'])).id).toBe(ownedManifest.id);
	});

	it('keeps the icon in a draft zip of a plugin that has one', async () => {
		const { bridge, coordinator, plugin } = setup(true);
		const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>';
		plugin.manifest = { ...ownedManifest, schemaVersion: 2, icon: 'icon.svg' };
		plugin.iconSvg = icon;
		await coordinator.runWithOptions(ownedManifest.id, { draftCode: DRAFT });

		const sent = bridge.runPlugin.mock.calls[0][0] as { pluginZipData: ArrayBuffer };
		const { unzipSync, strFromU8 } = await import('fflate');
		const files = unzipSync(new Uint8Array(sent.pluginZipData));
		expect(strFromU8(files['icon.svg'])).toBe(icon);
	});

	it('runs the saved zip without scanning imports when there is no draft', async () => {
		const { bridge, coordinator, plugin } = setup(true);
		await coordinator.run(ownedManifest.id);
		expect(bridge.runPlugin).toHaveBeenCalledWith(
			expect.objectContaining({ pluginZipData: plugin.resolvedZipData, loadImports: false })
		);
	});

	it('refuses a draft run for a plugin not made in this browser', async () => {
		const { bridge, coordinator } = setup(false);
		await expect(
			coordinator.runWithOptions(ownedManifest.id, { draftCode: DRAFT })
		).rejects.toThrow(/not made in this browser/);
		expect(bridge.runPlugin).not.toHaveBeenCalled();
	});

	it('resolves script requirements on the standard worker', async () => {
		const { bridge, coordinator } = setup(true);
		await expect(coordinator.resolveScriptRequirements(DRAFT)).resolves.toEqual(['numpy']);
		expect(bridge.initRuntime).toHaveBeenCalled();
		expect(bridge.resolveImports).toHaveBeenCalledWith(expect.any(String), DRAFT);
	});
});
