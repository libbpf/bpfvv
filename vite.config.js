import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    build: {
      outDir: 'build',
    },
    plugins: [react()],
    base: '/bpfvv/',
    server: {
      fs: {
        strict: false, // allow url content loading
      }
    },
  };
});
