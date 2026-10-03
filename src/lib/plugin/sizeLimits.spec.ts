import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readResponseCapped, unzipCapped } from './sizeLimits';

function streamedResponse(chunks: Uint8Array[], headers: Record<string, string> = {}): Response {
	let pulled = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (pulled < chunks.length) controller.enqueue(chunks[pulled++]);
			else controller.close();
		},
	});
	return new Response(body, { headers });
}

const chunk = (n: number) => new Uint8Array(n).fill(7);

describe('readResponseCapped', () => {
	it('returns the whole body when it is within the limit', async () => {
		const bytes = await readResponseCapped(streamedResponse([chunk(3), chunk(4)]), 10, 'File');
		expect(Array.from(bytes)).toEqual(Array(7).fill(7));
	});

	it('refuses up front when Content-Length is over the limit', async () => {
		const response = streamedResponse([chunk(1)], { 'Content-Length': '1000' });
		await expect(readResponseCapped(response, 10, 'The plugin zip')).rejects.toThrow(
			/The plugin zip is larger than the 0 MB limit/
		);
	});

	it('stops reading once the body passes the limit, even without a Content-Length', async () => {
		let served = 0;
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				served++;
				controller.enqueue(chunk(4));
			},
		});
		await expect(readResponseCapped(new Response(body), 10, 'Wheel "x.whl"')).rejects.toThrow(
			/Wheel "x.whl" is larger/
		);
		expect(served).toBeLessThan(10);
	});
});

describe('unzipCapped', () => {
	it('unzips archives within the limit', () => {
		const zip = zipSync({ 'a.txt': chunk(100), 'b.txt': chunk(100) });
		expect(Object.keys(unzipCapped(zip, 1000)).sort()).toEqual(['a.txt', 'b.txt']);
	});

	it('refuses an archive that would expand past the limit, before inflating it', () => {
		// 5 MB of zeros compresses to a few KB: a small zip bomb.
		const zip = zipSync({ 'bomb.bin': new Uint8Array(5 * 1024 * 1024) });
		expect(zip.byteLength).toBeLessThan(64 * 1024);
		expect(() => unzipCapped(zip, 1024 * 1024)).toThrow(/expands to more than/);
	});
});
