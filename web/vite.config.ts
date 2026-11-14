import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5410,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4410' },
    fs: { allow: ['..'] },
  },
});
