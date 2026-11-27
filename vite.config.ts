import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  let isHmrDisabled = process.env.DISABLE_HMR === 'true';
  const envPort = Number.parseInt((process.env.PORT || '').trim(), 10);
  const port = Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : 3000;

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'pwa-dev-sw-no-hmr',
        apply: 'serve',
        enforce: 'pre',
        configResolved(config) {
          isHmrDisabled = config.server.hmr === false || process.env.DISABLE_HMR === 'true';
        },
        resolveId(id) {
          if (isHmrDisabled && id === '/@vite-plugin-pwa/pwa-entry-point-loaded') {
            return '\0/@vite-plugin-pwa/pwa-entry-point-loaded';
          }
          return undefined;
        },
        load(id) {
          if (isHmrDisabled && id === '\0/@vite-plugin-pwa/pwa-entry-point-loaded') {
            return `export default function registerDevSW() {
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/dev-sw.js?dev-sw', { scope: '/', type: 'module' })
      .catch(() => {});
  }
}
`;
          }
          return undefined;
        },
      },
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: [
          'brand-logo.png',
          'favicon.png',
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'push-sw.js',
        ],
        manifest: {
          id: '/',
          name: 'SecSchoolHub — Secondary School Management',
          short_name: 'SecSchoolHub',
          description: 'Secondary school management system featuring Form 1–4 student records, Exam JCE/MSCE grading, MWK fee billing, and library circulation.',
          theme_color: '#0F172A',
          background_color: '#F7F8FA',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          importScripts: ['/push-sw.js'],
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port,
    },
  };
});
