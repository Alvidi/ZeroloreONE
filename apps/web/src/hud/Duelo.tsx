import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameEvent, PlayerId } from '@zerolore/core';
import { Dado } from '../Dado.tsx';
import { CSS_JUGADOR, NOMBRE_JUGADOR, iconoDe } from '../partida.ts';
import { colorVida } from '../vida.ts';

/**
 * El cara a cara: atacante a la izquierda, defensor a la derecha, y en medio
 * los dados de verdad, tal como los tiró el motor. Primero ruedan los de
 * ataque, después los de salvación del defensor, y al final el daño baja su
 * barra de vida.
 *
 * Los resultados vienen hechos; aquí solo se cuentan despacio. Un clic salta
 * al final de la tirada y otro pasa a la siguiente.
 */

type Ataque = Extract<GameEvent, { type: 'AtaqueResuelto' }>;
type Danio = Extract<GameEvent, { type: 'DanioRecibido' }>;

export interface LadoDuelo {
  readonly owner: PlayerId;
  readonly nombre: string;
  readonly detalle: string;
  readonly tipoId: string;
  readonly minis: number;
  readonly vidas: number;
  readonly vidasMax: number;
}

export interface ParteDuelo {
  readonly ataque: Ataque;
  readonly danio: Danio | null;
}

export interface DueloProps {
  readonly atacante: LadoDuelo;
  readonly defensor: LadoDuelo;
  readonly partes: readonly ParteDuelo[];
  /** Daño extra repartido por Explosiva a otras miniaturas cercanas. */
  readonly explosiva: number;
  readonly destruido: boolean;
  /** Multiplica las duraciones: menos de 1 es más rápido. */
  readonly ritmo?: number;
  readonly onTerminar: () => void;
}

type Fase = 'presenta' | 'ataque' | 'repite' | 'salva' | 'danio';
const ORDEN_FASES: Fase[] = ['presenta', 'ataque', 'repite', 'salva', 'danio'];

/** Cuánto dura cada fase, en milisegundos. */
const MS: Record<Fase, number> = { presenta: 500, ataque: 1500, repite: 1200, salva: 1400, danio: 1600 };
/** Dentro de cada fase, cuánto ruedan los dados antes de pararse y dejarse leer. */
const MS_RODAR: Partial<Record<Fase, number>> = { ataque: 750, repite: 600, salva: 700 };

export function Duelo({ atacante, defensor, partes, explosiva, destruido, ritmo = 1, onTerminar }: DueloProps) {
  const [iParte, setIParte] = useState(0);
  const [fase, setFase] = useState<Fase>('presenta');
  const [asentado, setAsentado] = useState(false);
  const parte = partes[iParte];
  const terminarRef = useRef(onTerminar);
  terminarRef.current = onTerminar;

  // Vida y miniaturas del defensor al empezar cada parte y al acabarla.
  const tramos = useMemo(() => {
    let vidas = defensor.vidas;
    let minis = defensor.minis;
    return partes.map((p) => {
      const antes = { vidas, minis };
      vidas = Math.max(0, vidas - (p.danio?.danio ?? 0));
      minis = Math.max(0, minis - (p.danio?.muertas.length ?? 0));
      return { antes, despues: { vidas, minis } };
    });
  }, [partes, defensor.vidas, defensor.minis]);

  const t = parte?.ataque.tirada;
  const hayRepeticion = (t?.repetidos.length ?? 0) > 0;
  const haySalvacion = (t?.salvacionesNormales.length ?? 0) + (t?.salvacionesCriticos.length ?? 0) > 0;

  const siguiente = (): void => {
    const i = ORDEN_FASES.indexOf(fase);
    let n = ORDEN_FASES[i + 1];
    if (n === 'repite' && !hayRepeticion) n = 'salva';
    if (n === 'salva' && !haySalvacion) n = 'danio';
    if (n) {
      setFase(n);
      return;
    }
    if (iParte + 1 < partes.length) {
      setIParte(iParte + 1);
      setFase('presenta');
    } else {
      terminarRef.current();
    }
  };

  useEffect(() => {
    setAsentado(false);
    const parar = setTimeout(() => setAsentado(true), (MS_RODAR[fase] ?? 0) * ritmo);
    const avanzar = setTimeout(siguiente, MS[fase] * ritmo);
    return () => {
      clearTimeout(parar);
      clearTimeout(avanzar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fase, iParte]);

  if (!parte || !t) return null;
  const p = t.parametros;
  const tramo = tramos[iParte]!;
  const enDanio = fase === 'danio';
  const vidaDef = enDanio ? tramo.despues.vidas : tramo.antes.vidas;
  const minisDef = enDanio ? tramo.despues.minis : tramo.antes.minis;
  const vista = (f: Fase): boolean => ORDEN_FASES.indexOf(fase) >= ORDEN_FASES.indexOf(f);

  const claseAtaque = (d: number): string => {
    const impacta = p.umbralImpacto === null || d >= p.umbralImpacto;
    if (!impacta) return 'falla';
    return d >= p.umbralCritico ? 'critico' : 'impacta';
  };
  const salva = (d: number): string => (d >= p.salvacion ? 'salvada' : 'herida');

  const saltar = (): void => {
    if (fase !== 'danio') setFase('danio');
    else siguiente();
  };

  const parteNombre =
    parte.ataque.parte === 'tropa'
      ? `Tropa · ${parte.ataque.minis}`
      : parte.ataque.parte === 'comandante'
        ? 'Comandante'
        : parte.ataque.minis > 1 ? `${parte.ataque.minis} miniaturas` : '';

  return (
    <div className="duelo" onClick={saltar}>
      <div className="duelo-banda">
        <Retrato lado={atacante} vidas={atacante.vidas} minis={atacante.minis} rol="atacante" />

        <div className="duelo-centro">
          <div className="duelo-titulo">
            <span className={`arma ${parte.ataque.arma}`}>
              {parte.ataque.arma === 'disparo' ? 'Disparo' : parte.ataque.gratuito ? 'Golpe de carga' : 'Cuerpo a cuerpo'}
            </span>
            {parteNombre && <span className="parte">{parteNombre}</span>}
            {partes.length > 1 && <span className="ronda">{iParte + 1}/{partes.length}</span>}
          </div>

          {p.notas.length > 0 && (
            <div className="duelo-notas">
              {p.notas.map((n) => <span key={n}>{n}</span>)}
            </div>
          )}

          <div className={`duelo-fila ${vista('ataque') ? 'visible' : ''}`}>
            <span className="rotulo">
              {p.umbralImpacto === null ? 'impacta todo' : `impacta ${p.umbralImpacto}+`}
              <i>crítico {p.umbralCritico}+</i>
            </span>
            <GrupoDados
              valores={t.dados}
              rodando={fase === 'presenta' || (fase === 'ataque' && !asentado)}
              clase={(d) => claseAtaque(d)}
              color={CSS_JUGADOR[atacante.owner] ?? '#e5e7eb'}
              arranca={fase === 'ataque'}
            />
          </div>

          {hayRepeticion && (
            <div className={`duelo-fila ${vista('repite') ? 'visible' : ''}`}>
              <span className="rotulo">Implacable <i>repite {t.repetidos.length}</i></span>
              <GrupoDados
                valores={t.repetidos}
                rodando={!vista('repite') || (fase === 'repite' && !asentado)}
                clase={(d) => claseAtaque(d)}
                color={CSS_JUGADOR[atacante.owner] ?? '#e5e7eb'}
                arranca={fase === 'repite'}
              />
            </div>
          )}

          <div className={`duelo-resumen ${vista('ataque') && (fase !== 'ataque' || asentado) ? 'visible' : ''}`}>
            <b>{t.impactos}</b> impactos · <b className="oro">{t.criticos}</b> críticos
          </div>

          {haySalvacion && (
            <div className={`duelo-fila defensa ${vista('salva') ? 'visible' : ''}`}>
              <span className="rotulo">salva {p.salvacion}+</span>
              <GrupoDados
                valores={[...t.salvacionesNormales, ...t.salvacionesCriticos]}
                rodando={!vista('salva') || (fase === 'salva' && !asentado)}
                clase={(d) => salva(d)}
                color={CSS_JUGADOR[defensor.owner] ?? '#e5e7eb'}
                arranca={fase === 'salva'}
              />
            </div>
          )}
          {p.golpeCritico && t.criticos > 0 && vista('salva') && (
            <div className="duelo-nota-critico">{t.criticos} críticos sin salvación</div>
          )}

          <div className={`duelo-danio ${enDanio ? 'visible' : ''}`}>
            {t.total > 0 ? (
              <>
                <span className="cifra">−{parte.danio?.danio ?? t.total}</span>
                <span className="desglose">
                  {t.danioBase > 0 && <i>{t.danioBase} base</i>}
                  {t.danioCritico > 0 && <i className="oro">{t.danioCritico} crítico</i>}
                  {t.ventaja > 0 && <i className="verde">+{t.ventaja} ventaja</i>}
                  {(parte.danio?.reducido ?? 0) > 0 && <i className="azul">Resistente −{parte.danio!.reducido}</i>}
                  {(parte.danio?.muertas.length ?? 0) > 0 && <i className="rojo">{parte.danio!.muertas.length} caídas</i>}
                </span>
              </>
            ) : (
              <span className="cifra nada">sin daño</span>
            )}
          </div>

          {enDanio && iParte === partes.length - 1 && explosiva > 0 && (
            <div className="duelo-nota-critico">Explosiva: −{explosiva} a las cercanas</div>
          )}
          {enDanio && iParte === partes.length - 1 && destruido && <div className="duelo-destruida">¡Destruida!</div>}
        </div>

        <Retrato lado={defensor} vidas={vidaDef} minis={minisDef} rol="defensor" golpeado={enDanio && t.total > 0} />
      </div>
      <div className="duelo-pista">clic para avanzar</div>
    </div>
  );
}

function Retrato({ lado, vidas, minis, rol, golpeado }: {
  lado: LadoDuelo;
  vidas: number;
  minis: number;
  rol: 'atacante' | 'defensor';
  golpeado?: boolean;
}) {
  const f = lado.vidasMax > 0 ? Math.max(0, vidas / lado.vidasMax) : 0;
  return (
    <div className={`duelo-lado ${rol} ${golpeado ? 'golpeado' : ''}`} style={{ ['--equipo' as string]: CSS_JUGADOR[lado.owner] }}>
      <div className="retrato">
        <img src={iconoDe(lado.tipoId)} alt="" draggable={false} />
      </div>
      <div className="datos">
        <span className="bando">{NOMBRE_JUGADOR[lado.owner]}</span>
        <b className="nombre">{lado.nombre}</b>
        <span className="detalle">{lado.detalle}</span>
        <div className="vida">
          <div className="barra"><div style={{ width: `${f * 100}%`, background: colorVida(vidas, lado.vidasMax) }} /></div>
          <span className="cifras">{vidas}<i>/{lado.vidasMax}</i></span>
        </div>
        {lado.minis > 1 && <span className="minis">{minis} miniaturas</span>}
      </div>
    </div>
  );
}

/**
 * Una tanda de dados. Mientras ruedan enseñan caras al azar —puro adorno, el
 * resultado ya lo decidió el motor— y al parar cada uno se tiñe según lo que
 * ha salido. Un solo temporizador mueve toda la tanda.
 */
function GrupoDados({ valores, rodando, clase, color, arranca }: {
  valores: readonly number[];
  rodando: boolean;
  clase: (d: number) => string;
  color: string;
  arranca: boolean;
}) {
  const [caras, setCaras] = useState<number[]>(() => valores.map(() => 1 + Math.floor(Math.random() * 6)));
  useEffect(() => {
    if (!rodando || !arranca) return undefined;
    const id = setInterval(() => setCaras(valores.map(() => 1 + Math.floor(Math.random() * 6))), 70);
    return () => clearInterval(id);
  }, [rodando, arranca, valores]);

  const tam = valores.length > 18 ? 26 : valores.length > 10 ? 32 : 40;
  return (
    <div className="dados-grupo">
      {valores.map((v, i) => {
        const quieto = !rodando;
        const c = quieto ? clase(v) : 'rodando';
        return (
          <span key={i} className={`dado-duelo ${c}`} style={{ animationDelay: `${i * 35}ms` }}>
            <Dado valor={quieto ? v : (caras[i] ?? 1)} tam={tam} color={quieto ? COLOR_CLASE[c] ?? color : color} />
          </span>
        );
      })}
    </div>
  );
}

const COLOR_CLASE: Record<string, string> = {
  impacta: '#22c55e',
  critico: '#f5c451',
  falla: '#4b5563',
  salvada: '#60a5fa',
  herida: '#ef4444',
};
