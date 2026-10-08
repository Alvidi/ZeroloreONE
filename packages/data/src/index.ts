/**
 * Datos del juego tal como los publica la web (que a su vez se sincroniza con
 * Notion). Se copian con `node scripts/sync-web.mjs`; no se editan a mano.
 *
 * El paquete solo entrega el JSON crudo: interpretarlo es cosa del motor
 * (`leerCatalogo` en @zerolore/core), que así no depende de ningún fichero.
 */
import catalogo from '../catalogo.json';
import objetos from '../objetos.json';

export const CATALOGO: unknown = catalogo;
export const OBJETOS: unknown = objetos;
