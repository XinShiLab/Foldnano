import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
	return {
		left: url.searchParams.get('left') ?? '',
		right: url.searchParams.get('right') ?? '',
	};
};
