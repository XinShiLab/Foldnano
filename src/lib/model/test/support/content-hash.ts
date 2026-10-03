import * as crypto from 'crypto';
import * as fs from 'fs';

/** Normalised: under core.autocrlf the same content would hash differently in a fresh clone. */
export function sha256Text(file: string): string {
	const normalised = fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n');
	return crypto.createHash('sha256').update(Buffer.from(normalised, 'latin1')).digest('hex');
}
