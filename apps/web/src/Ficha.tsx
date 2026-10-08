import { formatCantidad, type GameState, type Unit, type UnitProfile } from '@zerolore/core';
import { HABILIDADES_ARMA } from './setup.ts';
import { nombreHabilidad, reglaHabilidad } from './habilidades.ts';
import { colorVida } from './vida.ts';

/**
 * Ficha de unidad para la banda de abajo: quién es, cómo está y con qué pega.
 *
 * Va en dos líneas y sin cuadritos porque comparte sitio con las dos compañías
 * y con la mesa; cada píxel de alto que ocupa aquí se lo quita al tablero. Los
 * valores impresos van grandes y sus rótulos diminutos: en partida se mira el
 * número, no la palabra.
 */
export function Ficha({ state, unidad }: { state: GameState; unidad: Unit | undefined }) {
  // En la banda, una ficha vacía parece un hueco roto: mejor no pintarla.
  if (!unidad) return null;

  const p: UnitProfile | undefined = state.profiles[unidad.profileId];
  if (!p) return <div className="ficha vacia">Perfil no encontrado.</div>;

  const fraccion = p.vidas > 0 ? Math.max(0, unidad.vidas / p.vidas) : 0;
  const activa = state.unidadActiva === unidad.id;

  return (
    <div className={`ficha bando-${unidad.owner}`}>
      <div className="quien">
        <span className="id">{unidad.id}</span>
        <span className="nombre">{p.nombre}</span>
        <span className="clase">{p.clase}</span>
        {p.rol && p.rol !== p.nombre && <span className="rol">«{p.rol}»</span>}
        {unidad.vidas <= 0 && <span className="estado muerta">destruida</span>}
        {unidad.vidas > 0 && unidad.activated && <span className="estado dormida">ya jugó</span>}
        {unidad.trabadaCon.length > 0 && (
          <span className="estado trabada">trabada con {unidad.trabadaCon.join(', ')}</span>
        )}
      </div>

      <div className="estado-vivo">
        <div className="barra" title={`${unidad.vidas} de ${p.vidas} vidas`}>
          <div style={{ width: `${fraccion * 100}%`, background: colorVida(unidad.vidas, p.vidas) }} />
        </div>
        <span className="vidas">{unidad.vidas}<i>/{p.vidas}</i></span>
        {activa && (
          <span className="acciones">
            {unidad.accionesRestantes}<i>{unidad.accionesRestantes === 1 ? ' acción' : ' acciones'}</i>
          </span>
        )}
      </div>

      <div className="valores">
        <Valor v={`${p.movimiento}"`} r="mov" />
        <Valor v={`${p.velocidad}"`} r="vel" />
        <Valor v={`${p.salvacion}+`} r="salv" />
        <Valor v={String(p.valor)} r="valor" />
      </div>

      <div className="armas">
        {/*
          Un arma por línea y en el orden en que se usan. Cada unidad lleva como
          mucho una de cada tipo, así que el icono basta para saber cuál es.
        */}
        {[...p.armas]
          .sort((a, b) => (a.kind === 'disparo' ? 0 : 1) - (b.kind === 'disparo' ? 0 : 1))
          .map((w) => (
          <div className="arma" key={w.kind}>
            <span className="tipo" title={w.kind === 'disparo' ? 'A distancia' : 'Cuerpo a cuerpo'}>
              {w.kind === 'disparo' ? '➳' : '⚔'}
            </span>
            <b>{formatCantidad(w.ataques)}</b><span className="r">at</span>
            {w.kind === 'disparo' && <><b>{w.distancia}"</b><span className="r">alc</span></>}
            {w.kind === 'disparo' && (
              <><b>{w.precision === null ? 'auto' : `${w.precision}+`}</b><span className="r">prec</span></>
            )}
            <b>{w.danio}/{w.danioCritico}</b><span className="r">daño</span>
            {HABILIDADES_ARMA && w.habilidades.map((h, i) => (
              <span key={h.nombre + i} className="hab" title={reglaHabilidad(h)}>
                {nombreHabilidad(h)}
              </span>
            ))}
          </div>
          ))}
      </div>
    </div>
  );
}

function Valor({ v, r }: { v: string; r: string }) {
  return <span className="valor"><b>{v}</b><i>{r}</i></span>;
}
