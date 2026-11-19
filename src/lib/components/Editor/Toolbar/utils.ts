import type FoldnanoDocument from '$lib/model/document.svelte';
import { stringifyDesignFile } from '$lib/model/documentFormat';
import { withExportStamp } from '$lib/model/exportStamp';
import { trustedNow } from '$lib/services/serverClock';
import { exportBaseName, FN_JSON_EXT } from '$lib/model/io/designFileName';

export function downloadJsonAsTextFile(jsonString: string, filename: string = 'data.txt') {
	// Create a Blob with the JSON string
	const blob = new Blob([jsonString], { type: 'text/plain;charset=utf-8' });

	// Create a temporary URL for the blob
	const url = URL.createObjectURL(blob);

	// Create an invisible <a> element
	const link = document.createElement('a');
	link.href = url;
	link.download = filename;

	// Trigger the download
	document.body.appendChild(link);
	link.click();

	// Clean up
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/**
 * Downloads the document as a .fn.json file, stamped with the download time and a content hash
 * so opening it again can compare it with this browser's copy. Also the escape hatch when browser
 * storage fails.
 */
export async function downloadFoldnanoJson(doc: FoldnanoDocument): Promise<void> {
	const name = `${exportBaseName(doc.name)}${FN_JSON_EXT}`;
	// Read before waiting for the clock, so the file is what was on screen when clicked.
	const snapshot = doc.snapshot();
	let file: object = snapshot;
	try {
		file = await withExportStamp(snapshot, await trustedNow());
	} catch (e) {
		// No WebCrypto (an insecure origin): the file is still worth having without its stamp.
		console.warn('[downloadFoldnanoJson] Downloading without an export stamp:', e);
	}
	downloadJsonAsTextFile(stringifyDesignFile(file), name);
}
