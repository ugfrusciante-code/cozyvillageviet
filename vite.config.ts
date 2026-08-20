import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // PORT lets a second dev server (another chat/session) run beside the default.
  server: { port: Number(process.env.PORT) || 5180, open: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
