/**
 * Agent runs: watches one linked plugin folder for run requests from a coding agent, runs them
 * through `PluginCoordinator` like a Run click, applies the result and writes a run record back.
 * A connection is one folder and one design; only the tab that shows and owns that design, and
 * holds the folder's lock, listens. Protocol pieces are `agentRuns.ts`; see
 * docs/python-plugin-system.md § Agent runs.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DesignOverview } from '$lib/model/io/designOverview';
import type { Part } from '$lib/model/Part';
import {
	ensureAccess,
	getFileHandle,
	listFileNames,
	queryAccess,
	readFileBytes,
	removeFile,
	writeFile,
} from '$lib/services/fileAccess/fileAccess';
import {
	foldnanoIndexedDb,
	type FoldnanoIndexedDb,
} from '$lib/services/storage/indexeddb/FoldnanoIndexedDb';
import {
	AGENT_CLI_PATH,
	AGENT_LISTENER_FILE,
	AGENT_PROTOCOL,
	AGENT_REQUESTS_DIR,
	AGENT_RUNS_DIR,
	AGENT_SCRIPTS_DIR,
	AgentRequestError,
	CLAUDE_MD_TEXT,
	MAX_AGENT_REQUEST_BYTES,
	MAX_AGENT_SCRIPT_BYTES,
	agentCliText,
	agentsMdFile,
	isGeneratedAgentCli,
	isUneditedAgentsMd,
	isoTime,
	parseAgentRunRequest,
	requestIdFromFileName,
	sha256Hex,
	type AgentApplyOutcome,
	type AgentListenerActivity,
	type AgentListenerInfo,
	type AgentListenerState,
	type AgentRunRecord,
} from './agentRuns';
import type { PendingResolution, PluginCoordinator } from './PluginCoordinator.svelte';
import { STUBS_DIR, loadApiStubs, pyrightConfigText } from './pluginScaffold';
import type { PluginDevMode } from './PluginDevMode.svelte';
import type { PluginRegistry } from './PluginRegistry.svelte';
import type { PythonPlugin } from './types';
import { PYODIDE_VERSION } from './worker/pyodideConfig';
import { formatMb } from './sizeLimits';

const CONNECTION_SETTING = 'pluginAgentRunsConnection';
/** The Dev tab's experimental switch; nothing can connect while it is off. */
const ALLOWED_SETTING = 'pluginAgentRunsAllowed';
const POLL_MS = 500;
/** run.py treats a heartbeat older than 15 s as "no tab listening". */
const HEARTBEAT_MS = 3000;
/** Only the newest run records are checked for runs a closed editor left `running`. */
const RECOVERY_SCAN_LIMIT = 50;
const LEFTOVER_MESSAGE =
	'Not run: the request was already waiting when this folder started listening ' +
	'(agent runs turned on, resumed, or allowed again). Send it again.';
const INTERRUPTED_MESSAGE =
	'The editor stopped (closed, reloaded or disconnected) while this ran. Whether the design ' +
	'changed is unknown: check it before running the script again.';

/** The folder and the one design agent runs apply to; survives reloads, only for that design. */
export interface AgentConnection {
	pluginId: string;
	docId: string;
	docName: string;
}

export type AgentRunsState = 'off' | 'listening' | 'needs-permission' | 'paused';

type LockRequester = Pick<LockManager, 'request'>;

export interface AgentRunListenerDeps {
	registry: PluginRegistry;
	devMode: PluginDevMode;
	getCoordinator: () => PluginCoordinator;
	/** The design open in this tab; null before one is. */
	getDocId: () => string | null;
	getDocName: () => string;
	/** JSON of the part a run reads and changes; null without an open design. */
	getPartJson: () => string | null;
	/**
	 * The structure-only overview of the active region of `part` (default: the open design's),
	 * put in every finished run's record.
	 */
	getOverview?: (part?: Part) => DesignOverview | null;
	/** False while another tab owns the document. */
	canEdit: () => boolean;
	/** A dialog in this tab waits for the user (e.g. the requirements review). */
	isAwaitingUser?: () => boolean;
	/** The site the docs links in AGENTS.md point at. */
	origin: string;
	db?: Pick<FoldnanoIndexedDb, 'getSetting' | 'setSetting'>;
	/** Defaults to `navigator.locks`; without one, every tab may listen. */
	locks?: LockRequester | null;
	now?: () => number;
	/** Off in tests, which call `tick()` / `heartbeat()` themselves. */
	autoPoll?: boolean;
}

/** Agent runs stopped (disconnect, dispose) while a request was in flight. */
class ListenerStoppedError extends Error {}

function newRunRecord(id: string, pluginId: string, startedAt: number): AgentRunRecord {
	return {
		protocol: AGENT_PROTOCOL,
		id,
		kind: 'run',
		status: 'running',
		pluginId,
		session: null,
		docId: null,
		docName: null,
		script: null,
		bundleSha256: null,
		scriptSha256: null,
		manifestVersion: null,
		runtime: null,
		activeRegionId: null,
		params: {},
		mode: null,
		apply: true,
		startedAt: isoTime(startedAt),
		finishedAt: null,
		durationMs: null,
		applyOutcome: null,
		applied: false,
		review: null,
		summary: null,
		mutationCount: null,
		designBefore: null,
		designAfter: null,
		logs: [],
		result: null,
		artifacts: [],
		error: null,
		traceback: null,
		overview: null,
	};
}

function isConnection(value: unknown): value is AgentConnection {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.pluginId === 'string' && typeof v.docId === 'string' && typeof v.docName === 'string'
	);
}

const sameConnection = (a: AgentConnection | null, b: AgentConnection | null) =>
	a?.pluginId === b?.pluginId && a?.docId === b?.docId;

const recordJson = (record: AgentRunRecord) => `${JSON.stringify(record, null, 2)}\n`;

export class AgentRunListener {
	/** Experimental opt-in under the dev mode switch; off by default. */
	allowed: boolean = $state(false);
	connection: AgentConnection | null = $state(null);
	state: AgentRunsState = $state('off');
	pausedReason: string | null = $state(null);
	/** The request being run right now. */
	current: { id: string; script: string | null } | null = $state(null);
	/** The last finished run, for the toolbar's toast. */
	lastRun: AgentRunRecord | null = $state.raw(null);
	ready: Promise<void>;

	readonly #deps: AgentRunListenerDeps;
	readonly #db: Pick<FoldnanoIndexedDb, 'getSetting' | 'setSetting'>;
	readonly #locks: LockRequester | null;
	readonly #now: () => number;
	#disposed = false;
	/** Bumped on connect, disconnect and dispose; work that sees it change stops. */
	#generation = 0;
	#pollTimer: ReturnType<typeof setInterval> | null = null;
	#heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	#polling = false;
	#processing = false;
	/** Releases the folder lock; set while this tab holds it. */
	#releaseLock: (() => void) | null = null;
	/**
	 * Set for one stretch of listening, after it rejected the requests already waiting; requests
	 * must carry it. Cleared by every pause, permission lapse, connect and disconnect.
	 */
	#session: string | null = null;
	#dir: FileSystemDirectoryHandle | null = null;
	#lastHeartbeat = 0;
	#lastWrittenState: AgentListenerState | null = null;
	/** Records of results left for review, updated when the user applies or discards them. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- non-reactive bookkeeping
	#reviewRecords = new Map<string, { dir: FileSystemDirectoryHandle; record: AgentRunRecord }>();

	constructor(deps: AgentRunListenerDeps) {
		this.#deps = deps;
		this.#db = deps.db ?? foldnanoIndexedDb;
		this.#locks =
			deps.locks !== undefined
				? deps.locks
				: typeof navigator !== 'undefined' && navigator.locks
					? navigator.locks
					: null;
		this.#now = deps.now ?? Date.now;
		this.ready = this.#load();
	}

	/** The connected folder's plugin; null when agent runs are off. */
	get pluginId(): string | null {
		return this.connection?.pluginId ?? null;
	}

	async #load(): Promise<void> {
		await this.#deps.devMode.ready;
		await this.#deps.registry.ready;
		let saved: unknown;
		try {
			this.allowed = (await this.#db.getSetting<boolean>(ALLOWED_SETTING)) === true;
			saved = await this.#db.getSetting<unknown>(CONNECTION_SETTING);
		} catch (e) {
			console.warn('[AgentRunListener] Failed to load the agent runs setting:', e);
		}
		if (this.#disposed || !isConnection(saved)) return;
		if (!this.#canConnect(saved)) {
			// Dev mode or the switch went off, or the folder was unlinked: the connection is over.
			await this.#db.setSetting(CONNECTION_SETTING, null);
			return;
		}
		this.#connect(saved);
	}

	#canConnect(connection: AgentConnection): boolean {
		return (
			this.allowed &&
			this.#deps.devMode.enabled &&
			this.#deps.registry.get(connection.pluginId)?.origin === 'linked'
		);
	}

	/** The experimental switch; turning it off disconnects. */
	async setAllowed(allowed: boolean): Promise<void> {
		this.allowed = allowed;
		await this.#db.setSetting(ALLOWED_SETTING, allowed);
		if (!allowed && this.connection) await this.disable();
	}

	/**
	 * Connects one linked folder to the design open in this tab (replacing any connection). Asks
	 * for write access and writes the agent files, so call it straight from the click.
	 */
	async enable(pluginId: string): Promise<void> {
		if (!this.allowed) throw new Error('Turn on Agent runs (experimental) in Plugins → Dev first.');
		if (!this.#deps.devMode.enabled) throw new Error('Turn on plugin dev mode first.');
		const docId = this.#deps.getDocId();
		if (!docId) throw new Error('Open a design first; agent runs apply to the design open here.');
		const plugin = this.#linked(pluginId);
		const dir = await this.#deps.devMode.folderHandle(plugin);
		if (!dir) throw new Error(`The link to "${plugin.linked?.folderName}" was lost. Re-link it.`);
		if (!(await ensureAccess(dir, 'readwrite'))) {
			throw new Error(
				`Agent runs need permission to write to "${dir.name}" (requests and results live there).`
			);
		}
		await this.#writeAgentFiles(dir, plugin);
		if (this.#disposed) return;
		const connection = { pluginId, docId, docName: this.#deps.getDocName() };
		if (this.connection && this.connection.pluginId !== pluginId) await this.disable();
		await this.#db.setSetting(CONNECTION_SETTING, connection);
		this.#connect(connection);
		await this.tick();
	}

	/** Asks for the folder permission again (it lapses with the browser session); from a click. */
	async resume(): Promise<void> {
		if (!this.connection) return;
		const dir = await this.#deps.devMode.folderHandle(this.#linked(this.connection.pluginId));
		if (dir && (await ensureAccess(dir, 'readwrite'))) await this.tick();
	}

	/** Ends the connection, in every tab (they see the cleared setting on their next poll). */
	async disable(): Promise<void> {
		await this.#endLocally();
		await this.#db.setSetting(CONNECTION_SETTING, null);
	}

	/** Editor teardown: stops everything in flight for good. The folder's heartbeat goes stale. */
	dispose(): void {
		this.#disposed = true;
		this.#generation++;
		this.#clearTimers();
		this.#unlock();
	}

	/** Called by the coordinator when a pending result is applied, discarded or replaced. */
	onPendingResolved(resultToken: string, resolution: PendingResolution): void {
		const entry = this.#reviewRecords.get(resultToken);
		if (!entry) return;
		this.#reviewRecords.delete(resultToken);
		entry.record.review = resolution;
		entry.record.applied = resolution === 'applied';
		void (async () => {
			if ((await queryAccess(entry.dir, 'readwrite')) !== 'granted') return;
			await writeFile(
				entry.dir,
				`${AGENT_RUNS_DIR}/${entry.record.id}.json`,
				recordJson(entry.record)
			);
		})().catch((e) => console.warn('[AgentRunListener] Failed to update a reviewed run:', e));
	}

	/** One poll: settings, ownership, lock, then at most one request. Exposed for tests. */
	async tick(): Promise<void> {
		if (this.#disposed || this.#polling || !this.connection) return;
		this.#polling = true;
		try {
			await this.#poll();
		} catch (e) {
			console.warn('[AgentRunListener] Poll failed:', e);
		} finally {
			this.#polling = false;
		}
	}

	/** Writes listener.json, on its own timer so it keeps going during a run. Exposed for tests. */
	async heartbeat(): Promise<void> {
		const plugin = this.connection ? this.#deps.registry.get(this.connection.pluginId) : null;
		if (this.#disposed || !this.#dir || !this.#releaseLock || !plugin) return;
		if (this.state !== 'listening') return;
		try {
			await this.#writeListener(this.#dir, plugin, 'listening', null);
		} catch (e) {
			console.warn('[AgentRunListener] Heartbeat failed:', e);
		}
	}

	async #poll(): Promise<void> {
		const generation = this.#generation;
		const live = () => !this.#disposed && this.#generation === generation;
		const connection = this.connection;
		if (!connection) return;

		// Another tab may have turned agent runs off or connected something else.
		const [allowed, saved] = await Promise.all([
			this.#db.getSetting<boolean>(ALLOWED_SETTING),
			this.#db.getSetting<unknown>(CONNECTION_SETTING),
		]);
		if (!live()) return;
		this.allowed = allowed === true;
		const current = isConnection(saved) ? saved : null;
		if (!this.#canConnect(connection)) {
			await this.disable();
			return;
		}
		if (!sameConnection(current, connection)) {
			await this.#endLocally();
			if (current && this.#canConnect(current)) this.#connect(current);
			return;
		}

		const plugin = this.#linked(connection.pluginId);
		if (this.#deps.getDocId() !== connection.docId) {
			await this.#pause(plugin, `connected to "${connection.docName}"; open that design to resume`);
			return;
		}
		if (!this.#deps.canEdit()) {
			await this.#pause(plugin, 'another tab is editing this design');
			return;
		}
		const dir = await this.#deps.devMode.folderHandle(plugin);
		const access = dir ? await queryAccess(dir, 'readwrite') : 'denied';
		if (!live()) return;
		if (!dir || access !== 'granted') {
			this.#session = null;
			this.#unlock();
			this.state = 'needs-permission';
			this.pausedReason = null;
			return;
		}
		if (!this.#releaseLock) {
			const release = await this.#tryLock(`foldnano-agent-folder:${connection.pluginId}`);
			if (!live()) {
				release?.();
				return;
			}
			if (!release) {
				this.state = 'paused';
				this.pausedReason = 'another tab is listening to this folder';
				return;
			}
			this.#releaseLock = release;
		}
		this.#dir = dir;
		if (this.#session === null) {
			// Before announcing "listening", so only requests sent after it can run.
			await this.#recoverInterrupted(dir);
			await this.#discardWaiting(dir, plugin);
			if (!live()) return;
			this.#session = uuidv4();
		}
		this.state = 'listening';
		this.pausedReason = null;
		if (
			this.#lastWrittenState !== 'listening' ||
			this.#now() - this.#lastHeartbeat >= HEARTBEAT_MS
		) {
			await this.#writeListener(dir, plugin, 'listening', null);
		}
		if (!live() || this.#processing) return;
		// One result at a time: requests queue while any result awaits Apply / Discard, and
		// while a Run click is in progress.
		if (this.#deps.getCoordinator().pendingApply) return;
		if (plugin.status === 'running' || plugin.status === 'activating') return;
		const names = await listFileNames(dir, AGENT_REQUESTS_DIR);
		if (!live()) return;
		const id = names.map(requestIdFromFileName).find((n) => n !== null);
		if (!id) return;
		this.#processing = true;
		try {
			await this.#process(dir, plugin, id, live);
		} finally {
			this.#processing = false;
		}
	}

	/** Stops listening here for now (writing why, if this tab held the folder) and frees the lock. */
	async #pause(plugin: PythonPlugin, reason: string): Promise<void> {
		if (this.#releaseLock && this.#dir) {
			await this.#writeListener(this.#dir, plugin, 'paused', reason).catch(() => {});
		}
		this.#session = null;
		this.#unlock();
		this.state = 'paused';
		this.pausedReason = reason;
	}

	/** Rejects, unread, every request already waiting (left over, or planted while not listening). */
	async #discardWaiting(dir: FileSystemDirectoryHandle, plugin: PythonPlugin): Promise<void> {
		for (const name of await listFileNames(dir, AGENT_REQUESTS_DIR)) {
			const id = requestIdFromFileName(name);
			if (!id) continue;
			await removeFile(dir, `${AGENT_REQUESTS_DIR}/${id}.json`);
			await this.#writeRejected(dir, plugin, id, LEFTOVER_MESSAGE);
		}
	}

	/** Marks runs a previous editor left `running` as `interrupted`: their outcome is unknown. */
	async #recoverInterrupted(dir: FileSystemDirectoryHandle): Promise<void> {
		const names = (await listFileNames(dir, AGENT_RUNS_DIR)).filter((n) => n.endsWith('.json'));
		for (const name of names.slice(-RECOVERY_SCAN_LIMIT)) {
			if (this.current && name === `${this.current.id}.json`) continue;
			const path = `${AGENT_RUNS_DIR}/${name}`;
			let record: AgentRunRecord;
			try {
				record = JSON.parse(
					new TextDecoder().decode(await readFileBytes(await getFileHandle(dir, path)))
				) as AgentRunRecord;
			} catch {
				continue;
			}
			if (record.status !== 'running') continue;
			record.status = 'interrupted';
			record.error = INTERRUPTED_MESSAGE;
			await writeFile(dir, path, recordJson(record));
		}
	}

	async #writeRejected(
		dir: FileSystemDirectoryHandle,
		plugin: PythonPlugin,
		id: string,
		message: string
	): Promise<void> {
		const now = this.#now();
		const record = newRunRecord(id, plugin.manifest.id, now);
		record.status = 'rejected';
		record.error = message;
		record.finishedAt = isoTime(now);
		record.durationMs = 0;
		await writeFile(dir, `${AGENT_RUNS_DIR}/${id}.json`, recordJson(record));
	}

	async #process(
		dir: FileSystemDirectoryHandle,
		plugin: PythonPlugin,
		id: string,
		live: () => boolean
	): Promise<void> {
		const requestPath = `${AGENT_REQUESTS_DIR}/${id}.json`;
		const pluginId = plugin.manifest.id;
		const connection = this.connection!;
		const startedAt = this.#now();
		const record = newRunRecord(id, pluginId, startedAt);
		record.session = this.#session;
		record.docId = connection.docId;
		record.docName = connection.docName;
		record.manifestVersion = plugin.manifest.version;
		record.runtime = `pyodide-${PYODIDE_VERSION}`;
		const writeRecord = () => writeFile(dir, `${AGENT_RUNS_DIR}/${id}.json`, recordJson(record));
		const partHash = async () => {
			const json = this.#deps.getPartJson();
			return json === null ? null : sha256Hex(json);
		};
		const ensureLive = () => {
			if (!live()) throw new ListenerStoppedError();
		};

		const coordinator = this.#deps.getCoordinator();
		// The plugin's logs belong to an earlier run until this run replaces them.
		const logsBefore = plugin.logs;
		const ranThisRequest = () => plugin.logs !== logsBefore;
		/** A dry run's scratch copy with its change applied: the overview describes it. */
		let previewPart: Part | null = null;
		try {
			const requestFile = await (await getFileHandle(dir, requestPath)).getFile();
			if (requestFile.size > MAX_AGENT_REQUEST_BYTES) {
				throw new AgentRequestError(
					`The request is larger than ${MAX_AGENT_REQUEST_BYTES / 1024} KB.`,
					id
				);
			}
			const request = parseAgentRunRequest(
				new TextDecoder().decode(new Uint8Array(await requestFile.arrayBuffer())),
				id
			);
			if (request.session !== this.#session) {
				throw new AgentRequestError(
					'The request was written for an earlier listening session. Send it again.',
					id
				);
			}
			record.kind = request.kind;
			if (request.kind === 'describe') {
				// Reads nothing but the open design, so there is nothing to acknowledge first.
				record.apply = false;
				await removeFile(dir, requestPath);
				record.status = 'done';
			} else {
				record.script = request.script;
				record.mode = request.mode;
				record.apply = request.mode === 'apply';
				record.params = { ...plugin.paramValues, ...(request.params ?? {}) };
				// Acknowledge, then take the request: a crash in between leaves a request the next
				// listening session rejects, never one that runs twice.
				await writeRecord();
				await removeFile(dir, requestPath);
				this.current = { id, script: request.script };
				void this.heartbeat();

				let entrypoint: { path: string; code: Uint8Array } | undefined;
				if (request.script) {
					let file: File;
					try {
						file = await (await getFileHandle(dir, request.script)).getFile();
					} catch {
						throw new AgentRequestError(`"${request.script}" was not found in the folder.`, id);
					}
					if (file.size > MAX_AGENT_SCRIPT_BYTES) {
						throw new AgentRequestError(
							`"${request.script}" is larger than ${formatMb(MAX_AGENT_SCRIPT_BYTES)}.`,
							id
						);
					}
					const code = new Uint8Array(await file.arrayBuffer());
					entrypoint = { path: request.script, code };
					record.scriptSha256 = await sha256Hex(code);
				}
				record.designBefore = await partHash();
				ensureLive();

				if (plugin.status !== 'active') await coordinator.activate(pluginId);
				ensureLive();
				const outcome = await coordinator.runWithOptions(pluginId, {
					params: record.params,
					entrypoint,
				});

				if (outcome.kind === 'cancelled') {
					record.status = 'cancelled';
					record.error =
						outcome.reason === 'stopped'
							? 'The user stopped the run.'
							: outcome.reason === 'input-review-declined'
								? "The user declined to run on input cadnano JSON can't hold."
								: 'Plugin dev mode was turned off.';
				} else if (outcome.kind === 'invalid-result') {
					record.status = 'error';
					record.error = outcome.message;
				} else {
					record.activeRegionId = outcome.activeRegionId;
					record.bundleSha256 = outcome.zip ? await sha256Hex(outcome.zip) : null;
					const token = outcome.resultToken;
					const pending = coordinator.pendingApply;
					if (token && pending?.resultToken === token) record.summary = pending.summary;
					let applyOutcome: AgentApplyOutcome = token ? 'pending-review' : 'nothing';
					let previewError: string | null = null;
					if (token && request.mode === 'dry-run') {
						try {
							const preview = coordinator.previewPendingResult(pluginId, token);
							applyOutcome =
								preview === 'stale' ? 'stale' : preview === 'none' ? 'nothing' : 'dry-run';
							if (typeof preview !== 'string') previewPart = preview;
						} catch (e) {
							applyOutcome = 'failed';
							previewError = e instanceof Error ? e.message : String(e);
						}
						// Never left for the user to apply: a dry run changes nothing.
						if (coordinator.pendingApply?.resultToken === token) coordinator.cancelApply(pluginId);
					} else if (token && request.mode === 'apply' && live()) {
						const applied = coordinator.confirmApply(pluginId, token);
						applyOutcome =
							applied === 'applied'
								? 'applied'
								: applied === 'stale' || applied === 'not-owner' || applied === 'failed'
									? applied
									: 'failed';
					}
					if (applyOutcome === 'not-owner') applyOutcome = 'pending-review';
					record.applyOutcome = applyOutcome;
					record.applied = applyOutcome === 'applied';
					if (applyOutcome === 'pending-review' && token) {
						this.#reviewRecords.set(token, { dir, record });
					}
					if (applyOutcome === 'failed') {
						record.status = 'error';
						record.error = previewError
							? `Applying this result would fail: ${previewError}`
							: (plugin.errorMessage ?? 'Applying the result failed.');
					} else {
						record.status = 'done';
						if (applyOutcome === 'stale') {
							record.error =
								request.mode === 'dry-run'
									? 'Not previewed: the design changed while the script ran. Run it again.'
									: 'Not applied: the design changed while the script ran. Run it again on the current design.';
						} else if (applyOutcome === 'pending-review' && request.mode === 'apply') {
							record.error =
								'Not applied yet: agent runs stopped, or another tab took the design, before the ' +
								'result could be applied. It waits in the editor for Apply or Discard.';
						}
					}
				}
			}
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (e instanceof AgentRequestError) {
				record.status = 'rejected';
				record.error = message;
			} else if (e instanceof ListenerStoppedError) {
				record.status = 'interrupted';
				record.error = 'Agent runs stopped before the script ran.';
			} else {
				record.status = 'error';
				// A failed run put the folder-relative message and traceback on the plugin.
				const failed = ranThisRequest() && plugin.status === 'error';
				record.error = failed ? (plugin.errorMessage ?? message) : message;
				record.traceback = failed ? plugin.errorTraceback : null;
			}
			await removeFile(dir, requestPath).catch(() => {});
		} finally {
			this.current = null;
		}
		if (ranThisRequest()) {
			record.logs = [...plugin.logs];
			record.result = plugin.pluginResult;
			record.artifacts = Object.keys(plugin.artifacts);
			record.mutationCount = plugin.lastRunMutationLogLength;
		}
		record.designAfter = await partHash().catch(() => null);
		if (record.status === 'done') record.overview = this.#overview(previewPart ?? undefined);
		record.finishedAt = isoTime(this.#now());
		record.durationMs = this.#now() - startedAt;
		await writeRecord();
		this.lastRun = record;
		await this.heartbeat();
	}

	/** Never fails a run: a broken overview is logged and left out. */
	#overview(part?: Part): DesignOverview | null {
		try {
			return this.#deps.getOverview?.(part) ?? null;
		} catch (e) {
			console.warn('[AgentRunListener] Failed to build the design overview:', e);
			return null;
		}
	}

	#activity(): AgentListenerActivity {
		if (this.current) return this.#deps.isAwaitingUser?.() ? 'awaiting-user' : 'running';
		return this.#deps.getCoordinator().pendingApply ? 'awaiting-review' : 'idle';
	}

	async #writeListener(
		dir: FileSystemDirectoryHandle,
		plugin: PythonPlugin,
		state: AgentListenerState,
		reason: string | null
	): Promise<void> {
		const connection = this.connection;
		const info: AgentListenerInfo = {
			protocol: AGENT_PROTOCOL,
			pluginId: plugin.manifest.id,
			folderName: plugin.linked?.folderName ?? dir.name,
			docId: connection?.docId ?? '',
			docName: connection?.docName ?? '',
			session: state === 'listening' ? this.#session : null,
			state,
			reason,
			activity: state === 'listening' ? this.#activity() : 'idle',
			requestId: this.current?.id ?? null,
			heartbeatAt: this.#now(),
		};
		await writeFile(dir, AGENT_LISTENER_FILE, `${JSON.stringify(info, null, 2)}\n`);
		this.#lastHeartbeat = info.heartbeatAt;
		this.#lastWrittenState = state;
	}

	async #tryLock(name: string): Promise<(() => void) | null> {
		const locks = this.#locks;
		if (!locks) return () => {};
		return new Promise((resolve, reject) => {
			locks
				.request(name, { ifAvailable: true }, (lock) => {
					if (!lock) {
						resolve(null);
						return;
					}
					return new Promise<void>((release) => resolve(release));
				})
				.catch(reject);
		});
	}

	#unlock(): void {
		const release = this.#releaseLock;
		this.#releaseLock = null;
		this.#dir = null;
		release?.();
	}

	/** Stops this tab's part of the connection without touching the saved setting. */
	async #endLocally(): Promise<void> {
		const plugin = this.connection ? this.#deps.registry.get(this.connection.pluginId) : null;
		const dir = this.#dir;
		const held = this.#releaseLock !== null;
		this.#generation++;
		this.#clearTimers();
		this.#session = null;
		this.connection = null;
		this.state = 'off';
		this.pausedReason = null;
		if (held && dir && plugin) {
			try {
				await this.#writeListener(dir, plugin, 'stopped', null);
			} catch (e) {
				console.warn('[AgentRunListener] Failed to mark the folder as not listening:', e);
			}
		}
		this.#unlock();
	}

	/**
	 * run.py and AGENTS.md (replacing older generated, unedited ones), the API stubs, and
	 * CLAUDE.md / pyrightconfig.json when missing.
	 */
	async #writeAgentFiles(dir: FileSystemDirectoryHandle, plugin: PythonPlugin): Promise<void> {
		const existing = async (path: string): Promise<string | null> => {
			try {
				return new TextDecoder().decode(await readFileBytes(await getFileHandle(dir, path)));
			} catch {
				return null;
			}
		};
		const cli = await existing(AGENT_CLI_PATH);
		if (cli === null || (isGeneratedAgentCli(cli) && cli !== agentCliText())) {
			await writeFile(dir, AGENT_CLI_PATH, agentCliText());
		}
		const agentsMd = await existing('AGENTS.md');
		if (agentsMd === null || (await isUneditedAgentsMd(agentsMd))) {
			const text = await agentsMdFile(plugin.manifest, this.#deps.origin);
			if (text !== agentsMd) await writeFile(dir, 'AGENTS.md', text);
		}
		if ((await existing('CLAUDE.md')) === null) await writeFile(dir, 'CLAUDE.md', CLAUDE_MD_TEXT);
		// Generated and never edited by hand, so always the current API, also offline.
		for (const [path, text] of Object.entries(await loadApiStubs())) {
			await writeFile(dir, `${STUBS_DIR}/${path}`, text);
		}
		if ((await existing('pyrightconfig.json')) === null) {
			await writeFile(dir, 'pyrightconfig.json', pyrightConfigText());
		}
		await dir.getDirectoryHandle(AGENT_SCRIPTS_DIR, { create: true });
	}

	#connect(connection: AgentConnection): void {
		this.#clearTimers();
		this.#unlock();
		this.#generation++;
		this.#session = null;
		this.#lastWrittenState = null;
		this.connection = connection;
		this.state = 'paused';
		this.pausedReason = null;
		if (this.#deps.autoPoll !== false) {
			this.#pollTimer = setInterval(() => void this.tick(), POLL_MS);
			this.#heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
		}
	}

	#clearTimers(): void {
		if (this.#pollTimer) clearInterval(this.#pollTimer);
		if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
		this.#pollTimer = null;
		this.#heartbeatTimer = null;
	}

	#linked(pluginId: string): PythonPlugin {
		const plugin = this.#deps.registry.get(pluginId);
		if (plugin?.origin !== 'linked' || !plugin.linked) {
			throw new Error(`"${pluginId}" is not a linked plugin.`);
		}
		return plugin;
	}
}
