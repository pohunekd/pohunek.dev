// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { docsSidebar } from './src/config/sidebar.mjs';

export default defineConfig({
	site: 'https://pohunek.dev',
	trailingSlash: 'always',
	// Compression drops line breaks between text and inline links, which glues words to them.
	compressHTML: false,
	integrations: [
		starlight({
			title: 'pohunek docs',
			description: 'Documentation for pohunek, the headless multihost backbone for coding agents.',
			logo: { src: './src/assets/brand/logo-mark.png', alt: 'pohunek' },
			favicon: '/favicon.png',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/zajca/pohunek' }],
			customCss: [
				'@fontsource/domine/400.css',
				'@fontsource/domine/700.css',
				'@fontsource/karla/400.css',
				'@fontsource/karla/700.css',
				'@fontsource/jetbrains-mono/400.css',
				'./src/styles/starlight.css',
			],
			components: {
				Header: './src/components/starlight/Header.astro',
			},
			sidebar: docsSidebar,
			disable404Route: true,
		}),
	],
});
