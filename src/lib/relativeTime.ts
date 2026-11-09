/** "just now", "5m ago", "3h ago", "yesterday 14:02", else a short date and time. */
export function formatRelativeTime(ts: number, now = Date.now()): string {
	const d = new Date(ts);
	const diff = now - ts;
	const mins = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days === 1)
		return `yesterday ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
	return d.toLocaleString([], {
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}
