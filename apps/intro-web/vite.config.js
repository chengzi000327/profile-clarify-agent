import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicSiteUrl = (env.VITE_PUBLIC_SITE_URL || 'http://localhost:5174').replace(/\/$/, '');

  return {
    plugins: [
      react(),
      {
        name: 'intro-site-metadata',
        transformIndexHtml: (html) => html.replaceAll('__PUBLIC_SITE_URL__', publicSiteUrl),
      },
    ],
    server: {
      host: '127.0.0.1',
      port: 5174,
    },
  };
});
