/**
 * In-memory stand-ins for File System Access handles, for tests (jsdom has no such API).
 * Build from a tree: `memoryDirectory('plugin', { 'plugin.py': 'def run(ctx): ...', lib: { ... } })`.
 */

export type MemoryTree = { [name: string]: string | Uint8Array | MemoryTree };

export interface MemoryPermissions {
	read: PermissionState;
	readwrite: PermissionState;
	/** What requestPermission() turns a 'prompt' into. */
	onRequest: PermissionState;
}

function notFound(name: string): DOMException {
	return new DOMException(`"${name}" was not found.`, 'NotFoundError');
}

class MemoryFileHandle {
	readonly kind = 'file';
	constructor(
		readonly name: string,
		private readonly _parent: MemoryTree,
		private readonly _permissions: MemoryPermissions
	) {}

	async getFile(): Promise<File> {
		const value = this._parent[this.name];
		if (value === undefined || (typeof value === 'object' && !(value instanceof Uint8Array))) {
			throw notFound(this.name);
		}
		// jsdom's File has no arrayBuffer(); hand back just what callers use.
		const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
		return {
			name: this.name,
			size: bytes.byteLength,
			arrayBuffer: async () => bytes.slice().buffer,
		} as unknown as File;
	}

	async createWritable() {
		const chunks: Array<string | Uint8Array> = [];
		return {
			write: async (chunk: string | Uint8Array) => {
				chunks.push(chunk);
			},
			close: async () => {
				const parts = chunks.map((c) => (typeof c === 'string' ? new TextEncoder().encode(c) : c));
				const joined = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
				let offset = 0;
				for (const part of parts) {
					joined.set(part, offset);
					offset += part.byteLength;
				}
				this._parent[this.name] = joined;
			},
		};
	}

	async queryPermission({ mode = 'read' }: { mode?: 'read' | 'readwrite' } = {}) {
		return this._permissions[mode];
	}

	async requestPermission(descriptor: { mode?: 'read' | 'readwrite' } = {}) {
		return requestFrom(this._permissions, descriptor.mode ?? 'read');
	}
}

function requestFrom(permissions: MemoryPermissions, mode: 'read' | 'readwrite'): PermissionState {
	if (permissions[mode] === 'prompt') permissions[mode] = permissions.onRequest;
	if (mode === 'readwrite' && permissions.readwrite === 'granted') permissions.read = 'granted';
	return permissions[mode];
}

class MemoryDirectoryHandle {
	readonly kind = 'directory';
	/** Set to simulate the folder being moved or deleted. */
	missing = false;

	constructor(
		readonly name: string,
		readonly tree: MemoryTree,
		readonly permissions: MemoryPermissions
	) {}

	async *values() {
		if (this.missing) throw notFound(this.name);
		for (const [name, value] of Object.entries(this.tree)) {
			yield typeof value === 'object' && !(value instanceof Uint8Array)
				? new MemoryDirectoryHandle(name, value, this.permissions)
				: new MemoryFileHandle(name, this.tree, this.permissions);
		}
	}

	async getDirectoryHandle(name: string, { create = false } = {}) {
		if (this.missing) throw notFound(this.name);
		let value = this.tree[name];
		if (value === undefined && create) value = this.tree[name] = {};
		if (value === undefined || typeof value === 'string' || value instanceof Uint8Array) {
			throw notFound(name);
		}
		return new MemoryDirectoryHandle(name, value, this.permissions);
	}

	async getFileHandle(name: string, { create = false } = {}) {
		if (this.missing) throw notFound(this.name);
		if (this.tree[name] === undefined && create) this.tree[name] = '';
		const value = this.tree[name];
		if (value === undefined || (typeof value === 'object' && !(value instanceof Uint8Array))) {
			throw notFound(name);
		}
		return new MemoryFileHandle(name, this.tree, this.permissions);
	}

	async queryPermission({ mode = 'read' }: { mode?: 'read' | 'readwrite' } = {}) {
		return this.permissions[mode];
	}

	async requestPermission(descriptor: { mode?: 'read' | 'readwrite' } = {}) {
		return requestFrom(this.permissions, descriptor.mode ?? 'read');
	}
}

export type MemoryDirectory = MemoryDirectoryHandle & FileSystemDirectoryHandle;

export function memoryDirectory(
	name: string,
	tree: MemoryTree = {},
	permissions: Partial<MemoryPermissions> = {}
): MemoryDirectory {
	return new MemoryDirectoryHandle(name, tree, {
		read: 'granted',
		readwrite: 'prompt',
		onRequest: 'granted',
		...permissions,
	}) as unknown as MemoryDirectory;
}
