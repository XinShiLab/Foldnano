import type { ClientInit, HandleClientError } from '@sveltejs/kit';
import { installGlobalErrorCapture, reportUncaughtError } from '$lib/globalErrorCapture';

export const init: ClientInit = () => {
	installGlobalErrorCapture();
};

export const handleError: HandleClientError = ({ error, status }) => {
	// A missing page is a navigation outcome, not a bug.
	if (status === 404) return;
	reportUncaughtError(error, 'sveltekit');
};
