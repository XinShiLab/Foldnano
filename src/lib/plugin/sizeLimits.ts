/**
 * Size limits for plugin files, enforced before anything large is held in memory.
 * Run-output limits (logs, artifacts) live in the worker; see docs/python-plugin-system.md
 * § Size limits.
 */

import { unzipSync, type Unzipped } from 'fflate';

const MB = 1024 * 1024;

/** A plugin zip, downloaded or imported. */
export const MAX_PLUGIN_ZIP_BYTES = 50 * MB;
/** A wheel fetched at activation. */
export const MAX_WHEEL_BYTES = 50 * MB;
/** All entries of a plugin zip once decompressed (guards against zip bombs). */
export const MAX_PLUGIN_UNZIPPED_BYTES = 200 * MB;

export const formatMb = (bytes: number): string => `${Math.round(bytes / MB)} MB`;

/**
 * Reads a response body, aborting as soon as it passes `maxBytes` instead of buffering it all.
 * `label` names the file in the error message.
 */
export async function readResponseCapped(
	response: Response,
	maxBytes: number,
	label: string
): Promise<Uint8Array> {
	const tooLarge = () => new Error(`${label} is larger than the ${formatMb(maxBytes)} limit.`);
	const declared = Number(response.headers?.get('Content-Length') ?? NaN);
	if (Number.isFinite(declared) && declared > maxBytes) {
		await response.body?.cancel();
		throw tooLarge();
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > maxBytes) throw tooLarge();
		return bytes;
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw tooLarge();
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * `unzipSync` that refuses archives whose entries would decompress to more than
 * `maxTotalBytes`. The check runs on each entry's declared size before anything is inflated;
 * fflate then inflates into a buffer of exactly that size, so a lying header can't grow past it.
 */
export function unzipCapped(
	bytes: Uint8Array,
	maxTotalBytes = MAX_PLUGIN_UNZIPPED_BYTES
): Unzipped {
	let total = 0;
	return unzipSync(bytes, {
		filter: (file) => {
			total += file.originalSize;
			if (total > maxTotalBytes) {
				throw new Error(
					`The zip expands to more than ${formatMb(maxTotalBytes)}; plugin zips must stay under that once unpacked.`
				);
			}
			return true;
		},
	});
}
