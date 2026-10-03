// The approved cadnano build and generator contract, shared by the reference-contract check and its
// tests. Content hashes rather than a `git diff` hash: diff text varies with git version and eol.

export const EXPECTED_GENERATOR_VERSION = 3;

/** The exact provenance value; a substring check would accept "not sequenceExport". */
export const EXPECTED_SEQUENCE_SOURCE =
	'cadnano Oligo.sequenceExport (NucleicAcidPart.getSequences)';

export const APPROVED_CADNANO = {
	version: '2.5.2.1',
	commit: 'ce6ff019b88ee7728de947bd86b35861cf57848d',
	modifiedFileSha256: {
		'cadnano/part/nucleicacidpart.py':
			'bba71f56cef4c263311c5f6e005077a14271f87de4d526a5ba9c4a12910542f2',
		'cadnano/views/pathview/pathstyles.py':
			'6ff7cb5e2fde0e0b503cfcab3fec24926eda8e80ab844c45a9dbe487cbb3707b',
	},
} as const;
