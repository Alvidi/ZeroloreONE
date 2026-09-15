import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// fileURLToPath, no url.pathname: la ruta del proyecto contiene un espacio
// ("zerolore ONE") y pathname lo dejaría escapado como %20.
const resolvePkg = (rel: string): string =>
  fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@zerolore/core': resolvePkg('./packages/core/src/index.ts'),
      '@zerolore/data': resolvePkg('./packages/data/src/index.ts'),
    },
  },
  test: { include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'] },
});
