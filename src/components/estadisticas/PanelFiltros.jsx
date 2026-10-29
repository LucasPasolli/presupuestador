// src/components/estadisticas/PanelFiltros.jsx
// Filtros de período (Escenario 5).
//
//  · escritorio (> 1024 px): chips + fechas en línea, se aplican al instante
//    (comportamiento original), pero un rango inválido nunca se consulta.
//  · mobile / tablet: una barra-resumen con el período vigente y un botón
//    "Filtros" que abre un panel a pantalla completa (FullScreenSheet) con
//    selector táctil (44 px, inputs 16 px para evitar el zoom de iOS) y botones
//    Aplicar / Limpiar fijos al pie. Se edita un BORRADOR: no se dispara una
//    consulta por cada toque.
//
// El estado aplicado vive en el padre (useFiltrosEstadisticas); el borrador es
// local pero este componente NO se desmonta al rotar → los filtros se mantienen
// (Escenario 6).

import { useEffect, useState } from 'react'
import { CalendarRange, SlidersHorizontal } from 'lucide-react'
import { Button, Card } from '../ui'
import FullScreenSheet from '../ui/FullScreenSheet'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import {
  RANGOS, IDX_PERSONALIZADO, filtrosIniciales, errorDeFiltros,
} from '../../hooks/useFiltrosEstadisticas'
import { fmtFecha, hoyISO } from './formatters'

const TOQUE = 'justify-center min-h-[44px] min-[1025px]:min-h-0'

const INPUT_FECHA =
  'w-full min-h-[44px] min-[1025px]:min-h-0 bg-surface-700 border border-surface-600 rounded-xl px-3 py-2 ' +
  'text-white text-base min-[1025px]:text-sm font-body focus:outline-none focus:border-brand-500 [color-scheme:dark]'

/**
 * @param {object} props
 * @param {{rangoIdx:number, desdeCustom:string, hastaCustom:string}} props.filtros  Filtros APLICADOS.
 * @param {string} props.desde  Rango vigente (resuelto).
 * @param {string} props.hasta
 * @param {(f:object)=>boolean} props.onAplicar
 * @param {()=>void} props.onLimpiar
 */
export default function PanelFiltros({ filtros, desde, hasta, onAplicar, onLimpiar }) {
  const { isCompact } = useBreakpoint()
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState(filtros)

  // Si los filtros aplicados cambian desde afuera (p. ej. "Limpiar"), el borrador los sigue.
  useEffect(() => { if (!abierto) setBorrador(filtros) }, [filtros, abierto])

  const error = errorDeFiltros(borrador)
  const hoy = hoyISO()

  /** Al pasar a "Personalizado" se precargan las fechas vigentes: nunca queda un rango vacío. */
  function conRango(idx) {
    if (idx !== IDX_PERSONALIZADO) return { ...borrador, rangoIdx: idx }
    const venia = borrador.rangoIdx === IDX_PERSONALIZADO
    return {
      rangoIdx: idx,
      desdeCustom: venia ? borrador.desdeCustom : desde,
      hastaCustom: venia ? borrador.hastaCustom : hasta,
    }
  }

  /** Escritorio: aplica en vivo si es válido; en compacto solo edita el borrador. */
  function editar(siguiente) {
    setBorrador(siguiente)
    if (!isCompact) onAplicar(siguiente)
  }

  const abrir = () => { setBorrador(filtros); setAbierto(true) }
  const cancelar = () => setAbierto(false)
  const aplicar = () => { if (onAplicar(borrador)) setAbierto(false) }
  const limpiar = () => { onLimpiar(); setBorrador(filtrosIniciales()); setAbierto(false) }

  const chips = (
    <div role="group" aria-label="Período" className={isCompact ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap gap-2'}>
      {RANGOS.map((r, i) => (
        <button key={r.id} type="button" aria-pressed={borrador.rangoIdx === i}
          onClick={() => editar(conRango(i))}
          className={`px-4 py-2 rounded-xl text-sm font-body transition-all border ${TOQUE}
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60
            ${borrador.rangoIdx === i
              ? 'bg-brand-500/15 border-brand-500/40 text-white'
              : 'bg-surface-700 border-surface-600 text-surface-300 hover:border-surface-500'}`}>
          {r.label}
        </button>
      ))}
    </div>
  )

  const fechas = borrador.rangoIdx === IDX_PERSONALIZADO && (
    <div className={isCompact ? 'mt-4 grid grid-cols-1 gap-3' : 'flex items-center gap-2 ml-2'}>
      <div>
        <label htmlFor="est-desde" className={isCompact ? 'block text-surface-400 text-xs font-body mb-1' : 'sr-only'}>Desde</label>
        <input id="est-desde" type="date" value={borrador.desdeCustom} max={borrador.hastaCustom || hoy}
          onChange={(e) => editar({ ...borrador, desdeCustom: e.target.value })}
          aria-invalid={!!error} className={INPUT_FECHA} />
      </div>
      {!isCompact && <span className="text-surface-500 text-sm" aria-hidden="true">→</span>}
      <div>
        <label htmlFor="est-hasta" className={isCompact ? 'block text-surface-400 text-xs font-body mb-1' : 'sr-only'}>Hasta</label>
        <input id="est-hasta" type="date" value={borrador.hastaCustom} min={borrador.desdeCustom || undefined}
          onChange={(e) => editar({ ...borrador, hastaCustom: e.target.value })}
          aria-invalid={!!error} className={INPUT_FECHA} />
      </div>
    </div>
  )

  const mensajeError = error && (
    <p role="alert" className="mt-3 text-red-400 text-sm font-body">{error}</p>
  )

  // ── Mobile / tablet ──────────────────────────────────────────────────────
  if (isCompact) {
    return (
      <>
        <Card className="p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CalendarRange size={18} className="text-brand-500 flex-shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-surface-400 text-xs font-body">{RANGOS[filtros.rangoIdx].label}</p>
                <p className="text-white text-sm font-mono break-words">{fmtFecha(desde)} → {fmtFecha(hasta)}</p>
              </div>
            </div>
            <Button variant="secondary" onClick={abrir} icon={SlidersHorizontal}
              className={`flex-shrink-0 ${TOQUE}`}>
              Filtros
            </Button>
          </div>
        </Card>

        <FullScreenSheet
          open={abierto && isCompact}
          onClose={cancelar}
          title="Filtros de período"
          footer={(
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={limpiar} className={TOQUE}>Limpiar</Button>
              <Button onClick={aplicar} disabled={!!error} className={TOQUE}>Aplicar</Button>
            </div>
          )}
        >
          {chips}
          {fechas}
          {mensajeError}
        </FullScreenSheet>
      </>
    )
  }

  // ── Escritorio ───────────────────────────────────────────────────────────
  return (
    <Card className="p-4">
      <div className="flex flex-wrap gap-2 items-center">
        {chips}
        {fechas}
        {borrador.rangoIdx === IDX_PERSONALIZADO && (
          <Button variant="secondary" onClick={limpiar} className="ml-2">Limpiar Filtros</Button>
        )}
      </div>
      {mensajeError}
    </Card>
  )
}
