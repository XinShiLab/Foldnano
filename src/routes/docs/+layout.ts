import type { LayoutLoad } from './$types';

export interface NavItem {
	title: string;
	slug: string;
	category: 'guide' | 'plugin-development' | 'contributors';
	order: number;
	description: string;
}

export const load: LayoutLoad = ({ data }) => {
	const modules = import.meta.glob('/src/content/**/*.md', { eager: true }) as Record<
		string,
		{ metadata: Record<string, unknown> }
	>;

	const nav: NavItem[] = Object.entries(modules).map(([, mod]) => {
		const meta = mod.metadata;
		return {
			title: meta.title as string,
			description: meta.description as string,
			slug: meta.slug as string,
			category: meta.category as 'guide' | 'plugin-development' | 'contributors',
			order: meta.order as number,
		};
	});

	nav.sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order);

	return { nav, alphaAccessGranted: data.alphaAccessGranted };
};
