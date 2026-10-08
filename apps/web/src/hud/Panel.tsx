import type { ReactNode } from 'react';
import {
  comandanteDe,
  formatCantidad,
  tropaDe,
  type Arma,
  type EnReserva,
  type GameState,
  type PlayerId,
  type Unidad,
} from '@zerolore/core';
import { TIPOS, iconoDe } from '../partida.ts';
import { HABILIDAD_ARMA, HABILIDAD_UNIDAD } from '../textos.ts';
import { colorVida } from '../vida.ts';
import { rotulo, rotuloReserva, vidaDe } from './nombres.ts';

/**
 * La banda de abajo, pensada para un jugador: tu ejército a la izquierda
 * —lo que está en mesa y lo que espera en Reserva—, la ficha de lo que miras
 * en medio, y tus cartas de equipamiento a la derecha.
 */

export interface Carta {
  readonly id: string;
  readonly nombre: string;
  readonly descripcion: string;
  /** "2" acciones, o "No gasta acción". */
  readonly accion: string;
  readonly jugable: boolean;
}

export interface PanelProps {
  readonly estado: GameState;
  readonly jugador: PlayerId;
  readonly seleccion: string | null;
  /** Lo que va en medio: la ficha, o la previsión cuando se apunta. */
  readonly centro: ReactNode;
  readonly cartas: readonly Carta[];
  readonly reservaEnMano: string | null;
  readonly puedeDesplegar: (reservaId: string) => boolean;
  readonly puedePasar: boolean;
  readonly onSeleccionar: (unidadId: string) => void;
  readonly onCogerReserva: (reservaId: string) => void;
  readonly onPasar: () => void;
  readonly onCarta: (id: string) => void;
}

export function Panel(p: PanelProps) {
  const mias = Object.values(p.estado.unidades).filter((u) => u.owner === p.jugador);
  const reserva = p.estado.reserva.filter((r) => r.owner === p.jugador);
  return (
    <footer className="panel">
      <section className="ejercito">
        <div className="grupo">
          <h3>En mesa <i>{mias.length}</i></h3>
          <div className="fichas">
            {mias.length === 0 && <span className="vacio">nada todavía</span>}
            {mias.map((u) => (
              <FichaUnidad
                key={u.id}
                estado={p.estado}
                u={u}
                seleccionada={p.seleccion === u.id}
                activa={p.estado.unidadActiva === u.id}
                onClick={() => p.onSeleccionar(u.id)}
              />
            ))}
          </div>
        </div>
        <div className="grupo reserva">
          <h3>
            Reserva <i>{reserva.length}</i>
            {p.puedePasar && <button className="pasar" onClick={p.onPasar}>Listo</button>}
          </h3>
          <div className="fichas">
            {reserva.length === 0 && <span className="vacio">todo en mesa</span>}
            {reserva.map((r) => (
              <FichaReserva
                key={r.id}
                r={r}
                enMano={p.reservaEnMano === r.id}
                disponible={p.puedeDesplegar(r.id)}
                onCoger={() => p.onCogerReserva(r.id)}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="centro">{p.centro}</section>

      <section className="equipo">
        <h3>Equipamiento <i>{p.cartas.length}</i></h3>
        <div className="cartas">
          {p.cartas.length === 0 && <span className="vacio">sin cartas</span>}
          {p.cartas.map((c) => (
            <button
              key={c.id}
              className={`carta ${c.jugable ? '' : 'apagada'}`}
              title={c.descripcion}
              onClick={() => c.jugable && p.onCarta(c.id)}
            >
              <img src={iconoDe('equipamiento')} alt="" draggable={false} />
              <b>{c.nombre}</b>
              <span className="coste">{/^\d/.test(c.accion) ? `${c.accion} acc.` : 'gratis'}</span>
            </button>
          ))}
        </div>
      </section>
    </footer>
  );
}

function FichaUnidad({ estado, u, seleccionada, activa, onClick }: {
  estado: GameState;
  u: Unidad;
  seleccionada: boolean;
  activa: boolean;
  onClick: () => void;
}) {
  const r = rotulo(u);
  const v = vidaDe(estado, u);
  const clases = ['ficha-unidad', seleccionada ? 'sel' : '', activa ? 'activa' : '', u.activada ? 'dormida' : '', u.trabadaCon.length > 0 ? 'trabada' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button className={clases} onClick={onClick} title={`${r.titulo}${r.detalle ? ` · ${r.detalle}` : ''}`}>
      <img src={iconoDe(r.tipoId)} alt="" draggable={false} />
      {u.minis.length > 1 && <span className="cuenta">{u.minis.length}</span>}
      {comandanteDe(u) && <span className="corona">★</span>}
      <span className="barra"><i style={{ width: `${(v.actuales / Math.max(1, v.maximas)) * 100}%`, background: colorVida(v.actuales, v.maximas) }} /></span>
      {u.activada && <span className="marca">z</span>}
      {u.trabadaCon.length > 0 && <span className="marca cac">⚔</span>}
    </button>
  );
}

function FichaReserva({ r, enMano, disponible, onCoger }: {
  r: EnReserva;
  enMano: boolean;
  disponible: boolean;
  onCoger: () => void;
}) {
  const ro = rotuloReserva(r.minis);
  return (
    <button
      className={`ficha-unidad reserva ${enMano ? 'en-mano' : ''} ${disponible ? '' : 'bloqueada'}`}
      title={`${ro.titulo}${ro.detalle ? ` · ${ro.detalle}` : ''}${disponible ? ' — arrástrala a un puesto' : ''}`}
      disabled={!disponible}
      onPointerDown={(e) => {
        // Se suelta la captura para que el tablero reciba el arrastre.
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (disponible) onCoger();
      }}
    >
      <img src={iconoDe(ro.tipoId)} alt="" draggable={false} />
      {r.minis.length > 1 && <span className="cuenta">{r.minis.length}</span>}
      {r.minis.some((m) => m.esComandante) && <span className="corona">★</span>}
    </button>
  );
}

/** La ficha de la unidad que se está mirando: perfil, armas y habilidad. */
export function FichaDetalle({ estado, u }: { estado: GameState; u: Unidad }) {
  const r = rotulo(u);
  const v = vidaDe(estado, u);
  const tropa = tropaDe(u);
  const comandante = comandanteDe(u);
  const tTropa = tropa[0] ? TIPOS[tropa[0].tipoId]! : TIPOS[u.minis[0]!.tipoId]!;
  const tComandante = comandante ? TIPOS[comandante.tipoId]! : null;
  return (
    <div className={`ficha p${u.owner}`}>
      <div className="cabecera">
        <img src={iconoDe(r.tipoId)} alt="" draggable={false} />
        <div>
          <b className="nombre">{r.titulo}</b>
          {r.detalle && <span className="detalle">{r.detalle}</span>}
          <div className="vida">
            <div className="barra"><div style={{ width: `${(v.actuales / Math.max(1, v.maximas)) * 100}%`, background: colorVida(v.actuales, v.maximas) }} /></div>
            <span className="cifras">{v.actuales}<i>/{v.maximas}</i></span>
          </div>
        </div>
      </div>
      <div className="valores">
        <Valor v={tTropa.movimiento === null ? '—' : `${tTropa.movimiento}"`} r="mov" />
        <Valor v={`+${tTropa.velocidad}"`} r="vel" />
        <Valor v={`${tTropa.salvacion}+`} r="salv" />
        <Valor v={String(tTropa.valor)} r="valor" />
        {u.minis.length > 1 && (
          <span className="pips" title="Vidas de cada miniatura">
            {u.minis.map((m) => (
              <i key={m.id} className={m.esComandante ? 'comandante' : ''} style={{ background: colorVida(m.vidas, TIPOS[m.tipoId]!.vidas) }} />
            ))}
          </span>
        )}
      </div>
      <div className="armas">
        <Armas t={tTropa.disparo} />
        <Armas t={tTropa.cac} />
        {tComandante && tComandante !== tTropa && (
          <>
            <span className="sub">Comandante</span>
            <Armas t={tComandante.disparo} />
            <Armas t={tComandante.cac} />
          </>
        )}
      </div>
      <div className="habilidad" title={HABILIDAD_UNIDAD[tTropa.habilidad] ?? ''}>
        <b>{tTropa.habilidad}</b> <span>{HABILIDAD_UNIDAD[tTropa.habilidad] ?? ''}</span>
      </div>
    </div>
  );
}

function Valor({ v, r }: { v: string; r: string }) {
  return <span className="valor"><b>{v}</b><i>{r}</i></span>;
}

function Armas({ t }: { t: Arma | null }) {
  if (!t) return null;
  return (
    <div className="arma">
      <span className="tipo">{t.kind === 'disparo' ? '➳' : '⚔'}</span>
      <b>{formatCantidad(t.ataques)}</b>
      {t.kind === 'disparo' && <><b>{t.distancia}"</b><b>{t.precision === null ? 'auto' : `${t.precision}+`}</b></>}
      <b>{t.danio}/{t.danioCritico}</b>
      {t.habilidades.filter((h) => h !== 'Fiable').map((h) => (
        <span key={h} className="hab" title={HABILIDAD_ARMA[h]}>{h}</span>
      ))}
    </div>
  );
}
