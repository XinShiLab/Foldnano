import { checkCadnanoProfile, type CadnanoProfileIssue } from '$lib/model/checks/cadnano';
import { MAX_WHEEL_BYTES, readResponseCapped } from './sizeLimits';
import type { PluginRegistry } from './PluginRegistry.svelte';
import { classifyManifest, isSameOriginUrl } from './manifestValidation';
import { classifyEnv, STANDARD_ENV_EXTRAS } from './envClassification';
import { PYODIDE_VERSION } from './worker/pyodideConfig';
import type { PluginManifest, PluginSidePanelInput, PythonPlugin } from './types';
import { PyodideWorkerBridge, RunTimeoutError } from './worker/bridge';
import { buildSandboxCsp, SandboxedWorker } from './worker/sandboxHost';
import { connectSourcesFor } from './networkPolicy';
import { CadnanoJSON } from '$lib/model/io/cadnanoJSON';
import type FoldnanoDocument from '$lib/model/document.svelte';
import type { HistoryStack } from '$lib/commands/history.svelte';
import { applyResult } from './ResultApplicator';
import type { MutationOp } from './opDispatch';
import { LatticedDesignRegion, type DesignRegion } from '$lib/model/Part/DesignRegion';
import { foldnanoIndexedDb } from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';
import { reportError } from '$lib/errorReporting';
import { PluginApplyError, PluginValidationError } from './plugin-result-errors';
import { validateResultShape as validateCadnanoResultShape } from './result-format-validation-cadnano-json';
import { validateResultShape as validateFoldnanoResultShape } from './result-format-validation-foldnano-json';
import { verifyDesign, type DesignVerificationInput } from './design-verification';
import { buildPluginZip } from './ownedPlugins';
import type { PartJSON } from './result-replacement-operations';
import type { LinkedFolderRead } from './linkedPluginFolder';

/** Shown the cadnano export issues of a cadnano_json plugin's input; resolves whether to run. */
export type CadnanoInputReviewer = (
	pluginName: string,
	issues: readonly CadnanoProfileIssue[]
) => Promise<boolean>;

/** Reads a linked plugin's folder (dev mode), asking for access when needed. */
export type LinkedFolderReader = (plugin: PythonPlugin) => Promise<LinkedFolderRead>;

export const RUN_FAILED_WITHOUT_MESSAGE =
	'The plugin run failed without an error message. See the traceback and log below.';

// Snapshot type used by pendingApply (mirrors PartJSON in ResultApplicator)
type PartSnapshot = { oligos: unknown[] } & Record<string, unknown>;

export type PendingApply = {
	pluginId: string;
	docId: string;
	partFingerprint: string | null;
	manifest: PluginManifest;
	/** Present for replacePart* / replaceRegion* strategies; null for replayMutationLog* */
	primaryArtifact: string | null;
	/** Present for replayMutationLog* strategies; null otherwise */
	mutationLog: MutationOp[] | null;
	preRunFoldnanoSnapshot: PartSnapshot | null;
	summary: string;
	activeRegionId: string | null;
	resultToken: string;
};

/**
 * What activating a plugin would do to the currently resident custom-slot
 * owner. Drives the confirmation dialog / eviction toast in the UI.
 */
export type ActivationImpact = {
	/** Custom-slot owner whose in-flight run or activation would be aborted. */
	runningPluginId: string | null;
	/** Plugin whose unapplied (pending) result would be discarded. */
	pendingApplyPluginId: string | null;
	/** Copied from pendingApply.resultToken when pendingApplyPluginId is set; never minted here. */
	pendingResultToken: string | null;
	/** Plugins that would be reset to 'registered' by this activation. */
	evictedPluginIds: string[];
	/** True when the eviction destroys work in progress — ask the user first. */
	requiresConfirmation: boolean;
};

/**
 * Coordinates plugin lifecycle: activate → run → deactivate.
 *
 * Two-tier worker model (docs/python-plugin-system.md § Environment tiers):
 *   - Standard-tier plugins (requirements fully determined by the pinned
 *     Pyodide distribution + standard extras) share one persistent worker.
 *   - Custom-tier plugins get a single worker slot with single-active
 *     eviction semantics — activating custom plugin B evicts custom plugin A.
 * The runtime is lazy — Pyodide is not loaded until the first activation.
 */
export class PluginCoordinator {
	private registry: PluginRegistry;
	private bridgeFactory: (() => PyodideWorkerBridge) | undefined;
	private standardBridge: PyodideWorkerBridge | null = null;
	private customSlot: {
		bridge: PyodideWorkerBridge;
		envOwner: { pluginId: string; version: string; csp: string };
	} | null = null;
	/** Dev mode: the worker of the active linked plugin, rebuilt whenever its environment changes. */
	private devSlot: {
		bridge: PyodideWorkerBridge;
		envOwner: { pluginId: string; envFingerprint: string; csp: string };
	} | null = null;
	private getDoc: (() => FoldnanoDocument) | undefined;
	private getHistory: (() => HistoryStack) | undefined;
	private getActiveRegion: (() => DesignRegion | null) | undefined;
	/** False while another tab owns the document; see setEditGate. */
	private canEditDoc: () => boolean = () => true;
	/** Asks whether to run a cadnano_json plugin on input the export can't write faithfully. */
	private reviewCadnanoInput: CadnanoInputReviewer | undefined;

	/** Result awaiting user confirmation before being applied to the model. */
	pendingApply: PendingApply | null = $state(null);

	/** Plugins whose worker was deliberately terminated (user stop or custom-slot
	 *  eviction) — lets catch blocks distinguish that from a genuine error.
	 *  Non-reactive bookkeeping; the UI never reads it. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	private _stoppedPluginIds = new Set<string>();

	private readLinkedFolder: LinkedFolderReader | undefined;
	/** Environment each linked plugin was activated with (`envFingerprint`). */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive bookkeeping
	private _linkedEnvFingerprints = new Map<string, string>();
	/** Linked plugins whose folder is being read for a run, so a double click can't start two. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive bookkeeping
	private _linkedRunReads = new Set<string>();
	/** Bumped when dev mode drops the dev worker; a linked activation or run that sees it change
	 *  while awaiting its folder read is cancelled. */
	private _devEpoch = 0;

	private _nextResultToken = 0;
	private _mintResultToken(): string {
		return String(this._nextResultToken++);
	}

	constructor(
		registry: PluginRegistry,
		getDoc?: () => FoldnanoDocument,
		getHistory?: () => HistoryStack,
		getActiveRegion?: () => DesignRegion | null,
		bridgeFactory?: () => PyodideWorkerBridge
	) {
		this.registry = registry;
		this.getDoc = getDoc;
		this.getHistory = getHistory;
		this.getActiveRegion = getActiveRegion;
		this.bridgeFactory = bridgeFactory;
	}

	/**
	 * Gate applying results on document ownership (the editor passes `isTabOwner`). Runs stay
	 * allowed: they don't touch the design, and read-only tabs may still use analysis plugins.
	 */
	setCadnanoInputReviewer(review: CadnanoInputReviewer): void {
		this.reviewCadnanoInput = review;
	}

	setEditGate(canEdit: () => boolean): void {
		this.canEditDoc = canEdit;
	}

	/** Wires plugin dev mode: how linked plugins' folders are read. */
	setLinkedFolderReader(reader: LinkedFolderReader): void {
		this.readLinkedFolder = reader;
	}

	private async readLinked(plugin: PythonPlugin): Promise<LinkedFolderRead> {
		if (!this.readLinkedFolder) throw new Error('Plugin dev mode is not available here.');
		const read = await this.readLinkedFolder(plugin);
		if (read.manifest.id !== plugin.manifest.id) {
			throw new Error(
				`The folder now declares the id "${read.manifest.id}" instead of "${plugin.manifest.id}". ` +
					'Unlink it and link the folder again to use the new id.'
			);
		}
		return read;
	}

	/** The sandbox CSP a plugin runs under: its declared network plus PyPI if needed. */
	private sandboxCspFor(plugin: PythonPlugin): string {
		return buildSandboxCsp(connectSourcesFor(plugin.manifest));
	}

	/** True when the custom slot already holds `plugin`'s warm environment. */
	private ownsCustomSlot(plugin: PythonPlugin): boolean {
		const owner = this.customSlot?.envOwner;
		return (
			owner !== undefined &&
			owner.pluginId === plugin.manifest.id &&
			owner.version === plugin.manifest.version &&
			owner.csp === this.sandboxCspFor(plugin)
		);
	}

	private makeBridge(csp: string): PyodideWorkerBridge {
		if (this.bridgeFactory) return this.bridgeFactory();
		return new PyodideWorkerBridge({
			workerFactory: () => new SandboxedWorker(csp),
			onLog: (requestId, message) => {
				// Deliver streaming log lines to the matching plugin's log array.
				// requestId is the plugin ID during a run.
				const plugin = this.registry.get(requestId);
				if (plugin) plugin.logs.push(message);
			},
		});
	}

	/**
	 * Resolve (lazily creating) the worker bridge for a plugin's env tier.
	 * Custom tier: claims the single slot; the caller must have evicted any
	 * previous owner via evictCustomSlotFor() first.
	 */
	private getStandardBridge(): PyodideWorkerBridge {
		// Standard tier is network-free by construction (see classifyEnv).
		this.standardBridge ??= this.makeBridge(buildSandboxCsp([]));
		return this.standardBridge;
	}

	/**
	 * Pyodide distribution packages that provide `code`'s imports: the `requirements` an owned
	 * plugin is packaged with, so it loads what the script loaded under Script Lab.
	 */
	async resolveScriptRequirements(code: string): Promise<string[]> {
		const bridge = this.getStandardBridge();
		await bridge.initRuntime();
		return bridge.resolveImports(`resolve-imports:${this._mintResultToken()}`, code);
	}

	private ensureBridgeFor(plugin: PythonPlugin): PyodideWorkerBridge {
		if (plugin.origin === 'linked') return this.ensureDevBridgeFor(plugin);
		if (classifyEnv(plugin.manifest) === 'standard') return this.getStandardBridge();
		if (this.customSlot && this.customSlot.envOwner.pluginId !== plugin.manifest.id) {
			throw new Error(
				`The custom plugin environment is in use by "${this.customSlot.envOwner.pluginId}" — ` +
					`activate "${plugin.manifest.name}" to take it over.`
			);
		}
		const csp = this.sandboxCspFor(plugin);
		const envOwner = { pluginId: plugin.manifest.id, version: plugin.manifest.version, csp };
		if (!this.customSlot) {
			this.customSlot = { bridge: this.makeBridge(csp), envOwner };
		} else {
			this.customSlot.envOwner = envOwner;
		}
		return this.customSlot.bridge;
	}

	/** The dev slot for a linked plugin; the caller evicted any other owner (evictDevSlotFor). */
	private ensureDevBridgeFor(plugin: PythonPlugin): PyodideWorkerBridge {
		if (this.devSlot && this.devSlot.envOwner.pluginId !== plugin.manifest.id) {
			throw new Error(
				`The dev environment is in use by "${this.devSlot.envOwner.pluginId}". ` +
					`Activate "${plugin.manifest.name}" to take it over.`
			);
		}
		const csp = this.sandboxCspFor(plugin);
		const envOwner = {
			pluginId: plugin.manifest.id,
			envFingerprint: this._linkedEnvFingerprints.get(plugin.manifest.id) ?? '',
			csp,
		};
		if (!this.devSlot) this.devSlot = { bridge: this.makeBridge(csp), envOwner };
		else this.devSlot.envOwner = envOwner;
		return this.devSlot.bridge;
	}

	/** True when the dev slot already runs `plugin` with exactly this environment. */
	private ownsDevSlot(plugin: PythonPlugin, envFingerprint: string): boolean {
		const owner = this.devSlot?.envOwner;
		return (
			owner !== undefined &&
			owner.pluginId === plugin.manifest.id &&
			owner.envFingerprint === envFingerprint &&
			owner.csp === this.sandboxCspFor(plugin)
		);
	}

	/**
	 * Free the dev slot for `plugin` unless it already holds `plugin`'s environment. Unlike the
	 * custom slot, any change of requirements, network or bundled wheels rebuilds the worker:
	 * packages can't be uninstalled from a live Pyodide and the CSP is fixed at worker start.
	 */
	private evictDevSlotFor(plugin: PythonPlugin, envFingerprint: string): void {
		const slot = this.devSlot;
		if (!slot || this.ownsDevSlot(plugin, envFingerprint)) return;
		this.devSlot = null;
		const ownerId = slot.envOwner.pluginId;
		if (ownerId !== plugin.manifest.id) this.resetEvictedOwner(ownerId);
		slot.bridge.terminate();
	}

	/** An evicted slot owner goes back to 'registered'; a run or activation in flight is a stop. */
	private resetEvictedOwner(ownerId: string): void {
		const owner = this.registry.get(ownerId);
		if (owner && (owner.status === 'running' || owner.status === 'activating')) {
			this._stoppedPluginIds.add(ownerId);
		}
		if (this.pendingApply?.pluginId === ownerId) this.pendingApply = null;
		if (
			owner &&
			(owner.status === 'active' || owner.status === 'activating' || owner.status === 'running')
		) {
			owner.status = 'registered';
			owner.errorMessage = null;
			owner.errorTraceback = null;
		}
	}

	/**
	 * Rebuild a linked plugin's dev environment from scratch (fresh worker, requirements
	 * reinstalled), e.g. after module-level state got stuck.
	 */
	async restartLinkedEnvironment(pluginId: string): Promise<void> {
		const plugin = this.registry.get(pluginId);
		if (plugin?.origin !== 'linked') throw new Error(`"${pluginId}" is not a linked plugin.`);
		const busy = this.isPluginBusyOrPending(pluginId);
		if (busy.busy) throw new Error(`Cannot restart "${plugin.manifest.name}": ${busy.reason}.`);
		const slot = this.devSlot;
		if (slot?.envOwner.pluginId === pluginId) {
			this.devSlot = null;
			slot.bridge.terminate();
		}
		plugin.status = 'registered';
		await this.activate(pluginId);
	}

	/** Dev mode turned off: drop the dev worker; its owner needs activating again. */
	releaseLinkedEnvironment(): void {
		this._devEpoch++;
		const slot = this.devSlot;
		if (!slot) return;
		this.devSlot = null;
		this.resetEvictedOwner(slot.envOwner.pluginId);
		slot.bridge.terminate();
	}

	/**
	 * Report what activating a plugin would do to the resident custom-slot
	 * owner. Standard-tier activations never evict anything; same-plugin
	 * re-activation at the same manifest version and network policy reuses the
	 * warm environment.
	 * The UI must confirm with the user when `requiresConfirmation` is true
	 * before calling activate().
	 */
	getActivationImpact(pluginId: string): ActivationImpact {
		const none: ActivationImpact = {
			runningPluginId: null,
			pendingApplyPluginId: null,
			pendingResultToken: null,
			evictedPluginIds: [],
			requiresConfirmation: false,
		};
		const plugin = this.registry.get(pluginId);
		if (!plugin) return none;
		let ownerId: string;
		if (plugin.origin === 'linked') {
			// Activation rebuilds a changed environment of the same plugin silently.
			if (!this.devSlot || this.devSlot.envOwner.pluginId === pluginId) return none;
			ownerId = this.devSlot.envOwner.pluginId;
		} else {
			if (classifyEnv(plugin.manifest) === 'standard') return none;
			const slot = this.customSlot;
			if (!slot) return none;
			if (this.ownsCustomSlot(plugin)) return none;
			ownerId = slot.envOwner.pluginId;
		}
		const owner = this.registry.get(ownerId);
		if (!owner) return none;
		const ownerResident =
			owner.status === 'active' || owner.status === 'activating' || owner.status === 'running';
		if (!ownerResident) return none;
		const runningPluginId =
			owner.status === 'running' || owner.status === 'activating' ? owner.manifest.id : null;
		const pendingApplyPluginId =
			this.pendingApply?.pluginId === owner.manifest.id ? owner.manifest.id : null;
		const pendingResultToken =
			pendingApplyPluginId !== null ? (this.pendingApply?.resultToken ?? null) : null;
		return {
			runningPluginId,
			pendingApplyPluginId,
			pendingResultToken,
			evictedPluginIds: [owner.manifest.id],
			requiresConfirmation: runningPluginId !== null || pendingApplyPluginId !== null,
		};
	}

	/** Wired into PluginRegistry.setBusyCheck(). */
	isPluginBusyOrPending(pluginId: string): { busy: boolean; reason?: string } {
		const plugin = this.registry.get(pluginId);
		if (plugin?.status === 'running') return { busy: true, reason: 'currently running' };
		if (plugin?.status === 'activating') return { busy: true, reason: 'currently activating' };
		if (this.pendingApply?.pluginId === pluginId)
			return { busy: true, reason: 'it has an unapplied result. Apply or discard it first' };
		return { busy: false };
	}

	/**
	 * Free the custom worker slot for `plugin` (single-active rule: at most one
	 * custom-tier plugin owns a resident worker). Re-activation of the same
	 * plugin at the same manifest version and network policy keeps the warm
	 * environment (the sandbox CSP is fixed when its worker starts).
	 */
	private evictCustomSlotFor(plugin: PythonPlugin): void {
		const slot = this.customSlot;
		if (!slot) return;
		if (this.ownsCustomSlot(plugin)) return;
		this.customSlot = null;
		this.resetEvictedOwner(slot.envOwner.pluginId);
		slot.bridge.terminate();
	}

	/**
	 * Activate a plugin:
	 *   1. Resolve Python code — placeholder entrypoint for runtime-code plugins,
	 *      the IndexedDB-cached zip for packaged plugins. Activation never
	 *      fetches plugin code; packaged plugins are fully stored at install.
	 *   2. Initialize the Pyodide runtime (idempotent).
	 *   3. Resolve requirements: micropip packages stay as names; .whl files are
	 *      resolved from the install cache (bundled wheels) or fetched by URL.
	 *   4. Transition to 'active'.
	 *
	 * File assets are cached in IndexedDB keyed by plugin ID + manifest.version.
	 * A missing/mismatched record means the plugin must be re-installed.
	 */
	async activate(pluginId: string): Promise<void> {
		return this.activateWith(pluginId);
	}

	/** `activate`, optionally from a linked folder read the caller already made (one snapshot). */
	private async activateWith(pluginId: string, linkedRead?: LinkedFolderRead): Promise<void> {
		if (this.registry.hasReservation(pluginId)) {
			throw new Error(
				`Cannot activate plugin "${pluginId}": plugin installation or replacement is currently in progress.`
			);
		}
		const plugin = this.registry.get(pluginId);
		if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

		// Custom tier: free the single custom worker slot before any status
		// change. The UI is responsible for confirming destructive evictions
		// first (getActivationImpact).
		if (plugin.origin !== 'linked' && classifyEnv(plugin.manifest) === 'custom')
			this.evictCustomSlotFor(plugin);

		plugin.status = 'activating';
		plugin.errorMessage = null;

		const linked = plugin.origin === 'linked';
		const devEpoch = this._devEpoch;
		const devReleased = () => linked && this._devEpoch !== devEpoch;
		let claimedDevSlot = false;
		try {
			// Load cached file assets once. The record is valid only when its
			// manifestVersion matches the current manifest. A linked plugin's files come
			// fresh from its folder instead and are never cached.
			let filesRecord: IndexedDbPluginFilesRecord | null = null;
			let linkedEnv: string | null = null;
			if (linked) {
				const read = linkedRead ?? (await this.readLinked(plugin));
				if (devReleased()) throw new Error('Plugin dev mode was turned off.');
				if (!linkedRead) this.registry.refreshLinked(read.manifest, read.files);
				filesRecord = read.files;
				linkedEnv = read.envFingerprint;
				this.evictDevSlotFor(plugin, linkedEnv);
				// Recorded again only once the environment is installed, so a failed install is rebuilt.
				this._linkedEnvFingerprints.delete(pluginId);
			} else {
				try {
					filesRecord = await foldnanoIndexedDb.loadPluginFiles(pluginId);
				} catch {
					// Cache read failure is non-fatal — treat as a miss.
				}
			}
			const cacheHit = filesRecord?.manifestVersion === plugin.manifest.version;

			// Working copy of the files record for wheel-cache updates below.
			const updatedRecord: IndexedDbPluginFilesRecord = {
				id: pluginId,
				manifestVersion: plugin.manifest.version,
				entrypointZipData: cacheHit ? filesRecord?.entrypointZipData : undefined,
				wheels: cacheHit ? (filesRecord!.wheels ?? []) : [],
				cachedAt: Date.now(),
			};
			let cacheNeedsWrite = false;

			// Step 1: resolve Python code by package kind.
			const kind = classifyManifest(plugin.manifest);
			if (kind === 'legacy') {
				plugin.status = 'needs-reinstall';
				throw new Error(
					`"${plugin.manifest.name}" uses the old plugin format — re-install it as a plugin zip.`
				);
			}
			if (kind === 'runtime-code') {
				// Script-Lab-like: placeholder code; the real source is the editor buffer.
				plugin.resolvedCode = plugin.manifest.entrypoint ?? null;
			} else {
				// Packaged: the zip was stored at install time; never fetched here.
				if (!cacheHit || !filesRecord!.entrypointZipData) {
					plugin.status = 'needs-reinstall';
					throw new Error(
						`Plugin "${plugin.manifest.name}" files not found — re-install the plugin zip.`
					);
				}
				plugin.resolvedZipData = filesRecord!.entrypointZipData.slice(0).buffer;
			}

			// Step 2: ensure the tier's Pyodide worker is running (no-op if ready)
			const bridge = this.ensureBridgeFor(plugin);
			claimedDevSlot = linked;
			await bridge.initRuntime();

			// Step 3: resolve requirements — separate micropip packages from wheels.
			// Wheels are pre-fetched here (with caching) and sent as bytes to the worker.
			const requirements = plugin.manifest.requirements ?? [];
			if (requirements.length > 0) {
				const micropipPackages: string[] = [];
				const preloadedWheels: Array<{ filename: string; data: ArrayBuffer }> = [];

				for (const req of requirements) {
					// Standard extras are bare names resolved to pinned first-party wheels.
					const wheelSource = STANDARD_ENV_EXTRAS[req]?.url ?? (req.endsWith('.whl') ? req : null);
					if (wheelSource !== null) {
						const absUrl = wheelSource.startsWith('/')
							? `${location.origin}${wheelSource}`
							: wheelSource;
						const filename = wheelSource.split('/').pop()!;
						const cachedWheel = cacheHit
							? updatedRecord.wheels.find((w) => w.url === absUrl)
							: undefined;

						if (cachedWheel) {
							// Cache hit — copy bytes for transfer (ArrayBuffer is detached after postMessage).
							preloadedWheels.push({
								filename,
								data: cachedWheel.data.slice(0).buffer,
							});
						} else {
							// Cache miss — fetch and store. Manifests stored before same-origin-only
							// validation may still name external wheels; never fetch those.
							if (!isSameOriginUrl(absUrl))
								throw new Error(
									`Wheel "${wheelSource}" is not served by Foldnano. Reinstall the plugin ` +
										'from a zip that bundles it.'
								);
							const resp = await fetch(absUrl);
							if (!resp.ok)
								throw new Error(
									`Failed to fetch wheel ${absUrl}: ${resp.status} ${resp.statusText}`
								);
							const bytes = await readResponseCapped(resp, MAX_WHEEL_BYTES, `Wheel "${filename}"`);
							// One copy for transfer, one for the cache.
							preloadedWheels.push({ filename, data: bytes.slice(0).buffer });
							const idx = updatedRecord.wheels.findIndex((w) => w.url === absUrl);
							if (idx >= 0) updatedRecord.wheels[idx] = { url: absUrl, data: bytes };
							else updatedRecord.wheels.push({ url: absUrl, data: bytes });
							cacheNeedsWrite = true;
						}
					} else {
						micropipPackages.push(req);
					}
				}

				if (cacheNeedsWrite && !linked) {
					foldnanoIndexedDb
						.savePluginFiles(updatedRecord)
						.catch((e) => console.warn('[PluginCoordinator] Failed to cache plugin files:', e));
				}

				// A stop or dev mode going off during the wheel fetches terminated this bridge, and
				// installing would spawn a fresh worker on it that nothing owns or terminates.
				if (devReleased()) throw new Error('Plugin dev mode was turned off.');
				if (this._stoppedPluginIds.has(pluginId)) throw new Error('Activation was stopped.');
				await bridge.installPlugin(pluginId, micropipPackages, preloadedWheels);
			} else if (cacheNeedsWrite && !linked) {
				// No requirements but entrypoint was freshly fetched — save cache.
				foldnanoIndexedDb
					.savePluginFiles(updatedRecord)
					.catch((e) => console.warn('[PluginCoordinator] Failed to cache plugin files:', e));
			}

			if (devReleased()) throw new Error('Plugin dev mode was turned off.');
			if (linked && linkedEnv !== null) {
				this._linkedEnvFingerprints.set(pluginId, linkedEnv);
				if (this.devSlot) this.devSlot.envOwner.envFingerprint = linkedEnv;
			}
			this._stoppedPluginIds.delete(pluginId);
			plugin.status = 'active';
		} catch (e) {
			// A half-built dev environment is never reused: Pyodide can't uninstall what got in.
			if (claimedDevSlot) this.dropDevSlotOf(pluginId);
			if (devReleased()) {
				// Dev mode went off mid-activation; it already set the status (deactivated).
				this._stoppedPluginIds.delete(pluginId);
				if (plugin.status === 'activating') plugin.status = 'registered';
				plugin.errorMessage = null;
				return;
			}
			if (this._stoppedPluginIds.delete(pluginId)) {
				// Worker was deliberately terminated mid-activation (custom-slot
				// eviction or stop) — not an error; the plugin is back to square one.
				plugin.status = 'registered';
				plugin.errorMessage = null;
				return;
			}
			// Without resolved code, Reset leaves the plugin needing Activate instead of reporting
			// it ready over an environment that never finished installing.
			plugin.resolvedCode = null;
			plugin.resolvedZipData = undefined;
			// Preserve 'needs-reinstall' (set above for legacy/missing-file cases);
			// everything else is a genuine activation error.
			if (plugin.status !== 'needs-reinstall') plugin.status = 'error';
			plugin.errorMessage = e instanceof Error ? e.message : String(e);
			throw e;
		}
	}

	/** Terminate the dev worker if `pluginId` holds it. */
	private dropDevSlotOf(pluginId: string): void {
		const slot = this.devSlot;
		if (slot?.envOwner.pluginId !== pluginId) return;
		this.devSlot = null;
		slot.bridge.terminate();
	}

	/**
	 * Run a plugin against the active part.
	 *
	 * Phase 4: automatically serializes the active Part to the format declared
	 * in the plugin manifest and passes it as input. After a successful run,
	 * applies the primary artifact back to the model via ResultApplicator
	 * (wrapped in snapshotTx for undo/redo).
	 *
	 * @param pluginId  ID of the plugin to run.
	 */
	async run(pluginId: string): Promise<void> {
		return this.runWithOptions(pluginId);
	}

	async runWithOptions(
		pluginId: string,
		options?: {
			params?: Record<string, unknown>;
			sidePanelInput?: PluginSidePanelInput | null;
			/** Owned plugins only: run this plugin.py instead of the saved one, as the plugin. */
			draftCode?: string;
		}
	): Promise<void> {
		if (this.registry.hasReservation(pluginId)) {
			throw new Error(
				`Cannot run plugin "${pluginId}": plugin installation or replacement is currently in progress.`
			);
		}
		const plugin = this.registry.get(pluginId);
		if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);
		if (plugin.status !== 'active')
			throw new Error(`Plugin is not active (status=${plugin.status})`);
		const sidePanelExecution = plugin.manifest.sidePanel?.codeEditor?.execution ?? 'input';
		const entrypointFromEditor =
			sidePanelExecution === 'entrypoint' && options?.sidePanelInput?.type === 'codeEditor'
				? (options.sidePanelInput.code ?? '')
				: null;
		const pluginCodeForRun =
			entrypointFromEditor !== null ? entrypointFromEditor : plugin.resolvedCode;
		if (pluginCodeForRun === null && !plugin.resolvedZipData)
			throw new Error(`Plugin has no resolved code`);
		if (entrypointFromEditor !== null && entrypointFromEditor.trim() === '')
			throw new Error('The script editor is empty. Write a run(ctx) function before running.');
		const draftCode = options?.draftCode ?? null;
		if (draftCode !== null && !plugin.authoring)
			throw new Error(
				`"${plugin.manifest.name}" was not made in this browser, so it has no draft.`
			);
		if (draftCode !== null && draftCode.trim() === '')
			throw new Error('The plugin editor is empty. Write a run(ctx) function before running.');
		if (this.pendingApply && this.pendingApply.pluginId !== pluginId) {
			throw new Error(
				`"${plugin.manifest.name}" cannot run while "${this.pendingApply.pluginId}" has an unapplied result. Apply or discard it first.`
			);
		}
		let linkedZip: Uint8Array | null = null;
		if (plugin.origin === 'linked') {
			if (this._linkedRunReads.has(pluginId)) {
				throw new Error(`"${plugin.manifest.name}" is already starting.`);
			}
			this._linkedRunReads.add(pluginId);
			const devEpoch = this._devEpoch;
			try {
				const read = await this.readLinked(plugin);
				// Dev mode was turned off while the folder was read: nothing runs.
				if (this._devEpoch !== devEpoch) return;
				this.registry.refreshLinked(read.manifest, read.files);
				// A changed environment, or a dev worker that died (stop, timeout), is rebuilt here,
				// from this same read so the zip that runs matches the manifest it was built for.
				if (!this.ownsDevSlot(plugin, read.envFingerprint)) {
					await this.activateWith(pluginId, read);
					if (this._devEpoch !== devEpoch) return;
				}
				linkedZip = read.zip;
			} finally {
				this._linkedRunReads.delete(pluginId);
			}
			if (plugin.status !== 'active')
				throw new Error(`Plugin is not active (status=${plugin.status})`);
		}
		const bridge = this.ensureBridgeFor(plugin);

		// Guard before any status change: a fresh document has no part until the
		// first region is created, and throwing after status = 'running' would
		// strand the plugin in that state with nothing visible to the user.
		const doc = this.getDoc?.();
		const part = doc && doc.parts.length > 0 ? doc.parts[0] : null;
		if (!part) {
			throw new Error(
				`"${plugin.manifest.name}" requires an open design. Create or open a design first.`
			);
		}

		// Before any status change, so a cancelled review leaves the plugin as it was.
		if (plugin.manifest.format === 'cadnano_json' && this.reviewCadnanoInput) {
			const activeRegion = this.getActiveRegion?.() ?? null;
			if (activeRegion instanceof LatticedDesignRegion) {
				const writesBack = plugin.manifest.applyStrategy.startsWith('replaceRegion');
				// A read-only plugin only sees a lossy copy; one that writes back would make the loss permanent.
				const issues = checkCadnanoProfile(part, activeRegion).filter(
					(issue) => issue.severity === 'error' || (writesBack && issue.severity === 'warning')
				);
				if (issues.length > 0 && !(await this.reviewCadnanoInput(plugin.manifest.name, issues))) {
					return;
				}
			}
		}

		// Reproducibility stamp: which runtime + env tier produced this run.
		const tier = classifyEnv(plugin.manifest);
		const envStamp =
			plugin.origin === 'linked'
				? `[env] pyodide-${PYODIDE_VERSION} · dev (would run as: ${tier})`
				: `[env] pyodide-${PYODIDE_VERSION} · ${tier}`;

		plugin.status = 'running';
		plugin.logs = [envStamp];
		plugin.artifacts = {};
		plugin.pluginResult = null;
		plugin.errorMessage = null;
		plugin.errorTraceback = null;
		plugin.lastRunMutationLogLength = null;

		let cadnanoJsonIn: string | undefined;
		let foldnanoJsonIn: string | undefined;
		// Always take a foldnano snapshot for annotation re-grafting (replacePartKeepAnnotationsWhereMatched).
		// A single JSON round-trip guarantees a detached, proxy-free clone, reused as-is for the
		// worker input below instead of re-serializing the live part a second time.
		let preRunSnapshotJson: string | null = null;
		let preRunFoldnanoSnapshot: ReturnType<NonNullable<typeof part>['toJSON']> | null = null;

		if (part) {
			preRunSnapshotJson = JSON.stringify(part.toJSON());
			preRunFoldnanoSnapshot = JSON.parse(preRunSnapshotJson) as ReturnType<
				NonNullable<typeof part>['toJSON']
			>;
		}

		// Use pluginId as requestId so the onLog callback can route streamed log
		// lines to the correct plugin via registry.get(requestId). This is safe
		// because the worker run queue serializes executions for each plugin.
		const requestId = pluginId;

		try {
			let activeRegionId: string | null = null;

			if (part) {
				if (plugin.manifest.format === 'cadnano_json') {
					const activeRegion = this.getActiveRegion?.() ?? null;
					if (!activeRegion || !(activeRegion instanceof LatticedDesignRegion)) {
						throw new Error(
							`Plugin "${plugin.manifest.name}" requires an active lattice region. Click a Honeycomb or Square region in the StrandView to make it active.`
						);
					}
					activeRegionId = activeRegion.id;
					const { json: regionJson } = CadnanoJSON.fromRegion(activeRegion, part);
					cadnanoJsonIn = JSON.stringify(regionJson);
				} else if (
					plugin.manifest.format === 'foldnano_json' ||
					plugin.manifest.format === 'foldnano_mini'
				) {
					foldnanoJsonIn = preRunSnapshotJson ?? undefined;
					// Forward the active region (if any) so region-scoped foldnano_json /
					// foldnano_mini plugins can read ctx.active_region_id. Unlike
					// cadnano_json, an active region is not required.
					activeRegionId = this.getActiveRegion?.()?.id ?? null;
				}
			}
			// A draft runs as the plugin (same manifest, zip path and builtins); its code is also
			// scanned for imports, standing in for requirements the draft may have added.
			const result = await bridge.runPlugin({
				requestId,
				pluginCode: draftCode ?? pluginCodeForRun ?? undefined,
				pluginZipData:
					draftCode !== null
						? (buildPluginZip(plugin.manifest, draftCode, plugin.iconSvg).buffer as ArrayBuffer)
						: linkedZip !== null
							? (linkedZip.slice().buffer as ArrayBuffer)
							: plugin.resolvedZipData,
				pluginLabel: plugin.manifest.name,
				format: plugin.manifest.format,
				cadnanoJsonIn,
				foldnanoJsonIn,
				activePartIndex: 0,
				paramsJson: Object.keys(options?.params ?? plugin.paramValues).length
					? JSON.stringify(options?.params ?? plugin.paramValues)
					: undefined,
				sidePanelInputJson: options?.sidePanelInput
					? JSON.stringify(options.sidePanelInput)
					: undefined,
				activeRegionId,
				loadImports: entrypointFromEditor !== null || draftCode !== null,
			});

			plugin.logs = [envStamp, ...result.logs];
			plugin.artifacts = result.artifacts;
			plugin.pluginResult = result.pluginResult;
			plugin.lastRunMutationLogLength = result.mutationLog?.length ?? null;
			plugin.status = 'active';

			// ------------------------------------------------------------------
			// Apply the result back to the model
			// For mutating strategies, hold result in pendingApply for user
			// confirmation; for previewOnly apply immediately (no-op).
			// ------------------------------------------------------------------
			const strategy = plugin.manifest.applyStrategy;
			const isReplay = strategy === 'replayMutationLog' || strategy === 'replayMutationLogInRegion';
			const hasResult = isReplay
				? result.mutationLog != null && result.mutationLog.length > 0
				: result.primaryArtifact != null;

			if (doc && part) {
				if (strategy === 'previewOnly') {
					// previewOnly: no model mutation, logs/artifacts already set
				} else if (isReplay) {
					if (hasResult) {
						const snapshot = preRunFoldnanoSnapshot as PartSnapshot | null;
						const mutationLog = (result.mutationLog ?? null) as MutationOp[] | null;
						this.pendingApply = {
							pluginId: pluginId,
							docId: doc.id,
							partFingerprint: snapshot ? JSON.stringify(snapshot) : null,
							manifest: plugin.manifest,
							primaryArtifact: null,
							mutationLog,
							preRunFoldnanoSnapshot: snapshot,
							summary: buildApplySummary(plugin.manifest, null, mutationLog, snapshot),
							activeRegionId,
							resultToken: this._mintResultToken(),
						};
					}
				} else {
					// Always validate here, even a null primaryArtifact — not a silent no-op.
					// validatedArtifact carries forward any repairs validation made (e.g. a
					// one-sided pointer discarded as a free end) so Apply never re-parses the
					// plugin's original, unrepaired artifact.
					let validatedArtifact = result.primaryArtifact;
					try {
						let verificationInput: DesignVerificationInput;
						if (plugin.manifest.format === 'cadnano_json') {
							const cleaned = validateCadnanoResultShape(result.primaryArtifact, pluginId);
							for (const warning of cleaned.warnings) {
								console.warn(`[PluginCoordinator] ${pluginId}: ${warning}`);
							}
							const cadnanoData = { name: cleaned.name, vstrands: cleaned.vstrands };
							validatedArtifact = JSON.stringify(cadnanoData);
							verificationInput = { format: 'cadnano_json', data: cadnanoData };
						} else {
							const foldnanoData = validateFoldnanoResultShape(result.primaryArtifact, pluginId);
							verificationInput = { format: 'foldnano_json', data: foldnanoData };
						}
						// Reconstructs on a detached scratch Part (never doc.parts/snapshotTx) — rejects before Apply is ever offered.
						verifyDesign(
							plugin.manifest,
							pluginId,
							preRunFoldnanoSnapshot as PartJSON | null,
							activeRegionId,
							verificationInput
						);
					} catch (err) {
						if (err instanceof PluginValidationError) {
							plugin.status = 'error';
							plugin.errorMessage = err.message;
							plugin.errorTraceback = null;
							reportError(err.toSafeReportable(), err.errorLogContext, { notify: false });
							return;
						}
						throw err;
					}

					const snapshot = preRunFoldnanoSnapshot as PartSnapshot | null;
					this.pendingApply = {
						pluginId: pluginId,
						docId: doc.id,
						partFingerprint: snapshot ? JSON.stringify(snapshot) : null,
						manifest: plugin.manifest,
						primaryArtifact: validatedArtifact,
						mutationLog: null,
						preRunFoldnanoSnapshot: snapshot,
						summary: buildApplySummary(plugin.manifest, validatedArtifact, null, snapshot),
						activeRegionId,
						resultToken: this._mintResultToken(),
					};
				}
			}
		} catch (e) {
			if (this._stoppedPluginIds.delete(pluginId)) {
				// Deliberate worker termination (user stop or custom-slot eviction).
				// Bridge-mates were already reset by the initiator (stopPlugin /
				// evictCustomSlotFor) — only this plugin's state is handled here.
				// A linked plugin stopped because dev mode went off stays deactivated.
				const devModeOff = plugin.origin === 'linked' && !plugin.enabled;
				plugin.status = devModeOff ? 'deactivated' : 'registered';
				plugin.errorMessage = null;
				plugin.errorTraceback = null;
				if (this.pendingApply?.pluginId === pluginId) this.pendingApply = null;
				// Auto-reactivate plugins with no requirements (e.g. ScriptLab) so
				// the user can run again without a manual "Activate" click
				if (!devModeOff && (plugin.manifest.requirements?.length ?? 0) === 0) {
					this.activate(pluginId).catch(() => {});
				}
				return;
			}

			if (e instanceof RunTimeoutError) {
				// Python can't be interrupted: kill the worker so it stops burning CPU
				// and doesn't block the serialized run queue for its bridge-mates.
				this.terminateTierOf(plugin);
				// Its environment died with the worker: require re-activation, not just Run.
				plugin.resolvedCode = null;
				plugin.resolvedZipData = undefined;
			}

			plugin.status = 'error';
			const folderPaths = (text: string) =>
				plugin.linked ? linkedFolderPaths(text, plugin.linked.folderName) : text;
			plugin.errorMessage =
				folderPaths(e instanceof Error ? e.message : String(e)) || RUN_FAILED_WITHOUT_MESSAGE;
			const rawTraceback =
				e instanceof Error && 'traceback' in e
					? (e as Error & { traceback: string }).traceback
					: null;
			const pythonTraceback = rawTraceback ? folderPaths(rawTraceback) : rawTraceback;
			// No Python traceback means the failure was outside the plugin's Python: show where.
			plugin.errorTraceback = pythonTraceback || (e instanceof Error ? (e.stack ?? null) : null);
			console.error(`[PluginCoordinator] run of "${pluginId}" failed:`, e);
			if (e instanceof Error && 'logs' in e) {
				const crashLogs = (e as Error & { logs: unknown }).logs;
				if (Array.isArray(crashLogs) && crashLogs.every((line) => typeof line === 'string')) {
					plugin.logs = [envStamp, ...crashLogs];
				}
			}
			throw e;
		}
	}

	/**
	 * Confirm applying the pending result for a plugin.
	 * Calls applyResult() and clears pendingApply.
	 */
	confirmApply(pluginId: string): void {
		if (this.pendingApply?.pluginId !== pluginId) return;
		// Another tab owns the document: keep the result so it can be applied after taking back
		// control (the stale check below discards it if the reloaded design differs).
		if (!this.canEditDoc()) return;
		const doc = this.getDoc?.();
		if (!doc) {
			this.pendingApply = null;
			return;
		}
		const currentFingerprint = doc.parts.length > 0 ? JSON.stringify(doc.parts[0].toJSON()) : null;
		if (
			doc.id !== this.pendingApply.docId ||
			currentFingerprint !== this.pendingApply.partFingerprint
		) {
			// Document or active part changed since the plugin ran — discard rather than
			// replay a stale result onto newer local edits.
			this.pendingApply = null;
			return;
		}
		const { manifest, primaryArtifact, mutationLog, preRunFoldnanoSnapshot, activeRegionId } =
			this.pendingApply;

		const historyStack = this.getHistory?.();
		if (doc && historyStack) {
			try {
				applyResult({
					manifest,
					primaryArtifact,
					mutationLog,
					preRunFoldnanoSnapshot: preRunFoldnanoSnapshot as Parameters<
						typeof applyResult
					>[0]['preRunFoldnanoSnapshot'],
					doc,
					partIndex: 0,
					historyStack,
					activeRegionId,
				});
			} catch (err) {
				this.pendingApply = null;
				const applyError = new PluginApplyError(
					err instanceof Error ? err.message : String(err),
					pluginId,
					'apply-failed'
				);
				const plugin = this.registry.get(pluginId);
				if (plugin) {
					plugin.status = 'error';
					plugin.errorMessage = applyError.message;
					plugin.errorTraceback = null;
				}
				reportError(applyError.toSafeReportable(), applyError.errorLogContext, { notify: false });
				return;
			}
		}
		this.pendingApply = null;
	}

	/**
	 * Cancel the pending apply for a plugin — discards the result.
	 */
	cancelApply(pluginId: string): void {
		if (this.pendingApply?.pluginId !== pluginId) return;
		this.pendingApply = null;
	}

	/**
	 * Stop a currently running plugin by terminating its tier's Pyodide worker.
	 *
	 * Pyodide's runPythonAsync() cannot be interrupted; Worker.terminate() is
	 * the only way to halt a hung script. After termination the worker is
	 * respawned lazily on the next activate() call. The blast radius is
	 * per-bridge: stopping a custom-tier plugin never touches the standard
	 * worker, and vice versa. Standard-tier bridge-mates are reset to
	 * 'registered' because their installations died with the shared worker;
	 * requirement-free plugins (e.g. ScriptLab) are auto-reactivated.
	 */
	stopPlugin(pluginId: string): void {
		const plugin = this.registry.get(pluginId);
		if (!plugin || plugin.status !== 'running') return;
		if (plugin.origin === 'linked') {
			if (!this.devSlot) return;
		} else {
			const tier = classifyEnv(plugin.manifest);
			if (!(tier === 'standard' ? this.standardBridge : this.customSlot?.bridge)) return;
		}
		this._stoppedPluginIds.add(pluginId);
		this.terminateTierOf(plugin);
	}

	/**
	 * Terminate the worker behind `plugin`'s env tier. Standard-tier
	 * bridge-mates are reset to 'registered' (their installations die with the
	 * shared worker); `plugin` itself is left to the caller.
	 */
	private terminateTierOf(plugin: PythonPlugin): void {
		const pluginId = plugin.manifest.id;
		if (plugin.origin === 'linked') {
			const slot = this.devSlot;
			this.devSlot = null;
			slot?.bridge.terminate();
			return;
		}
		const tier = classifyEnv(plugin.manifest);
		const bridge = tier === 'standard' ? this.standardBridge : this.customSlot?.bridge;
		if (!bridge) return;
		if (tier === 'standard') {
			for (const [, other] of this.registry.plugins) {
				if (other.manifest.id === pluginId) continue;
				if (classifyEnv(other.manifest) !== 'standard') continue;
				if (other.status === 'activating') this._stoppedPluginIds.add(other.manifest.id);
				if (other.status === 'active' || other.status === 'activating') {
					other.status = 'registered';
				}
			}
			this.standardBridge = null;
		} else {
			this.customSlot = null;
		}
		bridge.terminate();
	}

	/**
	 * Reset a plugin's runtime state so it can be re-run without re-activating.
	 *
	 * - Clears logs, artifacts, pluginResult, and error information.
	 * - Cancels any pending apply for this plugin.
	 * - If the plugin errored during a run (resolved code exists), transitions
	 *   back to 'active' so the Run button becomes available again.
	 * - If the plugin errored during activation (no resolved code), the status
	 *   remains 'error' — the user should click Activate instead.
	 */
	resetPlugin(pluginId: string): void {
		const plugin = this.registry.get(pluginId);
		if (!plugin) return;

		// Cancel any pending apply for this plugin
		if (this.pendingApply?.pluginId === pluginId) {
			this.pendingApply = null;
		}

		// Clear run output
		plugin.logs = [];
		plugin.artifacts = {};
		plugin.pluginResult = null;
		plugin.errorMessage = null;
		plugin.errorTraceback = null;
		plugin.lastRunMutationLogLength = null;

		// If errored after a successful activation (resolved code present),
		// go back to 'active' so the user can run again without re-activating.
		if (
			plugin.status === 'error' &&
			(plugin.resolvedCode !== null || plugin.resolvedZipData != null)
		) {
			plugin.status = 'active';
		}
	}

	/**
	 * Deactivate a plugin.
	 */
	deactivate(pluginId: string): void {
		const plugin = this.registry.get(pluginId);
		if (plugin) {
			plugin.status = 'deactivated';
		}
	}

	/**
	 * Update a plugin's mutable runtime state (e.g. status, logs).
	 * Used internally and by tests.
	 */
	updatePlugin(pluginId: string, patch: Partial<PythonPlugin>): void {
		const plugin = this.registry.get(pluginId);
		if (!plugin) return;
		Object.assign(plugin, patch);
	}

	/**
	 * Tear down all Pyodide workers. After this, activate() re-initializes lazily.
	 */
	terminate(): void {
		const standard = this.standardBridge;
		const custom = this.customSlot?.bridge;
		const dev = this.devSlot?.bridge;
		this.standardBridge = null;
		this.customSlot = null;
		this.devSlot = null;
		standard?.terminate();
		custom?.terminate();
		dev?.terminate();
	}

	persistEditorCode(pluginId: string, code: string): Promise<void> {
		return this.registry.persistEditorCode(pluginId, code);
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The worker extracts the zip to /plugin_run/; name the author's folder instead. */
export function linkedFolderPaths(text: string, folderName: string): string {
	return text.replaceAll('/plugin_run/', `${folderName}/`);
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildApplySummary(
	manifest: PluginManifest,
	primaryArtifact: string | null,
	mutationLog: MutationOp[] | null,
	preRunSnapshot: PartSnapshot | null
): string {
	if (
		manifest.applyStrategy === 'replayMutationLog' ||
		manifest.applyStrategy === 'replayMutationLogInRegion'
	) {
		const n = mutationLog?.length ?? 0;
		return `${manifest.applyStrategy} — ${n} op${n === 1 ? '' : 's'}`;
	}

	if (manifest.applyStrategy === 'replaceRegion') {
		return 'replaceRegion — region replaced';
	}

	// Count oligos in the returned artifact
	let afterOligos = 0;
	if (primaryArtifact) {
		try {
			const parsed = JSON.parse(primaryArtifact);
			// cadnano_json: count all 5' ends across both scaf and stap arrays so the
			// total matches the foldnano oligos.length used for the before count.
			if (manifest.format === 'cadnano_json' && Array.isArray(parsed.vstrands)) {
				for (const vs of parsed.vstrands as { scaf: number[][]; stap: number[][] }[]) {
					for (const entry of [...(vs.scaf ?? []), ...(vs.stap ?? [])]) {
						// 5' end: no incoming pointer but has outgoing connection
						if (entry[0] === -1 && entry[2] !== -1) afterOligos++;
					}
				}
			} else if (Array.isArray(parsed.oligos)) {
				afterOligos = parsed.oligos.length;
			}
		} catch {
			// ignore parse errors — summary is informational only
		}
	}

	const beforeOligos = preRunSnapshot?.oligos?.length ?? null;

	if (manifest.applyStrategy === 'replacePart') {
		const oligoStr = afterOligos > 0 ? `${afterOligos} oligos` : 'unknown oligos';
		return `replacePart — ${oligoStr}; sequences not preserved`;
	}

	// replacePartKeepAnnotationsWhereMatched
	if (beforeOligos !== null) {
		return `replacePartKeepAnnotations — ${afterOligos} oligos after (was ${beforeOligos}); sequences preserved where matched`;
	}
	return `replacePartKeepAnnotations — ${afterOligos} oligos; sequences preserved where matched`;
}
