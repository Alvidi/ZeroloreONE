/**
 * Genera los datos del juego a partir de la instantánea de Notion.
 *
 *   node --experimental-strip-types scripts/sync-notion.ts
 *
 * La instantánea vive en data/notion/*.json y se refresca desde Notion. Este
 * script solo transforma y valida: imprime toda discrepancia en lugar de
 * rellenarla con valores por defecto en silencio.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildProfiles } from '../packages/data/src/notion.ts';

const leer = (n: string): unknown =>
  JSON.parse(readFileSync(resolve(`data/notion/${n}.json`), 'utf8'));

const report = buildProfiles({
  unidades: leer('unidades') as never,
  heroes: leer('heroes') as never,
  armasUnidad: leer('armas-unidad') as never,
  habilidadesUnidad: leer('habilidades-unidad') as never,
});

const OUT = resolve('packages/data/profiles.json');
writeFileSync(OUT, JSON.stringify(report.profiles, null, 2), 'utf8');

console.log(`\n${report.profiles.length} perfiles generados -> ${OUT}\n`);

const porClase = new Map<string, number>();
for (const p of report.profiles) porClase.set(p.clase, (porClase.get(p.clase) ?? 0) + 1);
for (const [c, n] of [...porClase].sort()) console.log(`  ${c.padEnd(16)} ${n}`);

const sinArmas = report.profiles.filter((p) => p.armas.length < 2);
if (sinArmas.length > 0) {
  console.log(`\n${sinArmas.length} perfiles con menos de 2 armas:`);
  for (const p of sinArmas) console.log(`  ${p.nombre} -> ${p.armas.length}`);
}

if (report.issues.length > 0) {
  console.log(`\n${report.issues.length} DISCREPANCIAS:\n`);
  for (const i of report.issues) {
    console.log(`  ${i.donde} -> ${i.campo}`);
    console.log(`      valor: ${JSON.stringify(i.valor)}  |  ${i.problema}`);
  }
} else {
  console.log('\nSin discrepancias: la instantánea de Notion se traduce entera.');
}
