/**
 * Cross-component open state for ErrorLogDialog. Lives outside any component tree so that
 * errorReporting.ts (a plain module, not a component) can open the dialog from a toast action.
 */
export const errorLogPanelState = $state({
	open: false,
	focusedEntryId: null as string | null,
});
