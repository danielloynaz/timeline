import { resolve } from 'node:path';

/** @type {import('@storybook/html-vite').StorybookConfig} */
const config = {
  stories: ['../stories/**/*.mdx', '../stories/**/*.stories.js'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/html-vite',
  core: { disableTelemetry: true },
  async viteFinal(cfg) {
    cfg.resolve = cfg.resolve ?? {};
    cfg.resolve.alias = { ...(cfg.resolve.alias ?? {}), '@itech/timeline': resolve(process.cwd(), 'src/index.js') };
    return cfg;
  },
};
export default config;
