import type { SelectAllMode, SelectionToggle } from '../context/types';

export interface SelectAllOption {
	value: SelectAllMode;
	label: string;
	/** The filter kind the option grows; disabled while that kind is off. */
	enabledFor?: SelectionToggle;
}

/** "Select all with" choices, shared by the strand view's Select panel and the 3D panel. */
export const SELECT_ALL_OPTIONS: readonly SelectAllOption[] = [
	{ value: 'NONE', label: 'Where I click ' },
	{ value: 'SAME_COLOR', label: 'Same Color', enabledFor: 'OLIGO' },
	{ value: 'SAME_LENGTH', label: 'Same Length', enabledFor: 'OLIGO' },
	{ value: 'SAME_MODI', label: 'Same Modification', enabledFor: 'END' },
];
