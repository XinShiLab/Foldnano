import { command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';

import {
	seenAnnouncementId,
	setSeenAnnouncementCookie,
	setSeenWhatsNewCookie,
} from '$lib/server/announcements';
import { advanceAnnouncementWatermark, latestEntryKey } from '$lib/whats-new/entries';

export const markAnnouncementSeen = command(v.string(), (id) => {
	const { cookies, url } = getRequestEvent();
	const next = advanceAnnouncementWatermark(seenAnnouncementId(cookies), id);
	if (next === null) error(400, 'Unknown announcement');
	setSeenAnnouncementCookie(cookies, next, url.protocol === 'https:');
});

// Takes no key: the server's own newest entry is what the client's build shows, or newer.
export const markWhatsNewSeen = command(() => {
	const { cookies, url } = getRequestEvent();
	const key = latestEntryKey();
	if (key !== null) setSeenWhatsNewCookie(cookies, key, url.protocol === 'https:');
});
