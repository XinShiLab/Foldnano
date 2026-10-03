import { injectAnalytics } from '@vercel/analytics/sveltekit';

import { dev } from '$app/environment';
import { redactAnalyticsEvent } from '$lib/analytics';

injectAnalytics({ mode: dev ? 'development' : 'production', beforeSend: redactAnalyticsEvent });
