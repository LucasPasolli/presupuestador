// src/components/pedidos/PedidosListado.jsx
// Listado de pedidos con tres presentaciones sobre los MISMOS datos:
//   mobile  (<768)        → tarjetas compactas, sin scroll horizontal.
//   tablet  (768–1024)    → tabla con columnas prioritarias + fila expandible
//                           con las secundarias (fecha, método de pago).
//   desktop (>1024)       → tabla completa (igual que antes).
// Los pedidos se abren con tocar la fila/tarjeta; el chevron de tablet sólo
// expande (no navega). El Set de filas expandidas vive en este componente, que
// permanece montado al rotar, así que la expansión sobrevive al cambio de layout.

import { Fragment, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, ShoppingCart } from 'lucide-react'
import { Button, Card } from '../ui'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import {
  EstadoLogisticoBadge, PagoBadge, TOUCH, fmt, fmtFecha, metodoPagoLabel,
} from './pedidosPresentacion'

const TH = 'text-left text-surface-400 text-sm min-[1025px]:text-xs tracking-widest uppercase py-3 px-3 min-[1025px]:px-4 font-body'

/** Activa la fila con Enter / Espacio (las filas clickeables no eran operables con teclado). */
const teclaActivar = (fn) => (e) => {
  if (e.target !== e.currentTarget) return
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
}

function PedidoCard({ pedido: p, resumen, onAbrir }) {
  const abrir = () => onAbrir(p)
  return (
    <div
      role="button" tabIndex={0} onClick={abrir} onKeyDown={teclaActivar(abrir)}
      aria-label={`Abrir pedido ${p.idPedido}${p.nombreProveedor ? ` de ${p.nombreProveedor}` : ''}`}
      className="bg-surface-700/40 border border-surface-700 rounded-2xl p-4 space-y-3 cursor-pointer
                 active:bg-surface-700/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-brand-400 font-mono text-base">#{p.idPedido}</span>
        <span className="text-surface-300 font-mono text-sm">{fmtFecha(p.fecha)}</span>
      </div>
      <p className="text-white text-base font-body font-medium break-words">
        {p.nombreProveedor || <span className="text-surface-500">—</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <EstadoLogisticoBadge pedido={p} />
        <PagoBadge pedido={p} resumen={resumen} />
      </div>
      <div className="flex items-end justify-between gap-3 pt-2 border-t border-surface-700/60">
        <span className="text-surface-300 text-sm font-body">{metodoPagoLabel(p)}</span>
        <span className="text-white font-mono font-semibold text-lg">{fmt(p.monto)}</span>
      </div>
    </div>
  )
}

function FilaTabla({ p, resumen, onAbrir, isDesktop, expandido, onToggle }) {
  const abrir = () => onAbrir(p)
  const idDetalle = `pedido-extra-${p.idPedido}`
  return (
    <Fragment>
      <tr
        onClick={abrir} onKeyDown={teclaActivar(abrir)} tabIndex={0}
        className="border-b border-surface-700/50 hover:bg-surface-700/40 cursor-pointer transition-colors
                   focus-visible:outline-none focus-visible:bg-surface-700/50"
      >
        <td className="py-3 px-3 min-[1025px]:px-4 text-brand-400 font-mono text-sm">#{p.idPedido}</td>
        {isDesktop && <td className="py-3 px-4 text-surface-300 font-mono text-xs">{fmtFecha(p.fecha)}</td>}
        <td className="py-3 px-3 min-[1025px]:px-4">
          {p.nombreProveedor
            ? <p className="text-white text-sm font-body font-medium">{p.nombreProveedor}</p>
            : <span className="text-surface-500 text-sm font-body">—</span>}
        </td>
        <td className="py-3 px-3 min-[1025px]:px-4 text-white font-mono font-medium whitespace-nowrap">{fmt(p.monto)}</td>
        {isDesktop ? (
          <>
            <td className="py-3 px-4 text-surface-300 text-xs font-body">{metodoPagoLabel(p)}</td>
            <td className="py-3 px-4"><EstadoLogisticoBadge pedido={p} /></td>
            <td className="py-3 px-4"><PagoBadge pedido={p} resumen={resumen} /></td>
            <td className="py-3 px-4 text-surface-500"><ShoppingCart size={15} /></td>
          </>
        ) : (
          <>
            <td className="py-3 px-3">
              <div className="flex flex-col items-start gap-1.5">
                <EstadoLogisticoBadge pedido={p} />
                <PagoBadge pedido={p} resumen={resumen} />
              </div>
            </td>
            <td className="py-1 px-1 w-12">
              <button
                type="button" aria-expanded={expandido} aria-controls={idDetalle}
                aria-label={`${expandido ? 'Ocultar' : 'Ver'} más datos del pedido ${p.idPedido}`}
                onClick={(e) => { e.stopPropagation(); onToggle(p.idPedido) }}
                onKeyDown={(e) => e.stopPropagation()}
                className="flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl text-surface-300
                           hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                <ChevronDown size={18} className={`transition-transform ${expandido ? 'rotate-180' : ''}`} />
              </button>
            </td>
          </>
        )}
      </tr>
      {!isDesktop && expandido && (
        <tr id={idDetalle} className="border-b border-surface-700/50 bg-surface-900/40">
          <td colSpan={5} className="px-4 py-3">
            <dl className="grid grid-cols-2 gap-4 text-sm font-body">
              <div>
                <dt className="text-surface-400 uppercase tracking-widest mb-0.5">Fecha pedido</dt>
                <dd className="text-white font-mono">{fmtFecha(p.fecha)}</dd>
              </div>
              <div>
                <dt className="text-surface-400 uppercase tracking-widest mb-0.5">Método de pago</dt>
                <dd className="text-white">{metodoPagoLabel(p)}</dd>
              </div>
            </dl>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/**
 * @param {object} props
 * @param {object[]} props.pedidos        Página actual.
 * @param {object}   props.cuotasResumen  { [idPedido]: resumen }.
 * @param {number}   props.totalSinFiltrar Cantidad de pedidos antes del filtro de proveedor (para el mensaje vacío).
 * @param {boolean}  props.loading
 * @param {Error|null} props.error
 * @param {()=>void} props.onRetry
 * @param {(p:object)=>void} props.onAbrir
 * @param {React.ReactNode} [props.footer] Paginador: queda DENTRO del mismo Card que la lista
 *   (igual que Inventario), separado por la línea divisoria del propio paginador.
 */
export default function PedidosListado({
  pedidos, cuotasResumen, totalSinFiltrar, loading, error, onRetry, onAbrir, footer,
}) {
  const { isMobile, isDesktop } = useBreakpoint()
  const [expandidos, setExpandidos] = useState(() => new Set())
  const toggle = (id) => setExpandidos((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  let contenido
  if (error && totalSinFiltrar === 0) {
    contenido = (
      <div role="alert" className="flex flex-col items-center gap-4 text-center p-8">
        <AlertCircle size={24} className="text-red-400" />
        <p className="text-red-400 text-sm font-body max-w-sm">
          No se pudieron cargar los pedidos. Revisá tu conexión e intentá de nuevo.
        </p>
        <Button onClick={onRetry} className={TOUCH}>Reintentar</Button>
      </div>
    )
  } else if (loading && totalSinFiltrar === 0) {
    contenido = (
      <div role="status" aria-live="polite" className="flex items-center justify-center gap-3 text-surface-400 p-10">
        <Loader2 size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span className="text-sm font-body">Cargando pedidos…</span>
      </div>
    )
  } else if (pedidos.length === 0) {
    contenido = (
      <div className="flex flex-col items-center py-16 gap-3 text-surface-500">
        <ShoppingCart size={32} className="opacity-30" />
        <p className="font-body text-sm text-center px-4">
          {totalSinFiltrar === 0 ? 'Sin pedidos registrados.' : 'No hay pedidos que coincidan con los filtros.'}
        </p>
      </div>
    )
  } else if (isMobile) {
    contenido = (
      <ul aria-label="Listado de pedidos" aria-busy={loading} className="space-y-3 p-3 sm:p-4">
        {pedidos.map((p) => (
          <li key={p.idPedido}>
            <PedidoCard pedido={p} resumen={cuotasResumen[p.idPedido]} onAbrir={onAbrir} />
          </li>
        ))}
      </ul>
    )
  } else {
    const cabeceras = isDesktop
      ? ['ID', 'Fecha pedido', 'Proveedor', 'Monto', 'Método pago', 'Estado logístico', 'Pago', '']
      : ['ID', 'Proveedor', 'Monto', 'Estado', '']
    contenido = (
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-body" aria-busy={loading}>
          <thead>
            <tr className="border-b border-surface-700">
              {cabeceras.map((h, i) => (
                <th key={`${h}-${i}`} scope="col" className={TH}>
                  {h || <span className="sr-only">{isDesktop ? 'Acciones' : 'Más datos'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <FilaTabla
                key={p.idPedido} p={p} resumen={cuotasResumen[p.idPedido]} onAbrir={onAbrir}
                isDesktop={isDesktop} expandido={expandidos.has(p.idPedido)} onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <Card className="overflow-hidden">
      {contenido}
      {footer}
    </Card>
  )
}
