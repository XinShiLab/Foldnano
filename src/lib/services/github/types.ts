/** GitHub API response types and internal types for the GitHub integration. */

export interface GitHubUser {
	login: string;
	avatar_url: string;
	name: string | null;
	html_url: string;
}

export interface GitHubRepo {
	id: number;
	name: string;
	full_name: string;
	owner: { login: string; avatar_url: string };
	private: boolean;
	html_url: string;
	default_branch: string;
	description: string | null;
	updated_at: string;
}

export interface GitHubBranch {
	name: string;
	commit: { sha: string; url: string };
	protected: boolean;
}

export interface GitHubTreeEntry {
	path: string;
	mode: string;
	type: 'blob' | 'tree' | 'commit';
	sha: string;
	size?: number;
	url: string;
}

export interface GitHubTree {
	sha: string;
	url: string;
	tree: GitHubTreeEntry[];
	truncated: boolean;
}

export interface GitHubFileContent {
	name: string;
	path: string;
	sha: string;
	size: number;
	type: 'file';
	content: string; // base64 encoded
	encoding: 'base64';
	html_url: string;
	download_url: string | null;
}

export interface GitHubCommit {
	sha: string;
	commit: {
		message: string;
		author: { name: string; email: string; date: string } | null;
		committer: { name: string; email: string; date: string } | null;
	};
	html_url: string;
	author: { login: string; avatar_url: string } | null;
	parents: { sha: string; url: string }[];
}

export interface GitHubPutFileRequest {
	message: string;
	content: string; // base64 encoded
	sha?: string; // required for updates, omit for new files
	branch?: string;
}

export interface GitHubPutFileResponse {
	content: {
		name: string;
		path: string;
		sha: string;
		html_url: string;
	};
	commit: {
		sha: string;
		message: string;
		html_url: string;
	};
}

export interface AuthStatus {
	authenticated: boolean;
	user?: GitHubUser;
}

export interface GitHubApiError {
	message: string;
	status: number;
	documentation_url?: string;
}
