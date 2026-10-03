import type Oligo from '../model/Oligo';
import type { Part } from '../model/Part';
import type { RepeatGroup } from '../model/Part/Part.svelte';
import {
	addRepeatInstance,
	createRepeatGroup,
	deleteRepeatGroup,
	detachRepeatGroup,
	removeRepeatInstance,
} from '../model/Part/repeatGroups';
import type { HistoryStack } from './history.svelte';

// Each command only edits group definitions; the history stack's repeat-group sync then
// creates or removes the mirrors inside the same snapshot transaction (and rolls back if a
// mirror can't be placed).

export const createRepeatGroupCmd = (
	{ part, oligos, bpOffset }: { part: Part; oligos: Oligo[]; bpOffset: number },
	history: HistoryStack
): RepeatGroup =>
	history.snapshotTx('Create mirror copies', () => createRepeatGroup(part, oligos, bpOffset));

export const addRepeatInstanceCmd = (
	{ part, groupId, bpOffset }: { part: Part; groupId: string; bpOffset: number },
	history: HistoryStack
): void => history.snapshotTx('Add mirror copy', () => addRepeatInstance(part, groupId, bpOffset));

export const removeRepeatInstanceCmd = (
	{ part, groupId, instanceId }: { part: Part; groupId: string; instanceId: string },
	history: HistoryStack
): void =>
	history.snapshotTx('Remove mirror copy', () => removeRepeatInstance(part, groupId, instanceId));

export const detachRepeatGroupCmd = (
	{ part, groupId }: { part: Part; groupId: string },
	history: HistoryStack
): void => history.snapshotTx('Detach repeat group', () => detachRepeatGroup(part, groupId));

export const deleteRepeatGroupCmd = (
	{ part, groupId }: { part: Part; groupId: string },
	history: HistoryStack
): void => history.snapshotTx('Delete repeat group', () => deleteRepeatGroup(part, groupId));
