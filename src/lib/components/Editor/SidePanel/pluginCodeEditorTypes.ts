export type OutputStream = 'stdout' | 'stderr' | 'system';

export interface OutputEntry {
	stream: OutputStream;
	text: string;
	timestamp: string;
}

export interface ArtifactEntry {
	name: string;
	kind: string;
	description: string;
}
