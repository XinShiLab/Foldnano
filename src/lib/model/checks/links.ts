import type { Part } from '../Part';
import type { PartLinkState } from '../partLinks';
import type { DesignIssue } from './designIssue';

export type LinkRule = 'link-outdated' | 'link-missing';

/** Warnings for a linked Part whose source changed or can't be found; exports use the copy. */
export function checkPartLink(
	part: Part,
	state: PartLinkState | null | undefined
): DesignIssue<LinkRule>[] {
	if (!part.source) return [];
	if (state === 'outdated') {
		return [
			{
				rule: 'link-outdated',
				severity: 'warning',
				message: `"${part.name}" is linked to a design that changed since it was copied. Update it from the Assembly panel to bring the change in.`,
			},
		];
	}
	if (state === 'replaced') {
		return [
			{
				rule: 'link-outdated',
				severity: 'warning',
				message: `The design "${part.name}" is linked to now holds a different Part. The copy keeps working; choose Relink in the Assembly panel to take the new Part.`,
			},
		];
	}
	if (state === 'unlinkable') {
		return [
			{
				rule: 'link-missing',
				severity: 'warning',
				message: `The design "${part.name}" is linked to can't be linked any more (it has several Parts or links of its own). The copy keeps working; break the link to edit it here.`,
			},
		];
	}
	if (state === 'missing') {
		return [
			{
				rule: 'link-missing',
				severity: 'warning',
				message: `The design "${part.name}" is linked to isn't in this browser any more. The copy keeps working; break the link to edit it here.`,
			},
		];
	}
	return [];
}
