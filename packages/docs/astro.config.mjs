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
          autogenerate: { directory: 'core' },
        },
        {
          label: 'Utils',
          translations: { en: 'Utilities' },
          autogenerate: { directory: 'utils' },
        },
        {
          label: 'Providers',
          translations: { en: 'Providers' },
          autogenerate: { directory: 'providers' },
        },
        {
          label: 'MCP',
          translations: { en: 'MCP' },
          autogenerate: { directory: 'mcp' },
        },
      ],
    }),
  ],
});
