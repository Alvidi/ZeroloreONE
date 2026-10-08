// Copia los datos del juego desde la web (que se sincroniza con Notion) a
// packages/data. La web es la fuente: aquí no se edita nada a mano.
//
//   node scripts/sync-web.mjs [ruta-a-la-web]
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const web = resolve(process.argv[2] ?? join(raiz, '..', 'web'));
const ficheros = [
  ['src/data/catalog/catalogo.json', 'catalogo.json'],
  ['src/data/items/objetos.json', 'objetos.json'],
];

for (const [origen, destino] of ficheros) {
  const de = join(web, origen);
  if (!existsSync(de)) {
    console.error(`No existe ${de}`);
    process.exit(1);
  }
  copyFileSync(de, join(raiz, 'packages', 'data', destino));
  console.log(`${origen} → packages/data/${destino}`);
}
