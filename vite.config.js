import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the same build works on the web and inside the Android app.
  base: './',
  // `host: true` exposes the dev server on your local network so you can
  // open it on your phone (same Wi-Fi) using the "Network:" URL Vite prints.
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Rapier ships its WebAssembly inlined in JS, so its chunk is large by design.
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
