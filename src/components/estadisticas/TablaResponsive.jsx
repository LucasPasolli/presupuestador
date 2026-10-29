// src/components/estadisticas/TablaResponsive.jsx
// Tabla de datos adaptable (Escenario 4).
//
//  · tablet / escritorio: <table> semántica dentro de un contenedor con scroll
//    horizontal PROPIO (la página nunca desborda). La región es enfocable y
//    anunciada (WCAG 2.1.1 – regiones scrolleables operables con teclado).
//  · mobile (< 768 px): lista de tarjetas. Se muestra la información CLAVE y el
//    resto queda en un detalle expandible (aria-expanded).
//
// Cada columna declara su rol:
//    'rank'    → número de ranking (se muestra a la izquierda en mobile)
//    'titulo'  → texto principal de la fila (se permite que haga wrap)
//    'clave'   → dato prioritario, siempre visible          (por defecto)
//    'detalle' → dato secundario, oculto tras "Ver detalle" en mobile
//
// Presentacional: no ordena ni pagina; recibe `filas` ya procesadas y avisa con
// `onSort(key)`. El estado de filas expandidas vive en el padre del switch
// mobile/escritorio para sobrevivir a una rotación.

import { useId, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react'
import { useBreakpoint } from '../../hooks/useBreakpoint'

const TOQUE = 'min-h-[44px] min-[1025px]:min-h-0'
const ALINEACION = { left: 'text-left', right: 'text-right', center: 'text-center' }

/**
 * @typedef {object} Columna
 * @property {string} key
 * @property {string} label
 * @property {'left'|'right'|'center'} [align]
 * @property {'rank'|'titulo'|'clave'|'detalle'} [rol]
 * @property {boolean} [sortable]
 * @property {string} [thClassName]
 * @property {(fila:any, ctx:{rank:number, index:number})=>React.ReactNode} [render]
 */

/**
 * @param {object} props
 * @param {Columna[]} props.columnas
 * @param {any[]} props.filas
 * @param {(fila:any, index:number)=>string|number} props.getKey
 * @param {string} props.caption                 Nombre accesible de la tabla.
 * @param {number} [props.offset=0]              Para numerar rankings paginados.
 * @param {string|null} [props.sortKey]
 * @param {'asc'|'desc'} [props.sortDir]
 * @param {(key:string)=>void} [props.onSort]
 */
export default function TablaResponsive({
  columnas, filas, getKey, caption, offset = 0, sortKey = null, sortDir = 'desc', onSort,
}) {
  const { isMobile } = useBreakpoint()
  const [abiertas, setAbiertas] = useState(() => new Set())
  const baseId = useId()

  const alternar = (k) => setAbiertas((prev) => {
    const next = new Set(prev)
    next.has(k) ? next.delete(k) : next.add(k)
    return next
  })

  const celda = (col, fila, i) =>
    col.render ? col.render(fila, { rank: offset + i + 1, index: i }) : fila[col.key]

  if (isMobile) {
    return (
      <ListaMobile {...{ columnas, filas, getKey, caption, sortKey, sortDir, onSort, abiertas, alternar, celda, baseId }} />
    )
  }

  return (
    <div role="region" aria-label={caption} tabIndex={0}
      className="overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
      <table className="w-full min-w-[32rem] text-sm font-body">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-surface-700">
            {columnas.map((col) => (
              <th key={col.key} scope="col"
                aria-sort={col.sortable ? (sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                className={`${ALINEACION[col.align ?? 'left']} text-surface-400 text-xs tracking-widest uppercase
                            ${col.sortable ? 'py-1 px-2' : 'py-3 px-4'} whitespace-nowrap ${col.thClassName ?? ''}`}>
                {col.sortable && onSort ? (
                  <button type="button" onClick={() => onSort(col.key)}
                    className={`inline-flex items-center gap-1 py-2 px-2 rounded-lg ${TOQUE} hover:text-white
                                hover:bg-surface-700/60 transition-colors focus:outline-none
                                focus-visible:ring-2 focus-visible:ring-brand-500/60`}>
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-brand-400" aria-hidden="true">{sortDir === 'desc' ? '▼' : '▲'}</span>
                    )}
                  </button>
                ) : col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={getKey(fila, i)}
              className="border-b border-surface-700/40 last:border-0 hover:bg-surface-700/30 transition-colors">
              {columnas.map((col) => (
                <td key={col.key} className={`py-3 px-4 ${ALINEACION[col.align ?? 'left']}`}>
                  {celda(col, fila, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Mobile ────────────────────────────────────────────────────────────────

function ListaMobile({ columnas, filas, getKey, caption, sortKey, sortDir, onSort, abiertas, alternar, celda, baseId }) {
  const { rank, titulo, claves, detalle, ordenables } = useMemo(() => ({
    rank:       columnas.find((c) => c.rol === 'rank'),
    titulo:     columnas.find((c) => c.rol === 'titulo'),
    claves:     columnas.filter((c) => (c.rol ?? 'clave') === 'clave'),
    detalle:    columnas.filter((c) => c.rol === 'detalle'),
    ordenables: columnas.filter((c) => c.sortable),
  }), [columnas])

  return (
    <div>
      {onSort && ordenables.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700">
          <label htmlFor={`${baseId}-orden`} className="text-surface-400 text-xs font-body whitespace-nowrap">
            Ordenar por
          </label>
          <select id={`${baseId}-orden`} value={sortKey ?? ''} onChange={(e) => onSort(e.target.value)}
            className="flex-1 min-w-0 min-h-[44px] bg-surface-700 border border-surface-600 rounded-xl px-3
                       text-white text-base font-body focus:outline-none focus:border-brand-500">
            {sortKey == null && <option value="" disabled>Elegir…</option>}
            {ordenables.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <button type="button" onClick={() => sortKey && onSort(sortKey)} disabled={!sortKey}
            aria-label={sortDir === 'desc' ? 'Orden descendente, cambiar a ascendente' : 'Orden ascendente, cambiar a descendente'}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl bg-surface-700
                       border border-surface-600 text-surface-200 disabled:opacity-40
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
            {sortDir === 'desc' ? <ArrowDown size={18} /> : <ArrowUp size={18} />}
          </button>
        </div>
      )}

      <ul aria-label={caption} className="divide-y divide-surface-700/60">
        {filas.map((fila, i) => {
          const k = getKey(fila, i)
          const abierto = abiertas.has(k)
          const panelId = `${baseId}-det-${k}`
          return (
            <li key={k} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {rank && <div className="w-7 pt-0.5 flex-shrink-0">{celda(rank, fila, i)}</div>}
                <div className="min-w-0 flex-1">
                  {titulo && <div className="text-sm font-body break-words">{celda(titulo, fila, i)}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    {claves.map((c) => (
                      <span key={c.key} className="inline-flex items-center gap-1.5">
                        <span className="text-surface-500 text-xs font-body">{c.label}</span>
                        {celda(c, fila, i)}
                      </span>
                    ))}
                  </div>
                </div>
                {detalle.length > 0 && (
                  <button type="button" onClick={() => alternar(k)}
                    aria-expanded={abierto} aria-controls={panelId}
                    aria-label={abierto ? 'Ocultar detalle' : 'Ver detalle'}
                    className="flex items-center justify-center min-h-[44px] min-w-[44px] -mr-2 -my-1 flex-shrink-0
                               rounded-xl text-surface-400 hover:text-white hover:bg-surface-700/60
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60">
                    <ChevronDown size={18} className={`transition-transform ${abierto ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

              {detalle.length > 0 && abierto && (
                <dl id={panelId} className="mt-2 ml-10 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-surface-700/30 p-3">
                  {detalle.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-surface-500 text-[11px] uppercase tracking-widest font-body">{c.label}</dt>
                      <dd className="text-sm break-words">{celda(c, fila, i)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
