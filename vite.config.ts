import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The PWA config is not optional polish. WebKit deletes all script-writable
// storage after 7 days without a visit, and home-screen install is the only
// exemption — so installability IS the cross-session memory guarantee.
// See docs/TECHNICAL_SPEC.md §7.
export default defineConfig({
  build: {
    target: 'es2022',
    cssMinify: true,
    reportCompressedSize: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Drawn & Quartered',
        short_name: 'Drawn',
        description: 'A Pictionary word generator that remembers what it has already shown you.',
        theme_color: '#111820',
        background_color: '#F1F4F7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // All four corpus bundles are 16.6 KB gzipped in total. Precaching them
        // costs nothing and guarantees a full offline game.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
});
