import { FN_JSON_EXT } from '$lib/model/io/designFileName';
import type { FileNode } from './types';

export { FN_JSON_EXT };

/** Only native Foldnano files can be renamed from the explorer; this is not a general file manager. */
export function isRenamableFile(node: FileNode): boolean {
	return node.type === 'file' && node.name.endsWith(FN_JSON_EXT);
}

export function fileStem(fileName: string): string {
	return fileName.endsWith(FN_JSON_EXT) ? fileName.slice(0, -FN_JSON_EXT.length) : fileName;
}
