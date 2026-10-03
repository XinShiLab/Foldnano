import type FoldnanoDocument from '$lib/model/document.svelte';

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

/** Downloads the document as a .fn.json file; the escape hatch when browser storage fails. */
export function downloadFoldnanoJson(doc: FoldnanoDocument): void {
	downloadJsonAsTextFile(JSON.stringify(doc.toJSON()), `${doc.name}.fn.json`);
}
