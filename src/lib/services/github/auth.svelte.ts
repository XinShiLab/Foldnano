/**
 * Client-side GitHub auth service with reactive state (Svelte 5 runes).
 */
import type { AuthStatus, GitHubUser } from './types';

class GitHubAuthState {
	authenticated = $state(false);
	user = $state<GitHubUser | undefined>(undefined);
	loading = $state(false);
	/** Signed in earlier, but GitHub no longer accepts the session; drives the sign-in banner. */
	sessionExpired = $state(false);

	get isAuthenticated() {
		return this.authenticated;
	}
}

export const githubAuth = new GitHubAuthState();

/** Redirect to GitHub OAuth flow; `returnTo` (a same-site path) is where sign-in comes back to. */
export function loginWithGitHub(returnTo?: string): void {
	window.location.href = returnTo
		? `/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`
		: '/api/auth/github';
}

/** A GitHub request was refused (401); only someone who was signed in sees "session expired". */
export function markGitHubSessionExpired(wasSignedIn: boolean): void {
	if (wasSignedIn) githubAuth.sessionExpired = true;
	githubAuth.authenticated = false;
	githubAuth.user = undefined;
}

/** Log out and clear server cookie. */
export async function logout(): Promise<void> {
	await fetch('/api/auth/github/logout', { method: 'POST' });
	githubAuth.authenticated = false;
	githubAuth.user = undefined;
	githubAuth.sessionExpired = false;
}

/** Check current auth status from server. */
export async function getAuthStatus(): Promise<AuthStatus> {
	githubAuth.loading = true;
	try {
		const response = await fetch('/api/auth/github/status');
		const status: AuthStatus = await response.json();
		githubAuth.authenticated = status.authenticated;
		githubAuth.user = status.user;
		if (status.authenticated) githubAuth.sessionExpired = false;
		return status;
	} catch {
		githubAuth.authenticated = false;
		githubAuth.user = undefined;
		return { authenticated: false };
	} finally {
		githubAuth.loading = false;
	}
}
