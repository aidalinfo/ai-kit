// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
        site: 'https://ai.aidalinfo.fr',
        integrations: [
                starlight({
                        title: {
                                default: 'Documentation AI Kit',
                                'fr-FR': 'Documentation AI Kit',
                                en: 'AI Kit Docs',
                                'en-US': 'AI Kit Docs',
                        },
                        defaultLocale: 'fr',
                        locales: {
                                fr: { label: 'Français', lang: 'fr-FR' },
                                en: { label: 'English', lang: 'en-US' },
                        },
                        social: [
                                { icon: 'github', label: 'GitHub', href: 'https://github.com/aidalinfo/ai-kit' },
                        ],
                        sidebar: [
                                {
                                        label: 'Introduction',
                                        translations: { en: 'Introduction' },
                                        link: '/introduction/',
                                },
                                {
                                        label: 'Core',
                                        translations: { en: 'Core' },
                                        items: [
                                                {
                                                        label: 'Télémétrie Langfuse',
                                                        translations: { en: 'Langfuse telemetry' },
                                                        link: '/core/telemetry/',
                                                },
                                        ],
                                },
                                {
                                        label: 'Utils',
                                        translations: { en: 'Utilities' },
                                        items: [
                                                {
                                                        label: 'Gestion des chunks',
                                                        translations: { en: 'Chunk management' },
                                                        link: '/utils/chunking/',
                                                },
                                        ],
                                },
                                {
                                        label: 'Providers',
                                        translations: { en: 'Providers' },
                                        items: [
                                                {
                                                        label: 'Scaleway',
                                                        translations: { en: 'Scaleway' },
                                                        link: '/providers/scaleway/',
                                                },
                                        ],
                                },
                                {
                                        label: 'MCP',
                                        translations: { en: 'MCP' },
                                        items: [
                                                {
                                                        label: 'Serveur MCP AI Kit',
                                                        translations: { en: 'AI Kit MCP server' },
                                                        link: '/mcp/usage/',
                                                },
                                        ],
                                },
                        ],
                }),
        ],
});
