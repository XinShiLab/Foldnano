import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
	return {
		docId: params.docId,
	};
};
