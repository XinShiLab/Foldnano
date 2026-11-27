export const APP_VERSION = __APP_VERSION__;
export const APP_COMMIT = __COMMIT_HASH__;

/** The version as people read it: a 0.x release is still beta (`0.11.0 (beta)`). Files and error
 * reports keep the plain `APP_VERSION`. */
export function displayVersion(version: string = APP_VERSION): string {
	return /^0\./.test(version) ? `${version} (beta)` : version;
}
