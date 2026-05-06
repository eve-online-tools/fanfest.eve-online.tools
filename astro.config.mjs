// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Static build for Cloudflare Pages (`dist/` → Pages project root).
// https://docs.astro.build/en/guides/deploy/cloudflare/
export default defineConfig({
	site: 'https://fanfest.eve-online.tools',
	output: 'static',
	compressHTML: true,
	integrations: [sitemap()],
});
