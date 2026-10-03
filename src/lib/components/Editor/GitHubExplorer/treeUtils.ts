import type { FileNode } from './types';
import type { GitHubTreeEntry } from '$lib/services/github/types';

// ---------------------------------------------------------------------------
// Tree building — converts the flat GitHub API response to a nested FileNode tree
// ---------------------------------------------------------------------------

function sortNodes(nodes: FileNode[]): void {
	nodes.sort((a, b) => {
		if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	for (const n of nodes) {
		if (n.children) sortNodes(n.children);
	}
}

export function buildTree(entries: GitHubTreeEntry[]): FileNode[] {
	// Only include JSON files and their parent folders
	const jsonPaths = new Set(
		entries.filter((e) => e.type === 'blob' && e.path.endsWith('.json')).map((e) => e.path)
	);

	// Build set of required ancestor folders
	const requiredFolders = new Set<string>();
	for (const p of jsonPaths) {
		const parts = p.split('/');
		for (let i = 1; i < parts.length; i++) {
			requiredFolders.add(parts.slice(0, i).join('/'));
		}
	}

	const nodeMap = new Map<string, FileNode>();
	const root: FileNode[] = [];

	function getOrCreateFolder(path: string): FileNode {
		if (nodeMap.has(path)) return nodeMap.get(path)!;
		const name = path.split('/').pop()!;
		const node: FileNode = { name, path, type: 'folder', sha: '', children: [] };
		nodeMap.set(path, node);
		return node;
	}

	// Create folder nodes
	for (const folderPath of [...requiredFolders].sort()) {
		const folder = getOrCreateFolder(folderPath);
		const parentPath = folderPath.includes('/')
			? folderPath.split('/').slice(0, -1).join('/')
			: null;
		if (parentPath) {
			const parent = getOrCreateFolder(parentPath);
			if (!parent.children!.find((c: FileNode) => c.path === folderPath)) {
				parent.children!.push(folder);
			}
		} else {
			if (!root.find((n) => n.path === folderPath)) {
				root.push(folder);
			}
		}
	}

	// Create file nodes
	for (const entry of entries) {
		if (entry.type !== 'blob' || !entry.path.endsWith('.json')) continue;
		const name = entry.path.split('/').pop()!;
		const fileNode: FileNode = { name, path: entry.path, type: 'file', sha: entry.sha };
		nodeMap.set(entry.path, fileNode);
		const parentPath = entry.path.includes('/')
			? entry.path.split('/').slice(0, -1).join('/')
			: null;
		if (parentPath) {
			const parent = nodeMap.get(parentPath);
			if (parent?.children) {
				parent.children.push(fileNode);
			}
		} else {
			root.push(fileNode);
		}
	}

	sortNodes(root);
	return root;
}

// ---------------------------------------------------------------------------
// Tree merging — combines GitHub tree with local-only files and empty folders
// ---------------------------------------------------------------------------

export function collectPaths(nodes: FileNode[], result: Set<string> = new Set()): Set<string> {
	for (const n of nodes) {
		result.add(n.path);
		if (n.children) collectPaths(n.children, result);
	}
	return result;
}

export function findFolder(nodes: FileNode[], path: string): FileNode | null {
	for (const n of nodes) {
		if (n.type === 'folder' && n.path === path) return n;
		if (n.children) {
			const found = findFolder(n.children, path);
			if (found) return found;
		}
	}
	return null;
}

export function insertWithFolders(root: FileNode[], file: FileNode): void {
	const parts = file.path.split('/');
	let current = root;
	for (let i = 0; i < parts.length - 1; i++) {
		const folderPath = parts.slice(0, i + 1).join('/');
		let folder = current.find((n) => n.type === 'folder' && n.path === folderPath);
		if (!folder) {
			folder = { name: parts[i], path: folderPath, type: 'folder', sha: '', children: [] };
			current.push(folder);
		}
		current = folder.children!;
	}
	current.push(file);
}

export function treeHasPath(nodes: FileNode[], path: string): boolean {
	for (const n of nodes) {
		if (n.path === path) return true;
		if (n.children && treeHasPath(n.children, path)) return true;
	}
	return false;
}

function cloneTree(nodes: FileNode[]): FileNode[] {
	return nodes.map((n) => ({
		...n,
		children: n.children ? cloneTree(n.children) : undefined,
	}));
}

export function mergeLocalOnly(
	base: FileNode[],
	locals: FileNode[],
	folders: FileNode[] = []
): FileNode[] {
	if (locals.length === 0 && folders.length === 0) return base;

	const existingPaths = collectPaths(base);
	const merged = cloneTree(base);

	for (const local of locals) {
		if (existingPaths.has(local.path)) continue; // committed already
		const parts = local.path.split('/');
		if (parts.length === 1) {
			merged.push(local);
		} else {
			const folderPath = parts.slice(0, -1).join('/');
			const folder = findFolder(merged, folderPath);
			if (folder?.children) {
				folder.children.push(local);
			} else {
				insertWithFolders(merged, local);
			}
		}
	}

	// Insert local-only empty folder nodes
	for (const folder of folders) {
		if (existingPaths.has(folder.path)) continue;
		if (findFolder(merged, folder.path)) continue;
		const parts = folder.path.split('/');
		if (parts.length === 1) {
			merged.push({ ...folder, children: [] });
		} else {
			const parentPath = parts.slice(0, -1).join('/');
			const parent = findFolder(merged, parentPath);
			if (parent?.children) {
				parent.children.push({ ...folder, children: [] });
			} else {
				// Create parent chain then insert a placeholder, then replace with real folder
				const dummy: FileNode = {
					name: '__folder__',
					path: folder.path + '/__placeholder__',
					type: 'file',
					sha: '',
				};
				insertWithFolders(merged, dummy);
				const inserted = findFolder(merged, folder.path);
				if (inserted)
					inserted.children = inserted.children?.filter((c) => c.name !== '__folder__') ?? [];
			}
		}
	}

	return merged;
}
