export interface GitHubRepoContext {
	owner: string;
	repo: string;
	branch: string;
}

export interface GitHubFileMetadata {
	path: string;
	sha: string;
	owner: string;
	repo: string;
	branch: string;
	/** Unix timestamp of the last successful GitHub sync (open, commit, or pull). */
	lastSyncAt?: number;
	/** SHA of the GitHub commit this local copy is based on (set after commit or load). */
	commitSha?: string;
}
