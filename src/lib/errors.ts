export class EditorError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'EditorError';
	}
}

/** User attempted an operation that is not valid in the current state → warning toast, not the Error Log. */
export class InvalidOperationError extends EditorError {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidOperationError';
	}
}

/** Operation is structurally unsupported for this region or mode → warning toast, not the Error Log. */
export class OperationNotSupportedError extends EditorError {
	constructor(message: string) {
		super(message);
		this.name = 'OperationNotSupportedError';
	}
}
