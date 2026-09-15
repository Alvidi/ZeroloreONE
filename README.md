# ZeroLore ONE

Motor del juego ZeroLore. Prototipo funcional sin gráficos: primero las reglas,
después la interfaz.

## Por qué está partido así

El objetivo es web ahora y móvil/Steam después. Para que eso sea posible,
`packages/core` **no tiene ni una dependencia de DOM ni de render**: recibe
comandos, los valida contra el reglamento y devuelve estado nuevo más eventos.
Ese paquete se reutiliza tal cual en cualquier plataforma; lo único que cambia
es la capa que lo dibuja.

```
packages/core     Reglas puras: dados, geometría, combate, turnos.
packages/data     Traduce la instantánea de Notion a perfiles jugables.
apps/web          Tablero con formas primitivas (círculos y cuadrados).
data/notion/      Instantánea de Notion: unidades, armas, habilidades, equipo.
scripts/          Sincronizador y simulador por consola.
```

## Decisiones tomadas

- **Espacio continuo en pulgadas**, no rejilla. Las peanas son círculos y las
  distancias se miden de borde a borde, como manda el reglamento.
- **Dados deterministas** (`Rng`, mulberry32). Nunca `Math.random()`: con una
  semilla fija la partida se reproduce igual, lo que permite repeticiones,
  depurar un combate concreto y tests fiables.
- **Comandos y eventos.** La interfaz se construirá leyendo el registro de
  eventos, no el estado a pelo. Eso deja la puerta abierta a deshacer,
  repeticiones y multijugador sin reescribir las reglas.
- **Modo Escaramuza primero**: una miniatura = una unidad. Las escuadras del
  modo Gran Batalla, con su asignación de daño y héroes incrustados, quedan
  para más adelante.

## Uso

```bash
npm install
npm test                                                   # 60 tests
node --experimental-strip-types scripts/sync-notion.ts     # regenera los perfiles
node --experimental-strip-types scripts/sim.ts 4242 Disparo Asalto
npm run dev --workspace @zerolore/web                      # tablero en :5180
```

El simulador narra una batalla completa por consola con tiradas, umbrales y
daño, usando los perfiles reales.

## Origen de los datos

Los perfiles NO se escriben a mano: salen de Notion. `data/notion/*.json` es una
instantánea del workspace (unidades por clase×set, héroes, la base de armas,
habilidades de arma y de unidad, equipamiento) y `scripts/sync-notion.ts` la
traduce a `packages/data/profiles.json`. Cuando cambien los datos en Notion, se
refresca la instantánea y se vuelve a ejecutar el sincronizador: no hay que
tocar código.

El sincronizador **reporta toda discrepancia** en vez de rellenarla con valores
por defecto en silencio.

## Qué cubre el motor

Estructura de turno (Iniciativa 1D6, activaciones alternas, fin de turno),
2 acciones por activación con sus costes, movimiento y carrera, zona de control
de 1", secuencia de disparo de 5 pasos, cuerpo a cuerpo, carga con tirada de
3+, destrabe con 4+, coberturas, línea de visión geométrica, ventaja de clase,
y las **13 habilidades de arma** del reglamento: Fiable, Ángulo muerto,
Brutal X+, Perforante, Inestable, Multiuso, Directo, Explosiva X, Parabólica,
Alcance, Errática, Barrido y Anti-X.

De las habilidades de unidad están implementadas las que afectan a la
resolución de un ataque o de una acción: Certero, Emplazado, Tirador,
Berserker, Carga brutal, Terror, Anclado, Porrazo y Atropello.

## Pendiente conocido

- **Explosiva X** calcula cuántas miniaturas adicionales puede elegir el
  atacante, pero el motor todavía no las selecciona ni les aplica el daño.
- **Habilidades de unidad no implementadas**: Guardia, Resistente, Soporte,
  Preparado, Capturador, Contragolpe, Bloqueo de refuerzos, Avanzadilla, Vuelo,
  Fuego de supresión, Fuego defensivo, ¡Boom!, Cobertura móvil, Atrincherado y
  Avance complicado.
- **Habilidades de Héroe**: se importan como texto, no se ejecutan.
- **Equipamiento**: los 9 objetos están en la instantánea, sin usar aún.
- **Escuadras** del modo Gran Batalla.
- **Puestos de mando, objetivos y puntuación**: están en el documento de
  Misiones, aún sin portar. Sin ellos una partida solo acaba por aniquilación.
