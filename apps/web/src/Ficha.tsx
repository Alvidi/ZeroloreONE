import { formatCantidad, type GameState, type Unit, type UnitProfile } from '@zerolore/core';
import { HABILIDADES_ACTIVAS } from './setup.ts';
import { colorVida } from './vida.ts';

/**
 * Ficha de unidad: los valores impresos del perfil más su estado en la mesa.
 * Ocupa el hueco bajo el tablero, donde antes estaba la leyenda.
 */
/** 'Brutal X+' con x=5 se muestra como 'Brutal 5+'; 'Anti-X' como 'Anti-Vehiculo'. */
function nombreHabilidad(h: { nombre: string; x?: number; objetivo?: string }): string {
  if (h.nombre === 'Brutal X+' && h.x !== undefined) return `Brutal ${h.x}+`;
  if (h.nombre === 'Explosiva X' && h.x !== undefined) return `Explosiva ${h.x}`;
  if (h.nombre === 'Anti-X') return h.objetivo ? `Anti-${h.objetivo}` : 'Anti-X';
  return h.nombre;
}

export function Ficha({ state, unidad }: { state: GameState; unidad: Unit | undefined }) {
  // Sin selección la ficha se queda vacía pero NO desaparece: su altura está
  // reservada, para que el tablero no dé un salto cada vez que seleccionas o
  // deseleccionas una unidad.
  // En la columna, una ficha vacía parece un hueco roto: mejor no pintarla.
  if (!unidad) return null;

  const p: UnitProfile | undefined = state.profiles[unidad.profileId];
  if (!p) return <div className="ficha vacia">Perfil no encontrado.</div>;

  const disparo = p.armas.filter((w) => w.kind === 'disparo');
  const cac = p.armas.filter((w) => w.kind === 'cuerpo_a_cuerpo');
  const fraccion = p.vidas > 0 ? unidad.vidas / p.vidas : 0;

  return (
    <div className={`ficha bando-${unidad.owner}`}>
      <div className="fila-superior">
      <header>
        <span className="id">{unidad.id}</span>
        <span className="nombre">{p.nombre}</span>
        {p.rol && p.rol !== p.nombre && <span className="rol">«{p.rol}»</span>}
        <span className="clase">{p.clase}</span>
        {p.set && <span className="faccion">set {p.set}</span>}
        {unidad.vidas <= 0 && <span className="estado muerta">destruida</span>}
        {unidad.vidas > 0 && unidad.activated && <span className="estado dormida">activada</span>}
        {unidad.trabadaCon.length > 0 && (
          <span className="estado trabada">trabada con {unidad.trabadaCon.join(', ')}</span>
        )}
      </header>

      <div className="perfil">
        <div className="stat"><b>{p.movimiento}"</b><span>Movimiento</span></div>
        <div className="stat"><b>{p.velocidad}"</b><span>Velocidad</span></div>
        <div className="stat"><b>{p.salvacion}+</b><span>Salvación</span></div>
        <div className="stat"><b>{p.valor}</b><span>Valor</span></div>
        <div className="stat"><b>{p.escuadraMin}/{p.escuadraMax}</b><span>Escuadra</span></div>
        <div className="stat vida">
          <b>{unidad.vidas}/{p.vidas}</b><span>Vidas</span>
          <div className="barra">
            <div style={{ width: `${Math.max(0, fraccion) * 100}%`, background: colorVida(unidad.vidas, p.vidas) }} />
          </div>
        </div>
        {state.unidadActiva === unidad.id && (
          <div className="stat acciones"><b>{unidad.accionesRestantes}</b><span>Acciones</span></div>
        )}
      </div>

      </div>

      <div className="armas">
        {/*
          Cada unidad lleva exactamente un arma de cada tipo, así que no hacen
          falta tablas con columna de nombre: basta el tipo como título y sus
          cifras debajo. Van apiladas y sin scroll: caben de un vistazo.
        */}
        {disparo.map((w) => w.kind === 'disparo' && (
          <div className="arma" key="d">
            <span className="tipo">A distancia</span>
            <div className="valores">
              <div className="v"><b>{formatCantidad(w.ataques)}</b><span>Ataques</span></div>
              <div className="v"><b>{w.distancia}"</b><span>Alcance</span></div>
              <div className="v"><b>{w.precision === null ? 'auto' : `${w.precision}+`}</b><span>Precisión</span></div>
              <div className="v"><b>{w.danio}/{w.danioCritico}</b><span>Daño / crítico</span></div>
              {HABILIDADES_ACTIVAS && w.habilidades.length > 0 && (
                <div className="v habs"><b>{w.habilidades.map(nombreHabilidad).join(', ')}</b><span>Habilidades</span></div>
              )}
            </div>
          </div>
        ))}

        {cac.map((w) => w.kind === 'cuerpo_a_cuerpo' && (
          <div className="arma" key="c">
            <span className="tipo">Cuerpo a cuerpo</span>
            <div className="valores">
              <div className="v"><b>{formatCantidad(w.ataques)}</b><span>Ataques</span></div>
              <div className="v"><b>{w.danio}/{w.danioCritico}</b><span>Daño / crítico</span></div>
              {HABILIDADES_ACTIVAS && w.habilidades.length > 0 && (
                <div className="v habs"><b>{w.habilidades.map(nombreHabilidad).join(', ')}</b><span>Habilidades</span></div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
