import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
	AGENT_PROTOCOL,
	AgentRequestError,
	agentCliText,
	agentsMdFile,
	agentsMdText,
	isUneditedAgentsMd,
	isGeneratedAgentCli,
	isSafeScriptPath,
	parseAgentRunRequest,
	requestIdFromFileName,
	sha256Hex,
	zipWithFile,
} from './agentRuns';
import type { PluginManifest } from './types';

const request = (fields: Record<string, unknown> = {}) =>
	JSON.stringify({ protocol: AGENT_PROTOCOL, id: 'r1', session: 's1', ...fields });

describe('parseAgentRunRequest', () => {
	it('defaults to running the plugin and applying the result', () => {
		expect(parseAgentRunRequest(request(), 'r1')).toEqual({
			id: 'r1',
			kind: 'run',
			session: 's1',
			script: null,
			params: null,
			mode: 'apply',
		});
	});

	it('reads script, params and apply', () => {
		const parsed = parseAgentRunRequest(
			request({ script: 'agent-scripts/01-a.py', params: { n: 3 }, mode: 'dry-run' }),
			'r1'
		);
		expect(parsed).toMatchObject({
			script: 'agent-scripts/01-a.py',
			params: { n: 3 },
			mode: 'dry-run',
		});
	});

	it('reads the apply flag an older run.py sends', () => {
		expect(parseAgentRunRequest(request({ apply: false }), 'r1').mode).toBe('ask-user');
		expect(parseAgentRunRequest(request({ apply: true }), 'r1').mode).toBe('apply');
	});

	it('reads a describe request', () => {
		expect(parseAgentRunRequest(request({ kind: 'describe' }), 'r1')).toMatchObject({
			kind: 'describe',
			script: null,
		});
	});

	it.each([
		['not json', '{', /not valid JSON/],
		['an unknown kind', request({ kind: 'delete' }), /"kind"/],
		[
			'a describe request with a script',
			request({ kind: 'describe', script: 'a.py' }),
			/no script/,
		],
		['another protocol', JSON.stringify({ protocol: 99, id: 'r1' }), /Protocol 99/],
		['an id that differs from the file name', request({ id: 'r2' }), /must match/],
		['a missing session', request({ session: undefined }), /"session"/],
		['a script outside the folder', request({ script: '../x.py' }), /relative path/],
		['params that are not an object', request({ params: [1] }), /"params"/],
		['a non-boolean apply', request({ apply: 'yes' }), /"mode"/],
		['an unknown mode', request({ mode: 'maybe' }), /"mode"/],
	])('rejects %s', (_label, text, message) => {
		expect(() => parseAgentRunRequest(text, 'r1')).toThrow(message);
		expect(() => parseAgentRunRequest(text, 'r1')).toThrow(AgentRequestError);
	});
});

describe('paths and ids', () => {
	it('accepts only relative .py paths outside dot-folders', () => {
		expect(isSafeScriptPath('agent-scripts/01.py')).toBe(true);
		expect(isSafeScriptPath('plugin.py')).toBe(true);
		for (const bad of [
			'/abs.py',
			'../up.py',
			'a/../b.py',
			'.foldnano/run.py',
			'a\\b.py',
			'x.txt',
		]) {
			expect(isSafeScriptPath(bad), bad).toBe(false);
		}
	});

	it('skips temp files run.py writes before renaming', () => {
		expect(requestIdFromFileName('1730000000000-abc123.json')).toBe('1730000000000-abc123');
		expect(requestIdFromFileName('.1730000000000-abc123.tmp')).toBeNull();
		expect(requestIdFromFileName('bad id.json')).toBeNull();
	});
});

describe('zipWithFile', () => {
	it('adds the script next to the plugin files', () => {
		const zip = zipSync({ 'plugin.py': strToU8('A'), 'helpers.py': strToU8('B') });
		const files = unzipSync(zipWithFile(zip, 'agent-scripts/01.py', strToU8('C')));
		expect(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]))).toEqual({
			'plugin.py': 'A',
			'helpers.py': 'B',
			'agent-scripts/01.py': 'C',
		});
	});
});

describe('agent files', () => {
	it('recognises its own run.py, and the protocol numbers agree', () => {
		const cli = agentCliText();
		expect(isGeneratedAgentCli(cli)).toBe(true);
		expect(isGeneratedAgentCli('print("mine")')).toBe(false);
		expect(cli).toContain(`PROTOCOL = ${AGENT_PROTOCOL}\n`);
	});

	it('points AGENTS.md at the API of the plugin format', () => {
		const manifest = (format: string, applyStrategy: string) =>
			({ format, applyStrategy }) as unknown as PluginManifest;
		const mini = agentsMdText(manifest('foldnano_mini', 'replayMutationLog'), 'https://x.test');
		expect(mini).toContain('.foldnano-stubs/foldnano_mini/');
		const ctxStub = /`\.foldnano-stubs\/(foldnano\/[\w.]+\.pyi)` \(`PluginContext`/.exec(mini)![1];
		expect(fs.readFileSync(path.resolve(__dirname, 'python/stubs', ctxStub), 'utf8')).toMatch(
			/^class PluginContext\b/m
		);
		expect(mini).toContain('ctx.set_result_mutation_log(part.mutation_log)');
		expect(mini).not.toContain('previewOnly');
		expect(mini).toContain('https://x.test/docs/plugin-development/foldnano-mini-api.md');
		expect(mini).toContain('https://x.test/llms.txt');

		const cadnano = agentsMdText(manifest('cadnano_json', 'replaceRegion'), 'https://x.test');
		expect(cadnano).toContain('ctx.set_result_cadnano_json');
		expect(cadnano).toMatch(/2\. Look up the API .*\n {3}`\.foldnano-stubs\/foldnano\/`/);
		expect(cadnano).toContain('ask the user for a `foldnano_mini` plugin');
		expect(cadnano).toContain('https://x.test/docs/plugin-development/plugin-api.md');

		const preview = agentsMdText(manifest('foldnano_mini', 'previewOnly'), 'https://x.test');
		expect(preview).toContain('runs never change the design');
	});

	it('tells the agent what each way of applying does, and never offers --no-apply', () => {
		const text = agentsMdText(
			{ format: 'foldnano_mini', applyStrategy: 'replayMutationLog' } as unknown as PluginManifest,
			'https://x.test'
		);
		expect(text).toContain('--dry-run');
		expect(text).toContain('--ask-user-approval');
		expect(text).toContain('Never run the script again afterwards');
		expect(text).not.toContain('--no-apply');
	});

	it('starts AGENTS.md with first steps and a map of the folder, local stubs before web docs', () => {
		const text = agentsMdText(
			{ format: 'foldnano_mini', applyStrategy: 'replayMutationLog' } as unknown as PluginManifest,
			'https://x.test'
		);
		const sections = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
		expect(sections.slice(0, 2)).toEqual(['First steps', 'This folder']);
		expect(text).toMatch(/1\. See the design: `python \.foldnano\/run\.py --describe`/);
		expect(text).toMatch(
			/2\. Look up the API .*not on the web:\n {3}`\.foldnano-stubs\/foldnano_mini\/`/
		);
		expect(text).toContain("Only if the stubs don't answer");
		const commands = text.match(/^python \.foldnano\/run\.py.*$/gm) ?? [];
		expect(commands).toHaveLength(5);
		expect(new Set(commands.map((line) => line.indexOf('#'))).size).toBe(1);
	});

	it('marks the AGENTS.md it writes, so it can tell an unedited copy from an edited one', async () => {
		const file = await agentsMdFile(
			{ format: 'foldnano_mini', applyStrategy: 'replayMutationLog' } as unknown as PluginManifest,
			'https://x.test'
		);
		expect(await isUneditedAgentsMd(file)).toBe(true);
		expect(await isUneditedAgentsMd(file.replace('# Working', '# My notes\n\n# Working'))).toBe(
			false
		);
		expect(await isUneditedAgentsMd('# My own AGENTS.md\n')).toBe(false);
	});

	it('hashes with SHA-256', async () => {
		expect(await sha256Hex('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
