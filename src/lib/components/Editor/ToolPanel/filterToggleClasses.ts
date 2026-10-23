// Off reads as greyed out; on gets full colour, so state doesn't hinge on the faint bg-muted fill.
// Hover only darkens the text: a hover fill would look the same as the on state's bg-muted.
const STATE =
	'text-muted-foreground/50 hover:text-muted-foreground hover:bg-transparent data-[state=on]:hover:bg-muted';

export const FILTER_TOGGLE_CLASS = `${STATE} data-[state=on]:text-foreground data-[state=on]:hover:text-foreground`;
export const SCAF_TOGGLE_CLASS = `w-12 text-xs ${STATE} data-[state=on]:text-sky-800 data-[state=on]:hover:text-sky-800`;
export const STAP_TOGGLE_CLASS = `w-12 text-xs ${STATE} data-[state=on]:text-red-800 data-[state=on]:hover:text-red-800`;
