/**
 * Generador aleatorio determinista (mulberry32).
 *
 * Todo el azar de la partida pasa por aquí. Nunca se usa Math.random():
 * con una semilla fija una partida se reproduce paso a paso, lo que hace
 * posible repetir replays, depurar un combate concreto y escribir tests
 * fiables sobre las tiradas.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Se fuerza a entero de 32 bits sin signo.
    this.state = seed >>> 0;
  }

  /** Copia con el mismo estado interno, para explorar sin alterar la partida. */
  clone(): Rng {
    const r = new Rng(0);
    r.state = this.state;
    return r;
  }

  /** Estado interno, para serializar la partida. */
  snapshot(): number {
    return this.state;
  }

  static restore(state: number): Rng {
    const r = new Rng(0);
    r.state = state >>> 0;
    return r;
  }

  /** Flotante en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [1, caras]. */
  die(faces: number): number {
    return 1 + Math.floor(this.next() * faces);
  }

  /** El D6 es el dado por defecto del reglamento. */
  d6(): number {
    return this.die(6);
  }

  /** Algunas armas usan D3 para el daño. */
  d3(): number {
    return this.die(3);
  }

  /** Tira `count` dados de `faces` caras. */
  roll(count: number, faces = 6): number[] {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(this.die(faces));
    return out;
  }
}
