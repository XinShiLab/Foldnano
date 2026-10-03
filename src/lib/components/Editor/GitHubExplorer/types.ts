export interface FileNode {
	name: string;
	path: string;
	type: 'file' | 'folder';
	sha: string;
	children?: FileNode[];
	localOnly?: boolean;
}

/** A file that has local changes not yet committed to GitHub. */
export interface ChangeEntry {
	path: string;
	name: string;
	/**
	 * 'added'    = local-only (new file not yet on GitHub)
	 * 'modified' = committed file with local edits
	 * 'deleted'  = committed file staged for deletion (will be deleted on commit)
	 */
	kind: 'added' | 'modified' | 'deleted';
	/** SHA of the committed file — required for deleted entries to call the GitHub DELETE API. */
	sha?: string;
}
