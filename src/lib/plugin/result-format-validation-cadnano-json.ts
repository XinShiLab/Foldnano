import type { VStrandJSON } from '$lib/model/io/cadnanoJSON';
import { PluginValidationError, type InvariantCategory } from './plugin-result-errors';

type Nt = [number, number, number, number];
type Color = [number, number];

export interface CadnanoResultData {
	name: string;
	vstrands: VStrandJSON[];
	/** Non-fatal repairs made during validation (e.g. a one-sided pointer discarded as a free end). */
	warnings: string[];
}

const isInt = Number.isInteger;

/** Shape/internal-consistency check for a plugin's raw `cadnano_json` result, before reconstruction. */
export function validateResultShape(
	primaryArtifact: string | null,
	pluginId: string
): CadnanoResultData {
	function reject(message: string, category: InvariantCategory = 'shape'): never {
		throw new PluginValidationError(message, pluginId, 'result-format-validation', category);
	}

	if (primaryArtifact === null) reject('Plugin returned no result.');

	let parsed: unknown;
	try {
		parsed = JSON.parse(primaryArtifact);
	} catch {
		reject('Result is not valid JSON.');
	}
	if (typeof parsed !== 'object' || parsed === null) reject('Result must be a JSON object.');

	const top = parsed as { name?: unknown; vstrands?: unknown };
	if (typeof top.name !== 'string') reject('Result is missing a string "name".');
	if (!Array.isArray(top.vstrands)) reject('Result is missing a "vstrands" array.');
	const vstrands = top.vstrands as VStrandJSON[];

	const byNum = new Map<number, VStrandJSON>();
	const seenCoords = new Map<string, number>();
	let commonLen: number | undefined;
	for (const vs of vstrands) {
		if (typeof vs !== 'object' || vs === null) reject('A virtual helix must be an object.');
		if (!isInt(vs.num) || !isInt(vs.row) || !isInt(vs.col)) {
			reject(`Virtual helix has a non-integer num/row/col.`);
		}
		if (byNum.has(vs.num)) reject(`Duplicate virtual helix index ${vs.num}.`);
		byNum.set(vs.num, vs);

		// The importer places a VH at (row, col) as-is, with no collision check of its own —
		// two vstrands sharing a lattice position would silently overlap after Apply.
		const coordKey = `${vs.row}:${vs.col}`;
		const priorNum = seenCoords.get(coordKey);
		if (priorNum !== undefined) {
			reject(
				`Virtual helix ${vs.num} shares lattice position (row ${vs.row}, col ${vs.col}) with virtual helix ${priorNum}.`
			);
		}
		seenCoords.set(coordKey, vs.num);

		for (const key of ['scaf', 'stap', 'loop', 'skip'] as const) {
			if (!Array.isArray(vs[key])) reject(`Virtual helix ${vs.num} is missing "${key}".`);
		}
		const len = vs.scaf.length;
		if (vs.stap.length !== len || vs.loop.length !== len || vs.skip.length !== len) {
			reject(`Virtual helix ${vs.num}'s scaf/stap/loop/skip arrays must be the same length.`);
		}
		if (len === 0) reject(`Virtual helix ${vs.num} has zero bases.`);
		// The importer sizes every new VH from vstrands[0]'s length alone; a shorter/longer
		// sibling would be silently coerced to that length instead of its own declared one.
		if (commonLen === undefined) commonLen = len;
		else if (len !== commonLen) {
			reject(
				`Virtual helix ${vs.num} has ${len} bases, but other virtual helices have ${commonLen}.`
			);
		}

		for (const altKey of ['scaf_loop', 'stap_loop', 'scafLoop', 'stapLoop'] as const) {
			const arr = vs[altKey];
			if (arr !== undefined && (!Array.isArray(arr) || !arr.every((n) => isInt(n)))) {
				reject(`Virtual helix ${vs.num}'s "${altKey}" must be an array of integers.`);
			}
		}

		for (const strandKey of ['scaf', 'stap'] as const) {
			for (const nt of vs[strandKey] as Nt[]) {
				if (!Array.isArray(nt) || nt.length !== 4 || !nt.every((n) => isInt(n))) {
					reject(
						`Virtual helix ${vs.num} has an invalid entry in "${strandKey}". Each entry must be an array of exactly four integers.`
					);
				}
				const [fromVh, fromBp, toVh, toBp] = nt;
				if ((fromVh === -1) !== (fromBp === -1)) {
					reject(
						`Virtual helix ${vs.num} has a "${strandKey}" entry with an incomplete incoming connection. The virtual helix index and base index must both be -1 when there is no connection.`
					);
				}
				if ((toVh === -1) !== (toBp === -1)) {
					reject(
						`Virtual helix ${vs.num} has a "${strandKey}" entry with an incomplete outgoing connection. The virtual helix index and base index must both be -1 when there is no connection.`
					);
				}
			}
		}

		for (const colorKey of ['stap_colors', 'scaf_colors'] as const) {
			const colors = vs[colorKey];
			if (colors === undefined) continue;
			if (!Array.isArray(colors))
				reject(`Virtual helix ${vs.num}'s "${colorKey}" must be an array.`);
			const targetArr = colorKey === 'stap_colors' ? vs.stap : vs.scaf;
			for (const c of colors as Color[]) {
				if (!Array.isArray(c) || c.length !== 2 || !isInt(c[0]) || !isInt(c[1])) {
					reject(`Virtual helix ${vs.num} has a malformed color entry.`, 'color-bounds');
				}
				if (c[1] < 0 || c[1] > 0xffffff) {
					reject(`Virtual helix ${vs.num} has an out-of-range color value.`, 'color-bounds');
				}
				if (c[0] < 0 || c[0] >= targetArr.length) {
					reject(
						`Virtual helix ${vs.num} has a color anchored outside its ${colorKey === 'stap_colors' ? 'stap' : 'scaf'} array.`,
						'bounds'
					);
				}
			}
		}

		for (let i = 0; i < len; i++) {
			const skipVal = vs.skip[i];
			const loopVal = vs.loop[i];
			if (!isInt(skipVal) || !isInt(loopVal)) {
				reject(`Virtual helix ${vs.num} has a non-integer loop/skip entry at position ${i}.`);
			}
			if (skipVal !== 0 && skipVal !== -1) {
				reject(`Virtual helix ${vs.num}'s skip[${i}] must be 0 or -1.`);
			}
			if (loopVal < 0) {
				reject(`Virtual helix ${vs.num}'s loop[${i}] must be >= 0.`);
			}
			if (skipVal === -1 && loopVal > 0) {
				reject(`Virtual helix ${vs.num} position ${i} is marked as both a skip and an insertion.`);
			}
		}
	}

	// Cross-vstrand: tuple references and bounds (needs every vstrand already collected above).
	function checkPointer(vh: number, bp: number, strandKey: 'scaf' | 'stap'): void {
		if (vh === -1) return;
		const target = byNum.get(vh);
		if (!target)
			reject(`Connection references virtual helix ${vh}, which does not exist.`, 'reference');
		const arr = target[strandKey] as Nt[];
		if (bp < 0 || bp >= arr.length) {
			reject(
				`Connection references out-of-bounds position ${bp} on virtual helix ${vh}.`,
				'bounds'
			);
		}
	}
	for (const vs of vstrands) {
		for (const strandKey of ['scaf', 'stap'] as const) {
			for (const [fromVh, fromBp, toVh, toBp] of vs[strandKey] as Nt[]) {
				checkPointer(fromVh, fromBp, strandKey);
				checkPointer(toVh, toBp, strandKey);
			}
		}
	}

	// Checked in both directions: one direction can be fabricated without the other noticing.
	// A one-sided pointer whose target makes no competing claim (its own field is the free
	// sentinel) is safely discardable: the plugin recorded a connection that the other side
	// never agreed to, so the two ends are genuinely free and can be reconstructed as such.
	// A pointer whose target claims a DIFFERENT connection is a real conflict — no safe repair
	// exists, so that case still rejects.
	const cleanedByNum = new Map<number, VStrandJSON>();
	for (const vs of vstrands) {
		cleanedByNum.set(vs.num, {
			...vs,
			scaf: (vs.scaf as Nt[]).map((nt) => [...nt] as Nt),
			stap: (vs.stap as Nt[]).map((nt) => [...nt] as Nt),
		});
	}
	const warnings: string[] = [];
	const isFreeSentinel = (a: number, b: number) => a === -1 && b === -1;

	for (const vs of vstrands) {
		for (const strandKey of ['scaf', 'stap'] as const) {
			const strand = vs[strandKey] as Nt[];
			for (let i = 0; i < strand.length; i++) {
				const [fromVh, fromBp, toVh, toBp] = strand[i];
				if (toVh !== -1) {
					const targetEntry = (byNum.get(toVh)![strandKey] as Nt[])[toBp];
					if (targetEntry[0] !== vs.num || targetEntry[1] !== i) {
						if (!isFreeSentinel(targetEntry[0], targetEntry[1])) {
							reject(
								`Virtual helix ${vs.num}'s "${strandKey}" position ${i} connects to virtual helix ${toVh} at position ${toBp}, but the target records a different incoming connection.`,
								'reciprocity'
							);
						}
						(cleanedByNum.get(vs.num)![strandKey] as Nt[])[i][2] = -1;
						(cleanedByNum.get(vs.num)![strandKey] as Nt[])[i][3] = -1;
						warnings.push(
							`Virtual helix ${vs.num} ${strandKey}[${i}]'s outgoing pointer to ${toVh}:${toBp} did not connect back on the other side; discarded and reconstructed as a free end.`
						);
					}
				}
				if (fromVh !== -1) {
					const sourceEntry = (byNum.get(fromVh)![strandKey] as Nt[])[fromBp];
					if (sourceEntry[2] !== vs.num || sourceEntry[3] !== i) {
						if (!isFreeSentinel(sourceEntry[2], sourceEntry[3])) {
							reject(
								`Virtual helix ${vs.num}'s "${strandKey}" position ${i} records an incoming connection from virtual helix ${fromVh} at position ${fromBp}, but the source records a different outgoing connection.`,
								'reciprocity'
							);
						}
						(cleanedByNum.get(vs.num)![strandKey] as Nt[])[i][0] = -1;
						(cleanedByNum.get(vs.num)![strandKey] as Nt[])[i][1] = -1;
						warnings.push(
							`Virtual helix ${vs.num} ${strandKey}[${i}]'s incoming pointer from ${fromVh}:${fromBp} did not connect back on the other side; discarded and reconstructed as a free end.`
						);
					}
				}
			}
		}
	}

	return { name: top.name, vstrands: [...cleanedByNum.values()], warnings };
}
