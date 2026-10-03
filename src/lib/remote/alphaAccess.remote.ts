import { getRequestEvent } from '$app/server';
import { form } from '$app/server';
import { invalid } from '@sveltejs/kit';
import * as v from 'valibot';

import {
	alphaAccessCodeMatches,
	getConfiguredAlphaAccessCodes,
	setAlphaAccessCookie,
} from '$lib/server/alphaAccess';

export const grantAlphaAccess = form(
	v.object({ _code: v.pipe(v.string(), v.nonEmpty()) }),
	({ _code }, issue) => {
		const accessCodes = getConfiguredAlphaAccessCodes();
		if (accessCodes.length === 0 || !alphaAccessCodeMatches(_code, accessCodes)) {
			invalid(issue._code('Invalid access code'));
		}

		const { cookies, url } = getRequestEvent();
		setAlphaAccessCookie(cookies, _code, url.protocol === 'https:');
		return { success: true };
	}
);
