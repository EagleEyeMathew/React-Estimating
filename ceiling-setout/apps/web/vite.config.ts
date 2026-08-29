import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  // The packages are consumed as TypeScript source rather than build output, so a
  // change in the engine shows up in the app without a build step in between.
  optimizeDeps: { exclude: ['@ceiling/geometry', '@ceiling/rules', '@ceiling/engine', '@ceiling/drawing'] },
  build: { target: 'es2022', sourcemap: true },
});
