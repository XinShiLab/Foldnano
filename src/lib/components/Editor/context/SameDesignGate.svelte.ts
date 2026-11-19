import type { SameDesignAnswer, SameDesignQuestion } from './EditorDocumentSession.svelte';

/**
 * Parks the question `EditorDocumentSession` asks when a GitHub file's design id is already taken
 * here, until the user answers it in <SameDesignDialog>, mounted once in Editor.svelte.
 */
export class SameDesignGate {
	pending: SameDesignQuestion | null = $state.raw(null);

	#resolve: ((answer: SameDesignAnswer) => void) | null = null;

	request(question: SameDesignQuestion): Promise<SameDesignAnswer> {
		// A newer question supersedes an unanswered one.
		this.answer({ action: 'cancel' });
		return new Promise<SameDesignAnswer>((resolve) => {
			this.#resolve = resolve;
			this.pending = question;
		});
	}

	answer(answer: SameDesignAnswer): void {
		const question = this.pending;
		const resolve = this.#resolve;
		this.#resolve = null;
		this.pending = null;
		resolve?.(question && isValidAnswer(question, answer) ? answer : { action: 'cancel' });
	}
}

// Replace would take another repo file's link; a copy of one needs its own name.
function isValidAnswer(question: SameDesignQuestion, answer: SameDesignAnswer): boolean {
	if (answer.action === 'cancel') return true;
	if (question.kind === 'browser-only') return answer.action === 'replace' || !answer.name;
	return answer.action === 'copy' && !!answer.name?.trim();
}
