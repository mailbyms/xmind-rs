import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The first paint only needs the shell. Every heavy feature is a dynamic
// import so Vite emits it as a separate chunk that the WebView never parses
// until the user actually opens that feature.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1421, strictPort: true, host: '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tauri-apps')) return 'ipc';
            if (id.includes('react')) return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
