import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally before importing the module
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// We test the standalone functions, not the rune-based reactive state
// (which requires Svelte component context to compile $state)

function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

beforeEach(() => {
	mockFetch.mockReset();
});

describe('GitHub Auth client functions', () => {
	describe('loginWithGitHub', () => {
		it('sets window.location.href to /api/auth/github', async () => {
			// Mock window.location
			const hrefSetter = vi.fn();
			const originalLocation = window.location;
			Object.defineProperty(window, 'location', {
				value: { ...originalLocation, href: '' },
				writable: true,
				configurable: true,
			});
			Object.defineProperty(window.location, 'href', {
				set: hrefSetter,
				get: () => '',
				configurable: true,
			});

			const { loginWithGitHub } = await import('../auth.svelte');
			loginWithGitHub();
			expect(hrefSetter).toHaveBeenCalledWith('/api/auth/github');
			loginWithGitHub('/editor/doc 1?x=1');
			expect(hrefSetter).toHaveBeenCalledWith(
				'/api/auth/github?returnTo=%2Feditor%2Fdoc%201%3Fx%3D1'
			);

			// Restore
			Object.defineProperty(window, 'location', {
				value: originalLocation,
				writable: true,
				configurable: true,
			});
		});
	});

	describe('logout', () => {
		it('calls POST /api/auth/github/logout', async () => {
			mockFetch.mockResolvedValue(jsonResponse({ success: true }));

			const { logout } = await import('../auth.svelte');
			await logout();
			expect(mockFetch).toHaveBeenCalledWith('/api/auth/github/logout', { method: 'POST' });
		});
	});

	describe('getAuthStatus', () => {
		it('returns { authenticated: false } when no cookie', async () => {
			mockFetch.mockResolvedValue(jsonResponse({ authenticated: false }));

			const { getAuthStatus } = await import('../auth.svelte');
			const status = await getAuthStatus();
			expect(status).toEqual({ authenticated: false });
		});

		it('returns user data when authenticated', async () => {
			const authData = {
				authenticated: true,
				user: {
					login: 'alice',
					avatar_url: 'https://example.com/avatar.png',
					name: 'Alice',
					html_url: 'https://github.com/alice',
				},
			};
			mockFetch.mockResolvedValue(jsonResponse(authData));

			const { getAuthStatus } = await import('../auth.svelte');
			const status = await getAuthStatus();
			expect(status.authenticated).toBe(true);
			expect(status.user?.login).toBe('alice');
		});

		it('returns { authenticated: false } on fetch error', async () => {
			mockFetch.mockRejectedValue(new Error('network error'));

			const { getAuthStatus } = await import('../auth.svelte');
			const status = await getAuthStatus();
			expect(status.authenticated).toBe(false);
		});
	});
});
