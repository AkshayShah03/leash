/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target, ws: false },
      '/paypal': { target },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'] },
});
