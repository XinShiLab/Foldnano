import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		rules: {
			// typescript-eslint strongly recommend that you do not use the no-undef lint rule on TypeScript projects.
			// see: https://typescript-eslint.io/troubleshooting/faqs/eslint/#i-get-errors-from-the-no-undef-rule-about-global-variables-not-being-defined-even-though-there-are-no-typescript-errors
			'no-undef': 'off',
			// Allow _-prefixed names as intentionally unused (e.g. abstract method params, ignored destructures)
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
				},
			],
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: 'svelte-sonner',
							importNames: ['toast'],
							message:
								"Use notify from '$lib/notifications/notify.svelte' so the toast reaches the notification list.",
						},
					],
				},
			],
		},
	},
	{
		// The editor works on the active Part (docs/dna-model.md § FoldnanoDocument), not the first one.
		files: ['src/lib/components/Editor/**', 'src/lib/plugin/**', 'src/lib/canvasEditor/**'],
		ignores: ['**/*.spec.ts'],
		rules: {
			'no-restricted-syntax': [
				'error',
				{
					selector:
						"MemberExpression[computed=true][property.value=0][object.type='MemberExpression'][object.property.name='parts']",
					message: 'Use editorViewContext.activePart (or the Part you were given), not parts[0].',
				},
			],
		},
	},
	{
		files: ['src/lib/notifications/notify.svelte.ts'],
		rules: { 'no-restricted-imports': 'off' },
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig,
			},
		},
	}
);
