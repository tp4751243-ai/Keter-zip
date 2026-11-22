import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { chromiumPdfPlugin } from './scripts/chromium-pdf-vite-plugin';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Relative asset paths so the Vite build also loads from disk
    // (file://) inside the Electron desktop app, not only from a server.
    base: './',
    plugins: [react(), tailwindcss(), chromiumPdfPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      allowedHosts: true as const,
    },
  };
});
