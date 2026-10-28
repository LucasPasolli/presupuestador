// src/components/pedidos/FiltrosPedidos.jsx
// Búsqueda + filtros del listado de pedidos.
//   • Escritorio (compact=false): barra inline con aplicación inmediata (como antes).
//   • Mobile/tablet (compact=true): el buscador queda siempre visible y el resto
//     de los filtros vive en un panel a pantalla completa con BORRADOR propio:
//     "Aplicar" confirma, "Limpiar" vacía el borrador, cerrar con ✕/Esc descarta.
//
// Componente CONTROLADO: el valor aplicado vive en el padre, por eso rotar el
// equipo (que cambia `compact`) nunca pierde los filtros. El borrador sólo
// existe mientras el panel está abierto.

import { useEffect, useId, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Button, Card, Input, Select } from '../ui'
import FullScreenSheet from '../ui/FullScreenSheet'
import { TOUCH } from './pedidosPresentacion'

export const FILTROS_INICIALES = Object.freeze({
  filterProv: '', filterEst: 'all', filterLog: 'all', filterDesde: '', filterHasta: '',
})

const CAMPOS_PANEL = ['filterLog', 'filterEst', 'filterDesde', 'filterHasta']

/** Cantidad de filtros del panel que no están en su valor por defecto. */
export function contarFiltrosActivos(v) {
  return CAMPOS_PANEL.filter((k) => v[k] !== FILTROS_INICIALES[k]).length
}

/** `true` si el rango de fechas es incoherente (desde > hasta). Fechas ISO comparan como texto. */
export function rangoInvalido(desde, hasta) {
  return Boolean(desde && hasta && desde > hasta)
}

const field =
  'w-full bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-white font-body text-sm ' +
  'focus:outline-none focus:border-brand-500 transition-all [color-scheme:dark]'
const labelCls = 'block text-surface-300 text-xs tracking-widest uppercase font-body mb-1'

/**
 * Campos de estado/fecha.
 *  • compact: componentes Select/Input del sistema de diseño (ya usan text-base en
 *    táctil, labels y errores accesibles) apilados en una columna.
 *  • escritorio: controles compactos en línea, con etiquetas sólo para lectores de pantalla.
 */
function CamposFiltro({ values, onChange, compact, idBase }) {
  const set = (k) => (e) => onChange({ ...values, [k]: e.target.value })

  if (compact) {
    return (
      <>
        <Select label="Estado logístico" value={values.filterLog} onChange={set('filterLog')} className={TOUCH}>
          <option value="all">Todos</option>
          <option value="encargado">Encargado</option>
          <option value="recibido">Recibido</option>
        </Select>
        <Select label="Estado de pago" value={values.filterEst} onChange={set('filterEst')} className={TOUCH}>
          <option value="all">Todos</option>
          <option value="pendiente">Pago pendiente</option>
          <option value="pagado">Pagado</option>
        </Select>
        <Input label="Desde" type="date" value={values.filterDesde} max={values.filterHasta || undefined}
          onChange={set('filterDesde')} className={`${TOUCH} [color-scheme:dark]`} />
        <Input label="Hasta" type="date" value={values.filterHasta} min={values.filterDesde || undefined}
          onChange={set('filterHasta')} className={`${TOUCH} [color-scheme:dark]`} />
      </>
    )
  }

  return (
    <>
      <div>
        <label htmlFor={`${idBase}-log`} className="sr-only">Estado logístico</label>
        <select id={`${idBase}-log`} value={values.filterLog} onChange={set('filterLog')} className={`${field} cursor-pointer`}>
          <option value="all">Estado logístico</option>
          <option value="encargado">Encargado</option>
          <option value="recibido">Recibido</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${idBase}-est`} className="sr-only">Estado de pago</label>
        <select id={`${idBase}-est`} value={values.filterEst} onChange={set('filterEst')} className={`${field} cursor-pointer`}>
          <option value="all">Estado de pago</option>
          <option value="pendiente">Pago pendiente</option>
          <option value="pagado">Pagado</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${idBase}-desde`} className={labelCls}>Desde</label>
        <input id={`${idBase}-desde`} type="date" value={values.filterDesde} max={values.filterHasta || undefined}
          onChange={set('filterDesde')} className={field} />
      </div>
      <div>
        <label htmlFor={`${idBase}-hasta`} className={labelCls}>Hasta</label>
        <input id={`${idBase}-hasta`} type="date" value={values.filterHasta} min={values.filterDesde || undefined}
          onChange={set('filterHasta')} className={field} />
      </div>
    </>
  )
}

/**
 * @param {object}   props
 * @param {typeof FILTROS_INICIALES} props.value     Filtros aplicados.
 * @param {(next:typeof FILTROS_INICIALES)=>void} props.onChange
 * @param {boolean}  props.compact   mobile o tablet.
 */
export default function FiltrosPedidos({ value, onChange, compact }) {
  const idBase = useId()
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState(value)

  // Si se rota a escritorio con el panel abierto, se cierra (ya hay barra inline).
  useEffect(() => { if (!compact) setAbierto(false) }, [compact])

  const activos = contarFiltrosActivos(value)
  const hayAlgo = activos > 0 || value.filterProv.trim() !== ''
  const limpiarTodo = () => onChange({ ...FILTROS_INICIALES })
  const setBusqueda = (e) => onChange({ ...value, filterProv: e.target.value })

  function abrirPanel() { setBorrador(value); setAbierto(true) }
  function aplicar() {
    if (rangoInvalido(borrador.filterDesde, borrador.filterHasta)) return
    onChange({ ...value, ...Object.fromEntries(CAMPOS_PANEL.map((k) => [k, borrador[k]])) })
    setAbierto(false)
  }
  function limpiarBorrador() {
    setBorrador((b) => ({ ...b, ...Object.fromEntries(CAMPOS_PANEL.map((k) => [k, FILTROS_INICIALES[k]])) }))
  }

  const buscador = (
    <div className="relative flex-1 min-w-[180px]">
      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-surface-400 pointer-events-none" />
      <label htmlFor={`${idBase}-q`} className="sr-only">Buscar por proveedor o ID</label>
      <input
        id={`${idBase}-q`} type="search" value={value.filterProv} onChange={setBusqueda}
        placeholder="Buscar por proveedor o ID..."
        className={`w-full bg-surface-700 border border-surface-600 rounded-xl pl-9 pr-4 py-2 text-white font-body
                    placeholder-surface-500 focus:outline-none focus:border-brand-500 transition-all
                    ${compact ? `text-base ${TOUCH}` : 'text-sm'}`}
      />
    </div>
  )

  // ── Escritorio: barra inline, aplicación inmediata ────────────────────────
  if (!compact) {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end w-full">
          {buscador}
          <CamposFiltro values={value} onChange={onChange} compact={false} idBase={idBase} />
          {hayAlgo && (
            <button type="button" onClick={limpiarTodo}
              className="bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 text-surface-400 text-sm font-body
                         hover:text-white hover:border-surface-500 transition-all whitespace-nowrap">
              Limpiar
            </button>
          )}
        </div>
      </Card>
    )
  }

  // ── Mobile / tablet ───────────────────────────────────────────────────────
  const invalido = rangoInvalido(borrador.filterDesde, borrador.filterHasta)
  return (
    <Card className="p-3 sm:p-4 space-y-2">
      <div className="flex gap-2">
        {buscador}
        <Button variant="secondary" icon={SlidersHorizontal} onClick={abrirPanel}
          className={`${TOUCH} flex-shrink-0`} aria-haspopup="dialog">
          Filtros{activos > 0 ? ` (${activos})` : ''}
        </Button>
      </div>

      {hayAlgo && (
        <div className="flex items-center justify-between text-sm font-body" role="status" aria-live="polite">
          <span className="text-surface-300">
            {activos > 0 ? `${activos} filtro${activos !== 1 ? 's' : ''} activo${activos !== 1 ? 's' : ''}` : 'Búsqueda activa'}
          </span>
          <button type="button" onClick={limpiarTodo}
            className="min-h-[44px] px-3 -mr-3 text-brand-400 hover:text-brand-300">
            Limpiar todo
          </button>
        </div>
      )}

      <FullScreenSheet
        open={abierto}
        onClose={() => setAbierto(false)}
        title="Filtros"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className={`flex-1 ${TOUCH}`} onClick={limpiarBorrador}>Limpiar</Button>
            <Button className={`flex-1 ${TOUCH}`} onClick={aplicar} disabled={invalido}>Aplicar</Button>
          </div>
        }
      >
        <div className="space-y-4 max-w-md mx-auto">
          <CamposFiltro values={borrador} onChange={setBorrador} compact idBase={`${idBase}-p`} />
          {invalido && (
            <p role="alert" className="text-red-400 text-sm font-body">
              La fecha "Desde" no puede ser posterior a "Hasta".
            </p>
          )}
        </div>
      </FullScreenSheet>
    </Card>
  )
}
