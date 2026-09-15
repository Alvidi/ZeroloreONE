import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// base relativa: el juego se montará más adelante como sección aparte del
// sitio web existente (por ejemplo en /juego), no en la raíz del dominio.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@zerolore/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      '@zerolore/data': fileURLToPath(new URL('../../packages/data/src/index.ts', import.meta.url)),
    },
  },
  server: { port: 5180 },
});
