import { describe, expect, it } from 'vitest';
import {
  Rng,
  anguloMuertoBloquea,
  hasClassAdvantage,
  resolveMeleeAttack,
  resolveRangedAttack,
  type MeleeWeapon,
  type RangedWeapon,
  type UnitProfile,
} from '@zerolore/core';

const perfil = (over: Partial<UnitProfile> = {}): UnitProfile => ({
  id: 'test',
  nombre: 'Test', rol: null,
  clase: 'Choque',
  set: 'Equilibrado',
  movimiento: 5,
  vidas: 4,
  salvacion: 5,
  velocidad: 2,
  escuadraMin: 5,
  escuadraMax: 10,
  valor: 2,
  habilidad: null,
  armas: [],
  radioPeana: 0.63,
  ...over,
});

const fusil = (over: Partial<RangedWeapon> = {}): RangedWeapon => ({
  kind: 'disparo',
  nombre: 'Fusil',
  ataques: 4,
  distancia: 18,
  precision: 4,
  danio: 1,
  danioCritico: 2,
  habilidades: [],
  ...over,
});

const espada = (over: Partial<MeleeWeapon> = {}): MeleeWeapon => ({
  kind: 'cuerpo_a_cuerpo',
  nombre: 'Espada',
  ataques: 2,
  danio: 2,
  danioCritico: 3,
  habilidades: [],
  ...over,
});

const ctx = { distancia: 10, enCobertura: false };

describe('Ventaja de clase', () => {
  it('sigue la tabla "Fuerte contra"', () => {
    expect(hasClassAdvantage('Choque', 'Especialista')).toBe(true);
    expect(hasClassAdvantage('Especialista', 'Vehiculo')).toBe(true);
    expect(hasClassAdvantage('Comando', 'Heroe')).toBe(true);
    expect(hasClassAdvantage('Choque', 'Elite')).toBe(false);
    expect(hasClassAdvantage('Heroe', 'Choque')).toBe(false);
  });

  it('suma +1 al daño total, no por impacto', () => {
    const r = resolveRangedAttack(
      new Rng(3),
      fusil(),
      perfil({ clase: 'Choque' }),
      perfil({ clase: 'Especialista', salvacion: 6 }),
      ctx,
    );
    if (r.danioTotal > 0) {
      expect(r.bonusVentajaClase).toBe(1);
      expect(r.danioTotal).toBe(r.danioBase + r.danioCritico + r.bonusAntiX + 1);
    }
  });
});

describe('Directo', () => {
  it('impacta sin tirar Precisión', () => {
    const r = resolveRangedAttack(
      new Rng(1),
      fusil({ ataques: 3, precision: null, habilidades: [{ nombre: 'Directo' }] }),
      perfil(),
      perfil({ salvacion: 6 }),
      ctx,
    );
    expect(r.dadosAtaque).toHaveLength(0);
    expect(r.umbralImpacto).toBeNull();
    expect(r.impactos + r.criticos).toBe(3);
  });
});

describe('Errática', () => {
  it('la Precisión del ataque sale de un 1D6', () => {
    for (let seed = 0; seed < 20; seed++) {
      const r = resolveRangedAttack(
        new Rng(seed),
        fusil({ precision: null, habilidades: [{ nombre: 'Errática' }] }),
        perfil(),
        perfil(),
        ctx,
      );
      expect(r.umbralImpacto).toBeGreaterThanOrEqual(1);
      expect(r.umbralImpacto).toBeLessThanOrEqual(6);
      expect(r.notas.join(' ')).toContain('Errática');
    }
  });
});

describe('Brutal X+', () => {
  it('rebaja el umbral de crítico', () => {
    const r = resolveRangedAttack(
      new Rng(5),
      fusil({ habilidades: [{ nombre: 'Brutal X+', x: 5 }] }),
      perfil(),
      perfil(),
      ctx,
    );
    expect(r.umbralCritico).toBe(5);
  });

  it('sin Brutal el crítico es 6', () => {
    expect(resolveRangedAttack(new Rng(5), fusil(), perfil(), perfil(), ctx).umbralCritico).toBe(6);
  });
});

describe('Perforante', () => {
  it('empeora en 1 la Salvación del objetivo', () => {
    const sin = resolveRangedAttack(new Rng(5), fusil(), perfil(), perfil({ salvacion: 4 }), ctx);
    const con = resolveRangedAttack(
      new Rng(5),
      fusil({ habilidades: [{ nombre: 'Perforante' }] }),
      perfil(),
      perfil({ salvacion: 4 }),
      ctx,
    );
    expect(sin.umbralSalvacion).toBe(4);
    expect(con.umbralSalvacion).toBe(5);
  });
});

describe('Cobertura', () => {
  it('mejora en 1 la Salvación frente a disparo', () => {
    const r = resolveRangedAttack(new Rng(5), fusil(), perfil(), perfil({ salvacion: 4 }), {
      ...ctx,
      enCobertura: true,
    });
    expect(r.umbralSalvacion).toBe(3);
  });

  it('en cuerpo a cuerpo el atacante falla también con 3', () => {
    const r = resolveMeleeAttack(new Rng(2), espada(), perfil(), perfil(), {
      ...ctx,
      enCobertura: true,
    });
    expect(r.umbralImpacto).toBe(4);
  });
});

describe('Anti-X', () => {
  it('suma 1D3 de daño contra la clase indicada, solo si hubo daño', () => {
    const arma = fusil({
      ataques: 8,
      precision: 2,
      habilidades: [{ nombre: 'Anti-X', objetivo: 'Vehiculo' }],
    });
    const r = resolveRangedAttack(new Rng(7), arma, perfil(), perfil({ clase: 'Vehiculo', salvacion: 6 }), ctx);
    if (r.danioBase + r.danioCritico > 0) {
      expect(r.bonusAntiX).toBeGreaterThanOrEqual(1);
      expect(r.bonusAntiX).toBeLessThanOrEqual(3);
    } else {
      expect(r.bonusAntiX).toBe(0);
    }
  });

  it('no se aplica contra una clase distinta', () => {
    const arma = fusil({
      ataques: 8,
      precision: 2,
      habilidades: [{ nombre: 'Anti-X', objetivo: 'Vehiculo' }],
    });
    const r = resolveRangedAttack(new Rng(7), arma, perfil(), perfil({ clase: 'Choque', salvacion: 6 }), ctx);
    expect(r.bonusAntiX).toBe(0);
  });
});

describe('Inestable', () => {
  it('con 1-2 el portador sufre el mismo daño que infligió', () => {
    let huboRetroceso = false;
    let huboLibre = false;
    for (let seed = 0; seed < 60; seed++) {
      const r = resolveRangedAttack(
        new Rng(seed),
        fusil({ ataques: 8, precision: 2, habilidades: [{ nombre: 'Inestable' }] }),
        perfil(),
        perfil({ salvacion: 6 }),
        ctx,
      );
      if (r.danioTotal > 0) {
        if (r.danioRetroceso > 0) {
          huboRetroceso = true;
          expect(r.danioRetroceso).toBe(r.danioTotal);
        } else huboLibre = true;
      }
    }
    expect(huboRetroceso).toBe(true);
    expect(huboLibre).toBe(true);
  });

  it('sin daño infligido no hay retroceso', () => {
    const r = resolveRangedAttack(
      new Rng(1),
      fusil({ ataques: 2, precision: 6, habilidades: [{ nombre: 'Inestable' }] }),
      perfil(),
      perfil({ salvacion: 2 }),
      ctx,
    );
    if (r.danioTotal === 0) expect(r.danioRetroceso).toBe(0);
  });
});

describe('Explosiva X', () => {
  it('ofrece X objetivos adicionales solo si el ataque hizo daño', () => {
    const arma = fusil({ ataques: 8, precision: 2, habilidades: [{ nombre: 'Explosiva X', x: 2 }] });
    const r = resolveRangedAttack(new Rng(7), arma, perfil(), perfil({ salvacion: 6 }), ctx);
    expect(r.explosivaObjetivos).toBe(r.danioTotal > 0 ? 2 : 0);
  });
});

describe('Ángulo muerto', () => {
  it('bloquea por debajo de la mitad del alcance', () => {
    const arma = fusil({ distancia: 32, habilidades: [{ nombre: 'Angulo Muerto' }] });
    expect(anguloMuertoBloquea(arma, 15)).toBe(true);
    expect(anguloMuertoBloquea(arma, 16)).toBe(false);
    expect(anguloMuertoBloquea(arma, 30)).toBe(false);
  });

  it('no afecta a un arma sin la habilidad', () => {
    expect(anguloMuertoBloquea(fusil({ distancia: 32 }), 2)).toBe(false);
  });
});

describe('Ataques variables', () => {
  it('1D6 ataques tira entre 1 y 6 dados', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = resolveRangedAttack(
        new Rng(seed),
        fusil({ ataques: { dados: 1, caras: 6, mas: 0 } }),
        perfil(),
        perfil(),
        ctx,
      );
      expect(r.numeroDeAtaques).toBeGreaterThanOrEqual(1);
      expect(r.numeroDeAtaques).toBeLessThanOrEqual(6);
      expect(r.dadosAtaque).toHaveLength(r.numeroDeAtaques);
    }
  });

  it('1D3+2 tira entre 3 y 5 dados', () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = resolveMeleeAttack(
        new Rng(seed),
        espada({ ataques: { dados: 1, caras: 3, mas: 2 } }),
        perfil(),
        perfil(),
        ctx,
      );
      expect(r.numeroDeAtaques).toBeGreaterThanOrEqual(3);
      expect(r.numeroDeAtaques).toBeLessThanOrEqual(5);
    }
  });
});

describe('Habilidades de unidad en el contexto', () => {
  it('Certero mejora la Precisión en 1', () => {
    const r = resolveRangedAttack(new Rng(5), fusil({ precision: 4 }), perfil(), perfil(), {
      ...ctx,
      precisionMejorada: 1,
    });
    expect(r.umbralImpacto).toBe(3);
  });

  it('Emplazado añade un dado de ataque', () => {
    const r = resolveRangedAttack(new Rng(5), fusil({ ataques: 3 }), perfil(), perfil(), {
      ...ctx,
      dadosExtra: 1,
    });
    expect(r.numeroDeAtaques).toBe(4);
  });

  it('Berserker hace fallar al atacante con 1, 2 y 3', () => {
    const r = resolveMeleeAttack(new Rng(2), espada(), perfil(), perfil(), {
      ...ctx,
      defensorBerserker: true,
    });
    expect(r.umbralImpacto).toBe(4);
  });
});

describe('Topes de los umbrales', () => {
  it('la Salvación nunca pasa de 6+', () => {
    const r = resolveRangedAttack(
      new Rng(5),
      fusil({ habilidades: [{ nombre: 'Perforante' }] }),
      perfil(),
      perfil({ salvacion: 6 }),
      ctx,
    );
    expect(r.umbralSalvacion).toBe(6);
  });

  it('un 1 natural siempre falla la salvación', () => {
    // Con Salvación 1+ todos los dados salvarían salvo los unos.
    const r = resolveRangedAttack(new Rng(11), fusil({ ataques: 12, precision: 2 }), perfil(), perfil({ salvacion: 1 }), ctx);
    const unos = r.dadosSalvacion.filter((d) => d === 1).length;
    expect(r.impactosBloqueados).toBe(r.dadosSalvacion.length - unos);
  });
});
