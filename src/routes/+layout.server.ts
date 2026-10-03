import { hasDismissedBrowserNotice } from '$lib/server/browserNotice';
import { hasDismissedPrivacyNotice } from '$lib/server/privacyNotice';
import { hasSeenWorkspaceHelp } from '$lib/server/workspaceHelp';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ cookies }) => {
	return {
		privacyNoticeDismissed: hasDismissedPrivacyNotice(cookies),
		workspaceHelpSeen: hasSeenWorkspaceHelp(cookies),
		browserNoticeDismissed: hasDismissedBrowserNotice(cookies),
	};
};
