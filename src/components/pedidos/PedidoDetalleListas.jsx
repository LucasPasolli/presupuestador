// src/components/pedidos/PedidoDetalleListas.jsx
// Plan de cuotas e ítems del detalle de un pedido. Presentacionales.
//   mobile → tarjetas apiladas (sin scroll horizontal).
//   tablet/desktop → tabla (en tablet se oculta la columna "#" para ganar ancho).

import { BadgeCheck, CheckCircle2, Clock } from 'lucide-react'
import { Badge, Button } from '../ui'
import { TOUCH, fmt, fmtFecha } from './pedidosPresentacion'

const TH = 'text-left text-surface-400 text-sm min-[1025px]:text-xs tracking-widest uppercase py-3 px-3 min-[1025px]:px-4 font-body'
const TD = 'py-3 px-3 min-[1025px]:px-4'

function EstadoCuota({ c }) {
  return c.estado === 'pagada'
    ? <Badge color="green"><CheckCircle2 size={11} className="inline mr-1" />Pagada{c.fechaPago ? ` · ${fmtFecha(c.fechaPago)}` : ''}</Badge>
    : <Badge color="yellow"><Clock size={11} className="inline mr-1" />Pendiente</Badge>
}

/**
 * @param {object}   props
 * @param {object[]} props.cuotas
 * @param {(idCuota:number)=>void} props.onPagar
 * @param {boolean}  props.mobile
 */
export function CuotasPlanDetalle({ cuotas, onPagar, mobile }) {
  if (mobile) {
    return (
      <ul className="p-3 space-y-3">
        {cuotas.map((c) => (
          <li key={c.idCuota} className="bg-surface-900/40 border border-surface-700 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-white font-mono text-base">Cuota #{c.numeroCuota}</span>
              <span className="text-surface-300 font-mono text-sm">{c.porcentaje}%</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm font-body">
              <span className="text-surface-300">Vence {fmtFecha(c.fechaVencimiento)}</span>
              <span className="text-white font-mono font-semibold text-base">{fmt(c.monto)}</span>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1">
              <EstadoCuota c={c} />
              {c.estado !== 'pagada' && (
                <Button size="sm" variant="secondary" icon={BadgeCheck} className={TOUCH} onClick={() => onPagar(c.idCuota)}>
                  Pagar
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-surface-700">
            {['Cuota', '%', 'Vencimiento', 'Monto', 'Estado', ''].map((h, i) => (
              <th key={`${h}-${i}`} scope="col" className={TH}>{h || <span className="sr-only">Acciones</span>}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cuotas.map((c) => (
            <tr key={c.idCuota} className="border-b border-surface-700/50">
              <td className={`${TD} text-white font-mono text-sm`}>#{c.numeroCuota}</td>
              <td className={`${TD} text-surface-300 font-mono text-xs`}>{c.porcentaje}%</td>
              <td className={`${TD} text-surface-300 font-mono text-xs`}>{fmtFecha(c.fechaVencimiento)}</td>
              <td className={`${TD} text-surface-200 font-mono font-medium`}>{fmt(c.monto)}</td>
              <td className={TD}><EstadoCuota c={c} /></td>
              <td className={TD}>
                {c.estado !== 'pagada' && (
                  <Button size="sm" variant="secondary" icon={BadgeCheck} className={TOUCH} onClick={() => onPagar(c.idCuota)}>
                    Pagar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Casilla con área táctil de 44×44 px (la casilla visual sigue siendo 20 px). */
function CasillaItem({ d, checked, onToggle }) {
  const nombre = `${d.nombreProducto ?? 'producto #' + d.idProducto}${d.medida ? ' ' + d.medida : ''}`
  return (
    <label className="flex items-center justify-center min-h-[44px] min-w-[44px] cursor-pointer -m-2">
      <input
        type="checkbox" checked={checked} onChange={onToggle}
        aria-label={`Incluir en la exportación: ${nombre}`}
        className="h-5 w-5 min-[1025px]:h-4 min-[1025px]:w-4 rounded accent-brand-500 cursor-pointer
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      />
    </label>
  )
}

/**
 * @param {object}   props
 * @param {object[]} props.detalles
 * @param {{estaSeleccionado:(id:any)=>boolean, toggle:(id:any)=>void}} props.sel  Retorno de useSeleccionItems.
 * @param {boolean}  props.mobile
 * @param {boolean}  props.desktop
 */
export function ItemsPedidoDetalle({ detalles, sel, mobile, desktop }) {
  if (mobile) {
    return (
      <ul className="p-3 space-y-3">
        {detalles.map((d, idx) => {
          const marcado = sel.estaSeleccionado(d.idDetallePedido)
          return (
            <li key={d.idDetallePedido}
              className={`border rounded-xl p-4 space-y-2 ${marcado ? 'border-brand-500/40 bg-brand-500/5' : 'border-surface-700 bg-surface-900/40'}`}>
              <div className="flex items-start gap-3">
                <CasillaItem d={d} checked={marcado} onToggle={() => sel.toggle(d.idDetallePedido)} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-base font-body break-words">{d.nombreProducto ?? `#${d.idProducto}`}</p>
                  <p className="text-surface-300 text-sm font-mono">#{idx + 1} · ID {d.idProducto}</p>
                </div>
                {d.medida && <Badge color="blue">{d.medida}</Badge>}
              </div>
              <dl className="grid grid-cols-1 gap-1 text-sm font-body">
                <div className="flex justify-between"><dt className="text-surface-400">Cantidad</dt><dd className="text-surface-200 font-mono">{d.cantidad}</dd></div>
                <div className="flex justify-between"><dt className="text-surface-400">Precio proveedor</dt><dd className="text-surface-200 font-mono">{fmt(d.precioUnitario)}</dd></div>
                <div className="flex justify-between"><dt className="text-surface-400">Subtotal</dt><dd className="text-white font-mono font-semibold">{fmt(d.subtotal)}</dd></div>
              </dl>
            </li>
          )
        })}
      </ul>
    )
  }

  const cabeceras = ['ID Prod.', 'Producto', 'Medida', 'Cant.', 'Precio Proveedor', 'Subtotal']
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm font-body">
        <thead>
          <tr className="border-b border-surface-700">
            <th className={`${TH} w-12`}><span className="sr-only">Incluir en la exportación</span></th>
            {desktop && <th scope="col" className={TH}>#</th>}
            {cabeceras.map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {detalles.map((d, idx) => {
            const marcado = sel.estaSeleccionado(d.idDetallePedido)
            return (
              <tr key={d.idDetallePedido} className={`border-b border-surface-700/50 ${marcado ? 'bg-brand-500/5' : ''}`}>
                <td className={TD}><CasillaItem d={d} checked={marcado} onToggle={() => sel.toggle(d.idDetallePedido)} /></td>
                {desktop && <td className={`${TD} text-surface-500 text-xs font-mono`}>{idx + 1}</td>}
                <td className={`${TD} text-surface-400 font-mono text-xs`}>#{d.idProducto}</td>
                <td className={`${TD} text-white font-body`}>{d.nombreProducto ?? `#${d.idProducto}`}</td>
                <td className={TD}>
                  {d.medida ? <Badge color="blue">{d.medida}</Badge> : <span className="text-surface-500 text-xs">—</span>}
                </td>
                <td className={`${TD} text-surface-200 font-mono text-center`}>{d.cantidad}</td>
                <td className={`${TD} text-surface-200 font-mono whitespace-nowrap`}>{fmt(d.precioUnitario)}</td>
                <td className={`${TD} text-surface-200 font-mono font-medium whitespace-nowrap`}>{fmt(d.subtotal)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
