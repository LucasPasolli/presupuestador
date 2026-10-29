// src/components/facturas/ListadoFacturas.jsx
// Listado de comprobantes agrupado por cliente. UNA fuente de datos, tres
// disposiciones (Strategy por breakpoint):
//
//   mobile  (< 768)     → filas-tarjeta táctiles; tocar abre el detalle.
//   tablet  (768–1024)  → tabla con columnas prioritarias (Nº, Fecha, Estado,
//                          Importe); las secundarias (CUIT, ítems, impuestos)
//                          están en el detalle.
//   desktop (> 1024)    → vista original con los ítems en línea.
//
// El detalle de mobile/tablet se abre en FullScreenSheet. Todo el estado
// (selección, filtros, pestaña) sobrevive a una rotación porque vive acá o en
// el padre y el cambio de layout sólo cambia el render, no desmonta estado.
import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '../ui'
import FullScreenSheet from '../ui/FullScreenSheet'
import useBreakpoint from '../../hooks/useBreakpoint'
import { claveComprobante, fechaDe, fmt, fmtFecha, estadoDe, ESTADO_LABEL, totalesGrupos } from '../../lib/facturas'
import DetalleFactura, { EstadoBadge, ItemsFactura, TotalesFactura } from './DetalleFactura'
import { FOCO, TOQUE } from './estilos'

// ─── Variantes por breakpoint ──────────────────────────────────────────────

function FilaMovil({ cliente, c, onAbrir }) {
  return (
    <li className="border-b border-surface-700/50 last:border-0">
      <button type="button" onClick={() => onAbrir(cliente, c)}
        aria-label={`Comprobante ${c.idPresupuesto} de ${cliente.nombre}, ${fmtFecha(fechaDe(c))}, ${ESTADO_LABEL[estadoDe(c)]}, ${fmt(c.monto)}. Ver detalle`}
        className={`w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left font-body
                    active:bg-surface-700/50 ${FOCO} focus-visible:ring-inset`}>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
            <span className="text-white font-mono text-base tabular-nums">#{c.idPresupuesto}</span>
            <span className="text-surface-300 text-sm tabular-nums">{fmtFecha(fechaDe(c))}</span>
          </span>
          <span className="block mt-1.5"><EstadoBadge comprobante={c} /></span>
        </span>
        <span className="text-brand-400 font-mono font-bold text-base tabular-nums whitespace-nowrap">{fmt(c.monto)}</span>
        <ChevronRight size={18} className="text-surface-500 flex-shrink-0" aria-hidden="true" />
      </button>
    </li>
  )
}

function TablaTablet({ cliente, onAbrir }) {
  return (
    <table className="w-full text-sm font-body">
      <caption className="sr-only">Comprobantes de {cliente.nombre}</caption>
      <thead>
        <tr className="border-b border-surface-700/40 text-surface-400">
          <th scope="col" className="text-left font-normal py-2.5 px-4">Número</th>
          <th scope="col" className="text-left font-normal py-2.5 px-2">Fecha</th>
          <th scope="col" className="text-left font-normal py-2.5 px-2">Estado</th>
          <th scope="col" className="text-right font-normal py-2.5 px-2">Importe</th>
          <th scope="col" className="py-2.5 px-4"><span className="sr-only">Detalle</span></th>
        </tr>
      </thead>
      <tbody>
        {cliente.presupuestos.map((c) => (
          <tr key={claveComprobante(c)} onClick={() => onAbrir(cliente, c)}
            className="border-b border-surface-700/30 last:border-0 cursor-pointer active:bg-surface-700/50 text-surface-200">
            <td className="py-2 px-4 font-mono tabular-nums text-white">#{c.idPresupuesto}</td>
            <td className="py-2 px-2 tabular-nums">{fmtFecha(fechaDe(c))}</td>
            <td className="py-2 px-2"><EstadoBadge comprobante={c} /></td>
            <td className="py-2 px-2 text-right font-mono font-bold text-brand-400 tabular-nums whitespace-nowrap">{fmt(c.monto)}</td>
            <td className="py-1 px-4 text-right">
              {/* El clic burbujea a la fila; el botón aporta foco, teclado y 44 px. */}
              <Button size="sm" variant="secondary" icon={ChevronRight} className={TOQUE}
                aria-label={`Ver detalle del comprobante ${c.idPresupuesto}`}>
                Detalle
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ComprobanteEscritorio({ c }) {
  const clave = claveComprobante(c)
  if (c.tipo === 'pago_parcial') {
    return (
      <div key={clave} className="border-b border-surface-700/50 last:border-0 px-4 py-2.5
                                  bg-yellow-500/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-surface-400 text-xs font-mono flex-shrink-0">#{c.idPresupuesto}</span>
          <span className="text-surface-400 text-xs font-body flex-shrink-0">{fmtFecha(c.fecha)}</span>
          <EstadoBadge comprobante={c} />
        </div>
        <span className="text-brand-400 font-mono text-sm font-bold flex-shrink-0">{fmt(c.monto)}</span>
      </div>
    )
  }
  return (
    <div className="border-b border-surface-700/50 last:border-0">
      <div className="px-4 py-2 bg-surface-800/60 flex items-center gap-3">
        <span className="text-surface-400 text-xs font-mono">#{c.idPresupuesto}</span>
        <span className="text-surface-400 text-xs font-body">{fmtFecha(c.fechaFacturacion)}</span>
        <EstadoBadge comprobante={c} />
      </div>
      {c.items?.length > 0 && <ItemsFactura items={c.items} variante="escritorio" />}
      <TotalesFactura comprobante={c} />
    </div>
  )
}

// ─── Componente ────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {import('../../lib/facturas').GrupoCliente[]} props.grupos
 * @param {string} props.titulo
 * @param {boolean} props.hayFiltros
 * @param {() => void} props.onLimpiarFiltros
 */
export default function ListadoFacturas({ grupos, titulo, hayFiltros, onLimpiarFiltros }) {
  const { isMobile, isTablet, isCompact } = useBreakpoint()
  const [seleccion, setSeleccion] = useState(/** @type {{idCliente: *, clave: string}|null} */ (null))

  // Se resuelve contra los datos vigentes: si un filtro o una recarga quita el
  // comprobante abierto, el panel se cierra solo en vez de mostrar datos viejos.
  const detalle = useMemo(() => {
    if (!seleccion) return null
    const g = grupos.find((x) => x.idCliente === seleccion.idCliente)
    const c = g?.presupuestos.find((p) => claveComprobante(p) === seleccion.clave)
    return c ? { cliente: g, comprobante: c } : null
  }, [grupos, seleccion])

  const abrir = (cliente, c) => setSeleccion({ idCliente: cliente.idCliente, clave: claveComprobante(c) })

  if (grupos.length === 0) {
    return (
      <div className="text-center py-10 px-2 text-surface-500 font-body text-base sm:text-sm space-y-4">
        <p>{hayFiltros
          ? 'Ningún comprobante coincide con los filtros aplicados.'
          : 'Sin movimientos en este período para este tipo de documento.'}</p>
        {hayFiltros && (
          <Button variant="secondary" className={`${TOQUE} mx-auto`} onClick={onLimpiarFiltros}>Limpiar filtros</Button>
        )}
      </div>
    )
  }

  const { total } = totalesGrupos(grupos)

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-surface-300 text-sm min-[1025px]:text-xs uppercase tracking-widest font-body min-w-0 break-words">{titulo}</p>
        <p className="text-brand-400 font-mono font-bold text-base min-[1025px]:text-sm tabular-nums flex-shrink-0">{fmt(total)}</p>
      </div>

      {grupos.map((cliente) => (
        <section key={cliente.idCliente} aria-label={`Cliente ${cliente.nombre}`}
          className="bg-surface-800 border border-surface-700 rounded-xl overflow-hidden">
          <header className="flex items-start justify-between gap-3 px-4 py-3 bg-surface-700/50 border-b border-surface-700">
            <div className="min-w-0">
              <h4 className="text-white text-base min-[1025px]:text-sm font-body font-medium break-words">{cliente.nombre}</h4>
              {cliente.cuit && (
                <p className="text-surface-400 text-sm min-[1025px]:text-xs font-mono">CUIT: {cliente.cuit}</p>
              )}
            </div>
            <p className="text-brand-400 font-mono text-base min-[1025px]:text-sm font-bold tabular-nums whitespace-nowrap">
              {fmt(cliente.totalCliente)}
            </p>
          </header>

          {isMobile && (
            <ul>{cliente.presupuestos.map((c) => (
              <FilaMovil key={claveComprobante(c)} cliente={cliente} c={c} onAbrir={abrir} />
            ))}</ul>
          )}
          {isTablet && <TablaTablet cliente={cliente} onAbrir={abrir} />}
          {!isCompact && cliente.presupuestos.map((c) => <ComprobanteEscritorio key={claveComprobante(c)} c={c} />)}
        </section>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1
                      bg-brand-500/10 border border-brand-500/30 rounded-xl px-4 sm:px-5 py-3">
        <span className="text-white font-body font-semibold text-sm">Total General — {titulo}</span>
        <span className="text-brand-400 font-mono font-bold text-lg tabular-nums">{fmt(total)}</span>
      </div>

      <FullScreenSheet open={isCompact && !!detalle} onClose={() => setSeleccion(null)}
        title={detalle ? `Comprobante #${detalle.comprobante.idPresupuesto}` : ''}>
        {detalle && <DetalleFactura cliente={detalle.cliente} comprobante={detalle.comprobante} esMobile={isMobile} />}
      </FullScreenSheet>
    </div>
  )
}
