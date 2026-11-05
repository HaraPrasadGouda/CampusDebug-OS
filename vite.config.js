import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import swBuildStamp from './vite.sw-stamp.js';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), swBuildStamp()],
  server: {
    port: 3000,
    host: true
  }
});
