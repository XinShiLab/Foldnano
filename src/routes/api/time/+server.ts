import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** GET: the server's clock, so download stamps don't depend on this computer's clock. */
export const GET: RequestHandler = () =>
	json({ now: Date.now() }, { headers: { 'cache-control': 'no-store' } });
