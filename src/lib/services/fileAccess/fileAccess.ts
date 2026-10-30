/**
 * Thin, feature-agnostic layer over the File System Access API (Chromium only). Callers own what
 * the files mean; see docs/file-access.md.
 */

export type FileAccessMode = 'read' | 'readwrite';

/** Access to a stored handle: granted, needs a prompt from a user gesture, or refused. */
export type HandleAccess = 'granted' | 'prompt' | 'denied';

export class FileAccessUnsupportedError extends Error {
	constructor() {
		super(
			'This browser cannot open folders from disk. Use a Chromium-based browser (Chrome, Edge, Brave, Arc).'
		);
		this.name = 'FileAccessUnsupportedError';
	}
}

/** Walk refused to read a folder that exceeds its limits. */
export class FolderTooLargeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FolderTooLargeError';
	}
}

export function supportsFileSystemAccess(): boolean {
	return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/** Opens the folder picker; resolves null when the user cancels. */
export async function pickDirectory(
	options: { id?: string; mode?: FileAccessMode } = {}
): Promise<FileSystemDirectoryHandle | null> {
	if (!supportsFileSystemAccess() || !window.showDirectoryPicker) {
		throw new FileAccessUnsupportedError();
	}
	try {
		return await window.showDirectoryPicker({ id: options.id, mode: options.mode ?? 'read' });
	} catch (e) {
		if (e instanceof DOMException && e.name === 'AbortError') return null;
		throw e;
	}
}

export async function queryAccess(
	handle: FileSystemHandle,
	mode: FileAccessMode = 'read'
): Promise<HandleAccess> {
	return handle.queryPermission({ mode });
}

/**
 * Resolves true when `mode` access is granted, prompting if needed. A prompt needs a live user
 * gesture: call this first in a click handler, before other awaits.
 */
export async function ensureAccess(
	handle: FileSystemHandle,
	mode: FileAccessMode = 'read'
): Promise<boolean> {
	if ((await handle.queryPermission({ mode })) === 'granted') return true;
	return (await handle.requestPermission({ mode })) === 'granted';
}

export interface WalkOptions {
	/** Relative POSIX path (dirs end without '/') → skip it and, for a dir, everything under it. */
	ignore?: (path: string, kind: 'file' | 'directory') => boolean;
	maxFiles?: number;
	maxBytes?: number;
}

export interface WalkedFile {
	/** POSIX path relative to the walked folder. */
	path: string;
	handle: FileSystemFileHandle;
	size: number;
}

/** Lists files under `dir` without reading their contents; enforces the limits as it goes. */
export async function walkDirectory(
	dir: FileSystemDirectoryHandle,
	options: WalkOptions = {}
): Promise<WalkedFile[]> {
	const { ignore, maxFiles = Infinity, maxBytes = Infinity } = options;
	const files: WalkedFile[] = [];
	let totalBytes = 0;
	const visit = async (folder: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
		for await (const entry of folder.values()) {
			const path = prefix + entry.name;
			if (ignore?.(path, entry.kind)) continue;
			if (entry.kind === 'directory') {
				await visit(entry, `${path}/`);
				continue;
			}
			const size = (await entry.getFile()).size;
			totalBytes += size;
			files.push({ path, handle: entry, size });
			if (files.length > maxFiles) {
				throw new FolderTooLargeError(`The folder has more than ${maxFiles} files.`);
			}
			if (totalBytes > maxBytes) {
				throw new FolderTooLargeError(
					`The folder's files add up to more than ${Math.round(maxBytes / 1024 / 1024)} MB.`
				);
			}
		}
	};
	await visit(dir, '');
	return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function readFileBytes(handle: FileSystemFileHandle): Promise<Uint8Array> {
	return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

/** Resolves a relative POSIX path to a file handle, creating folders and the file if asked. */
export async function getFileHandle(
	dir: FileSystemDirectoryHandle,
	path: string,
	options: { create?: boolean } = {}
): Promise<FileSystemFileHandle> {
	const parts = path.split('/').filter(Boolean);
	const name = parts.pop();
	if (!name) throw new Error(`Invalid file path "${path}".`);
	let folder = dir;
	for (const part of parts) {
		folder = await folder.getDirectoryHandle(part, { create: options.create });
	}
	return folder.getFileHandle(name, { create: options.create });
}

export async function writeFile(
	dir: FileSystemDirectoryHandle,
	path: string,
	contents: Uint8Array | string
): Promise<void> {
	const handle = await getFileHandle(dir, path, { create: true });
	const writable = await handle.createWritable();
	try {
		await writable.write(contents as FileSystemWriteChunkType);
	} finally {
		await writable.close();
	}
}

/** Resolves a relative POSIX folder path; null when any part of it doesn't exist. */
async function findDirectory(
	dir: FileSystemDirectoryHandle,
	path: string
): Promise<FileSystemDirectoryHandle | null> {
	let folder = dir;
	for (const part of path.split('/').filter(Boolean)) {
		try {
			folder = await folder.getDirectoryHandle(part);
		} catch (e) {
			if (
				e instanceof DOMException &&
				(e.name === 'NotFoundError' || e.name === 'TypeMismatchError')
			)
				return null;
			throw e;
		}
	}
	return folder;
}

/** Names of the files directly inside `path`; empty when the folder doesn't exist. */
export async function listFileNames(
	dir: FileSystemDirectoryHandle,
	path: string
): Promise<string[]> {
	const folder = await findDirectory(dir, path);
	if (!folder) return [];
	const names: string[] = [];
	for await (const entry of folder.values()) if (entry.kind === 'file') names.push(entry.name);
	return names.sort();
}

/** Deletes a file; a file that is already gone is not an error. */
export async function removeFile(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
	const slash = path.lastIndexOf('/');
	const folder = await findDirectory(dir, slash < 0 ? '' : path.slice(0, slash));
	if (!folder) return;
	try {
		await folder.removeEntry(path.slice(slash + 1));
	} catch (e) {
		if (e instanceof DOMException && e.name === 'NotFoundError') return;
		throw e;
	}
}

/** Names the OS or tools drop into folders on their own; they don't make a folder "used". */
const NOISE_ENTRIES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.git']);

/** True when the folder holds nothing but OS/VCS noise (e.g. a fresh `git init`). */
export async function isEffectivelyEmpty(dir: FileSystemDirectoryHandle): Promise<boolean> {
	for await (const entry of dir.values()) {
		if (!NOISE_ENTRIES.has(entry.name)) return false;
	}
	return true;
}

/** A moved or deleted folder surfaces as NotFoundError on first use. */
export function isMissingHandleError(e: unknown): boolean {
	return e instanceof DOMException && e.name === 'NotFoundError';
}
