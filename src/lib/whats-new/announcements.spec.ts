import { describe, expect, it } from 'vitest';

import {
	advanceAnnouncementWatermark,
	announcementShowUntil,
	latestAnnouncementId,
	latestEntryKey,
	pendingAnnouncement,
	unreadEntryCount,
	type WhatsNewEntry,
} from './entries';

const announced = (date: string, extra: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({
	date,
	area: 'A',
	text: date,
	announce: { id: `${date}-x`, title: date, body: date },
	...extra,
});

const ENTRIES: WhatsNewEntry[] = [
	announced('2026-09-01'),
	{ date: '2026-08-15', area: 'A', text: 'plain' },
	announced('2026-08-01'),
	announced('2026-07-01'),
	announced('2026-09-20', { draft: true }),
];

describe('announcementShowUntil', () => {
	it('defaults to 90 days after the entry date', () => {
		expect(announcementShowUntil(announced('2026-01-01'))).toBe('2026-04-01');
	});

	it('uses an explicit showUntil', () => {
		const entry = announced('2026-01-01');
		const withUntil = { ...entry, announce: { ...entry.announce!, showUntil: '2026-01-10' } };
		expect(announcementShowUntil(withUntil)).toBe('2026-01-10');
	});

	it('is null for an entry without an announcement', () => {
		expect(announcementShowUntil({ date: '2026-01-01', area: 'A', text: 'x' })).toBeNull();
	});
});

describe('pendingAnnouncement', () => {
	it('shows the newest and counts older unseen ones when nothing was seen', () => {
		expect(pendingAnnouncement(null, '2026-09-02', ENTRIES)).toEqual({
			announcement: ENTRIES[0].announce,
			earlierCount: 2,
		});
	});

	it('counts only announcements newer than the watermark', () => {
		expect(pendingAnnouncement('2026-07-01-x', '2026-09-02', ENTRIES)?.earlierCount).toBe(1);
	});

	it('returns null once the newest was seen', () => {
		expect(pendingAnnouncement('2026-09-01-x', '2026-09-02', ENTRIES)).toBeNull();
	});

	it('skips expired announcements', () => {
		const pending = pendingAnnouncement(null, '2026-10-15', ENTRIES);
		expect(pending?.announcement.id).toBe('2026-09-01-x');
		expect(pending?.earlierCount).toBe(1);
		expect(pendingAnnouncement(null, '2026-12-31', ENTRIES)).toBeNull();
	});

	it("carries the entry's link", () => {
		const linked = announced('2026-09-01', { link: 'views#3d-view' });
		expect(pendingAnnouncement(null, '2026-09-02', [linked])?.link).toBe('views#3d-view');
	});

	it('ignores drafts', () => {
		expect(pendingAnnouncement('2026-09-01-x', '2026-09-21', ENTRIES)).toBeNull();
	});
});

describe('latestAnnouncementId', () => {
	it('is the newest published id, expired or not', () => {
		expect(latestAnnouncementId(ENTRIES)).toBe('2026-09-01-x');
		expect(latestAnnouncementId([])).toBeNull();
	});
});

describe('advanceAnnouncementWatermark', () => {
	it('moves forward to a known id', () => {
		expect(advanceAnnouncementWatermark(null, '2026-08-01-x', ENTRIES)).toBe('2026-08-01-x');
		expect(advanceAnnouncementWatermark('2026-07-01-x', '2026-09-01-x', ENTRIES)).toBe(
			'2026-09-01-x'
		);
	});

	it('never moves back', () => {
		expect(advanceAnnouncementWatermark('2026-09-01-x', '2026-07-01-x', ENTRIES)).toBe(
			'2026-09-01-x'
		);
	});

	it('rejects unknown and draft ids', () => {
		expect(advanceAnnouncementWatermark(null, 'nope', ENTRIES)).toBeNull();
		expect(advanceAnnouncementWatermark(null, '2026-09-20-x', ENTRIES)).toBeNull();
	});
});

describe('latestEntryKey', () => {
	it('combines the newest date with the number of entries on it', () => {
		const entries: WhatsNewEntry[] = [
			{ date: '2026-09-01', area: 'A', text: 'a' },
			{ date: '2026-09-01', area: 'A', text: 'b' },
			{ date: '2026-09-02', area: 'A', text: 'draft', draft: true },
			{ date: '2026-08-01', area: 'A', text: 'c' },
		];
		expect(latestEntryKey(entries)).toBe('2026-09-01#2');
		expect(latestEntryKey([])).toBeNull();
	});
});

describe('unreadEntryCount', () => {
	const entries: WhatsNewEntry[] = [
		{ date: '2026-09-03', area: 'A', text: 'newest' },
		{ date: '2026-09-01', area: 'A', text: 'added later the same day' },
		{ date: '2026-09-01', area: 'A', text: 'b' },
		{ date: '2026-09-02', area: 'A', text: 'draft', draft: true },
		{ date: '2026-08-01', area: 'A', text: 'c' },
	];

	it('counts newer dates plus extra entries on the seen date', () => {
		expect(unreadEntryCount('2026-09-01#1', entries)).toBe(2);
		expect(unreadEntryCount('2026-08-01#1', entries)).toBe(3);
	});

	it('is zero when the newest entry was seen', () => {
		expect(unreadEntryCount('2026-09-03#1', entries)).toBe(0);
	});

	it('is zero without a key or with a malformed one', () => {
		expect(unreadEntryCount(null, entries)).toBe(0);
		expect(unreadEntryCount('garbage', entries)).toBe(0);
	});
});
