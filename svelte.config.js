import adapter from '@sveltejs/adapter-auto';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { createHighlighter } from 'shiki';
import rehypeSlug from 'rehype-slug';

const highlighter = await createHighlighter({
	themes: ['github-dark'],
	langs: ['python', 'json', 'typescript', 'javascript', 'bash', 'yaml', 'markdown', 'text'],
});

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	extensions: ['.svelte', '.md'],
	preprocess: [
		vitePreprocess(),
		mdsvex({
			extensions: ['.md'],
			smartypants: false,
			layout: false,
			rehypePlugins: [rehypeSlug],
			highlight: {
				highlighter: async (code, lang) => {
					const html = highlighter.codeToHtml(code, {
						lang: lang ?? 'text',
						theme: 'github-dark',
					});
					return `{@html ${JSON.stringify(html)}}`;
				},
			},
		}),
	],
	kit: {
		// adapter-auto only supports some environments, see https://svelte.dev/docs/kit/adapter-auto for a list.
		// If your environment is not supported, or you settled on a specific environment, switch out the adapter.
		// See https://svelte.dev/docs/kit/adapters for more information about adapters.
		adapter: adapter(),
		experimental: {
			remoteFunctions: true,
		},
	},
};

export default config;
