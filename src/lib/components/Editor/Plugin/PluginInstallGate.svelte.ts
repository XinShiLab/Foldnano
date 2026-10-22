import type { PluginManifest } from '$lib/plugin/types';
import type { PluginRegistry } from '$lib/plugin/PluginRegistry.svelte';
import type { PreparedInstall } from '$lib/plugin/PluginInstaller';
import type { IndexedDbPluginFilesRecord } from '$lib/services/storage/indexedDbTypes';
import { InvalidOperationError } from '$lib/errors';
import { reportError } from '$lib/errorReporting';

export interface PendingInstall {
	incoming: PluginManifest;
	files: IndexedDbPluginFilesRecord | null;
	/** The installed version being replaced, or null for a new install awaiting review. */
	existing: PluginManifest | null;
	/** An exported owned plugin; a new install may restore it as editable. */
	restorable: boolean;
	/** Replacing a plugin made here with a package its editor can't handle. */
	endsEditing?: boolean;
}

export interface InstallRequestOptions {
	/** Park a new install for the user to review before it is registered. */
	review?: boolean;
}

export type InstallOutcome =
	| { status: 'installed'; manifest: PluginManifest }
	| { status: 'blocked' }
	| { status: 'cancelled' }
	| { status: 'error'; message: string };

type InstallCommitRegistry = Pick<
	PluginRegistry,
	'registerNew' | 'replaceConfirmed' | 'isPluginBusyForInstall'
>;

const ERROR_CONTEXT = 'plugin:install';

export class PluginInstallGate {
	// Keep persistence payloads unproxied so IndexedDB can clone them.
	pending: PendingInstall | null = $state.raw(null);

	#inFlight = false;
	#resolvePending: ((outcome: InstallOutcome) => void) | null = null;
	readonly #getRegistry: () => InstallCommitRegistry;

	constructor(getRegistry: () => InstallCommitRegistry) {
		this.#getRegistry = getRegistry;
	}

	async requestInstall(
		prepare: () => Promise<PreparedInstall>,
		{ review = false }: InstallRequestOptions = {}
	): Promise<InstallOutcome> {
		if (this.#inFlight) {
			const message = 'Another plugin install is already in progress.';
			reportError(new Error(message), ERROR_CONTEXT, { notify: false });
			return { status: 'error', message };
		}
		// Set before the first await so a concurrent call is refused during prepare().
		this.#inFlight = true;
		try {
			let prepared: PreparedInstall;
			try {
				prepared = await prepare();
			} catch (e) {
				reportError(e, ERROR_CONTEXT, { notify: false });
				return { status: 'error', message: e instanceof Error ? e.message : String(e) };
			}
			switch (prepared.status) {
				case 'ready':
					if (review) {
						return await this.#park({
							incoming: prepared.manifest,
							files: prepared.files,
							existing: null,
							restorable: prepared.restorable ?? false,
						});
					}
					try {
						await this.#getRegistry().registerNew(prepared.manifest, prepared.files);
					} catch (e) {
						reportError(e, ERROR_CONTEXT, { notify: false });
						return { status: 'error', message: e instanceof Error ? e.message : String(e) };
					}
					return { status: 'installed', manifest: prepared.manifest };
				case 'blocked-builtin':
				case 'blocked-busy':
					reportError(new InvalidOperationError(prepared.message), ERROR_CONTEXT);
					return { status: 'blocked' };
				case 'needs-confirm':
					return await this.#park({
						incoming: prepared.incoming,
						files: prepared.files,
						existing: prepared.existing,
						restorable: prepared.restorable ?? false,
						...(prepared.endsEditing ? { endsEditing: true } : {}),
					});
			}
		} finally {
			this.#inFlight = false;
		}
	}

	#park(pending: PendingInstall): Promise<InstallOutcome> {
		return new Promise<InstallOutcome>((resolve) => {
			this.#resolvePending = resolve;
			this.pending = pending;
		});
	}

	/** `asEditable` restores a restorable new install as an owned, editable plugin. */
	async confirmPending({ asEditable = false }: { asEditable?: boolean } = {}): Promise<void> {
		const pending = this.pending;
		const resolve = this.#resolvePending;
		if (!pending || !resolve) return;
		this.pending = null;
		this.#resolvePending = null;
		try {
			// Re-check: the plugin may have gone busy while the dialog was open.
			const busy = this.#getRegistry().isPluginBusyForInstall(pending.incoming.id);
			if (busy.busy) {
				const message = `Cannot install "${pending.incoming.id}": ${busy.reason ?? 'currently busy'}.`;
				reportError(new InvalidOperationError(message), ERROR_CONTEXT);
				resolve({ status: 'blocked' });
				return;
			}
			if (pending.existing) {
				await this.#getRegistry().replaceConfirmed(pending.incoming, pending.files);
			} else {
				const registry = this.#getRegistry();
				if (asEditable && pending.restorable) {
					await registry.registerNew(pending.incoming, pending.files, {
						authoring: { source: 'scriptLab' },
					});
				} else {
					await registry.registerNew(pending.incoming, pending.files);
				}
			}
			resolve({ status: 'installed', manifest: pending.incoming });
		} catch (e) {
			reportError(e, ERROR_CONTEXT, { notify: false });
			resolve({ status: 'error', message: e instanceof Error ? e.message : String(e) });
		}
	}

	cancelPending(): void {
		const resolve = this.#resolvePending;
		this.pending = null;
		this.#resolvePending = null;
		resolve?.({ status: 'cancelled' });
	}
}
