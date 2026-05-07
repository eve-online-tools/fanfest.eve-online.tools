// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { writeFile } from 'node:fs/promises';

const buildId =
	process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12) ??
	process.env.GITHUB_SHA?.slice(0, 12) ??
	`local-${Date.now()}`;

/** @returns {import('astro').AstroIntegration} */
function buildIdIntegration() {
	return {
		name: 'build-id',
		hooks: {
			'astro:config:setup': ({ updateConfig }) => {
				updateConfig({
					vite: {
						define: {
							'import.meta.env.PUBLIC_BUILD_ID': JSON.stringify(buildId),
						},
					},
				});
			},
			'astro:build:done': async ({ dir }) => {
				await writeFile(
					new URL('build.json', dir),
					`${JSON.stringify({ id: buildId })}\n`,
				);
			},
		},
	};
}

// Static build for Cloudflare Pages (`dist/` → Pages project root).
// https://docs.astro.build/en/guides/deploy/cloudflare/
export default defineConfig({
	site: 'https://fanfest.eve-online.tools',
	output: 'static',
	compressHTML: true,
	integrations: [buildIdIntegration(), sitemap()],
});
