// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://ai.aidalinfo.fr',
	integrations: [
		starlight({
			title: 'AI Kit Docs',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/withastro/starlight' }],
			sidebar: [
				{
					label: 'Introduction',
					link: '/introduction/',
				},
				{
					label: 'Core',
					autogenerate: { directory: 'core' },
				},
				{
					label: 'Utils',
					autogenerate: { directory: 'utils' },
				},
				{
					label: 'Providers',
					autogenerate: { directory: 'providers' },
				},
				{
					label: 'MCP',
					autogenerate: { directory: 'mcp' },
				},
			],
		}),
	],
});
