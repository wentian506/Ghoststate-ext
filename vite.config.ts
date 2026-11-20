import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(__dirname, 'apps/dashboard'),
  server: { host: '0.0.0.0', port: 4173, strictPort: true, allowedHosts: true, fs: { allow: [resolve(__dirname)] } }
});
