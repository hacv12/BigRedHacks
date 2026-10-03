import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { brisaPwa } from './scripts/pwa-plugin';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), brisaPwa()],
});
